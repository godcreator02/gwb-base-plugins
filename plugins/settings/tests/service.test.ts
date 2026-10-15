import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from 'cordis'
import type { Fiber, Message, Plugin } from 'cordis'
import type { GwbCommandContext, GwbCommandHandler } from '@godcreator/gwb-commands'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GwbSettings, { type GwbSettingsApi, type SettingGroupDef, type SettingView } from '../src/index.js'
import { readSettings, writeSettings } from '../src/store.js'

let home: string
let settingsFile: string
const settingsFibers: Fiber[] = []

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-settings-service-'))
  settingsFile = path.join(home, 'settings.json')
})

afterEach(async () => {
  await Promise.all(settingsFibers.splice(0).map((fiber) => fiber.dispose()))
  vi.restoreAllMocks()
  fs.rmSync(home, { recursive: true, force: true })
})

interface RegisteredCommand {
  def: { name: string; description?: string; usage?: string; plugin: string; hiddenFromAgents?: true }
  handler: GwbCommandHandler
}

/** 只记登记与注销的命令总线替身 */
function fakeCommandBus() {
  const commands = new Map<string, RegisteredCommand>()
  return {
    commands,
    register(def: RegisteredCommand['def'], handler: RegisteredCommand['handler']) {
      commands.set(def.name, { def, handler })
      return () => void commands.delete(def.name)
    },
    list: () => [...commands.values()].map((c) => c.def),
    run: async () => ({ ok: true }),
  }
}

/** 只记登记了哪些目录的说明书服务替身 */
function fakeSkills() {
  const registeredDirs: string[] = []
  return {
    registeredDirs,
    register(dir: string | URL) {
      registeredDirs.push(String(dir))
      return () => {}
    },
    list: () => [],
    read: async () => undefined,
  }
}

async function bootSettings(dataDir = home) {
  const root = new Context()
  const logs: Message[] = []
  root.logger.exporter({ export: (message) => void logs.push(message) })
  const bus = fakeCommandBus()
  const skills = fakeSkills()
  root.provide('gwbKernel', { dataDir, version: 'test', emit: () => {}, setShell: () => () => {} })
  root.provide('gwbCommands', bus)
  root.provide('gwbSkills', skills)
  const settingsPlugin: Plugin = GwbSettings
  const settingsFiber = await root.plugin(settingsPlugin)
  settingsFibers.push(settingsFiber)
  const runCommand = (commandName: string, args?: unknown, source: GwbCommandContext = { via: 'plugin' }): unknown => bus.commands.get(commandName)!.handler(args, source)
  return { root, logs, bus, skills, settingsFiber, runCommand }
}

/** 装一个调用方插件，fiber 上放 loader 会放的 `entry`（null 时不放）；setup 在 apply 里拿到服务后执行 */
async function caller(
  root: Context,
  entry: { id: string; pkg: string } | null,
  setup: (settings: GwbSettingsApi) => void = () => {},
): Promise<{ settings: GwbSettingsApi; fiber: Fiber }> {
  let settings: GwbSettingsApi | undefined
  const fiber = await root.plugin({
    name: 'caller',
    inject: ['gwbSettings'],
    apply: (ctx: Context) => {
      if (entry !== null) (ctx.fiber as unknown as { entry: unknown }).entry = { id: entry.id, options: { name: entry.pkg } }
      settings = ctx.gwbSettings
      setup(ctx.gwbSettings)
    },
  })
  if (settings === undefined) throw new Error('调用方没拿到 gwbSettings')
  return { settings, fiber }
}

const HELLO = { id: 'home:hello', pkg: '@t/gwb-hello' }
const readFileJson = (): Record<string, unknown> => JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, unknown>
const textsOf = (logs: Message[], type: string): string[] => logs.filter((m) => m.type === type).map((m) => m.args.map(String).join(' '))
/** define 之后有一次合并写盘排在定时器上；后面没有别的写入时，等 settings.json 出现（那次写完）再往下，免得测试结束删目录时它还在写 */
async function scheduledWriteDone(): Promise<void> {
  for (let attempt = 0; attempt < 400 && !fs.existsSync(settingsFile); attempt++) await new Promise((resolve) => setTimeout(resolve, 5))
}

describe('GwbSettings 服务', () => {
  it('构造时同步读完 settings.json：调用方 apply 里第一次 get 就读得到盘上的值', async () => {
    fs.writeFileSync(settingsFile, JSON.stringify({ hello: { level: { value: 'debug' } } }))
    const { root } = await bootSettings()
    let seenInApply: unknown
    await caller(root, HELLO, (settings) => {
      settings.define({ key: 'level', title: '级别', type: 'string', default: 'info' })
      seenInApply = settings.get('level')
    })
    expect(seenInApply).toBe('debug')
  })

  it('没设过值时 get 回 default；set 写进 settings.json，归属表在最前', async () => {
    const { root } = await bootSettings()
    const { settings } = await caller(root, HELLO, (s) => s.define({ key: 'level', title: '级别', type: 'string', default: 'info' }))
    expect(settings.get('level')).toBe('info')
    await settings.set('level', 'warn')
    expect(settings.get('level')).toBe('warn')
    const written = readFileJson()
    expect(Object.keys(written)[0]).toBe('$owners')
    expect(written).toMatchObject({ $owners: { hello: '@t/gwb-hello' }, hello: { level: { value: 'warn', title: '级别', type: 'string' } } })
  })

  it('define 之后合并写一次盘，元信息进文件', async () => {
    const { root } = await bootSettings()
    await caller(root, HELLO, (s) => {
      s.define({ key: 'a', title: '甲', type: 'string' })
      s.define({ key: 'b', title: '乙', type: 'number' })
    })
    await scheduledWriteDone()
    expect(readFileJson()).toMatchObject({ hello: { a: { title: '甲' }, b: { title: '乙' } } })
  })

  it('define 之后马上 set：写盘不报错，文件里是 set 之后的整张表', async () => {
    const { root, logs } = await bootSettings()
    let setDone: Promise<void> | undefined
    await caller(root, HELLO, (s) => {
      s.define({ key: 'level', title: '级别', type: 'string', default: 'info' })
      setDone = s.set('level', 'warn')
    })
    await setDone
    expect(readFileJson()).toMatchObject({ $owners: { hello: '@t/gwb-hello' }, hello: { level: { value: 'warn', title: '级别' } } })
    expect(textsOf(logs, 'warn')).toEqual([])
  })

  it('delete 抹掉值、定义还在，get 回到 default', async () => {
    const { root, logs } = await bootSettings()
    const { settings } = await caller(root, HELLO, (s) => s.define({ key: 'level', title: '级别', type: 'string', default: 'info' }))
    await settings.set('level', 'warn')
    await settings.delete('level')
    expect(settings.get('level')).toBe('info')
    expect(textsOf(logs, 'info')).toContain('设置 hello.level 已删')
  })

  it('写、删自己没声明过的设置都抛错', async () => {
    const { root } = await bootSettings()
    const { settings } = await caller(root, HELLO)
    await expect(settings.set('nope', 1)).rejects.toThrow('home:hello 要写一项自己没声明过的设置：nope')
    await expect(settings.delete('nope')).rejects.toThrow('home:hello 要删一项自己没声明过的设置：nope')
  })

  it('条目 id 是随机的时 define 写 warn', async () => {
    const { root, logs } = await bootSettings()
    await caller(root, { id: 'home:a3f9c210', pkg: '@t/gwb-rand' }, (s) => s.define({ key: 'k', title: 'K', type: 'string' }))
    await scheduledWriteDone()
    expect(textsOf(logs, 'warn').some((t) => t.includes('@t/gwb-rand 那条条目没在 cordis.yml 里写 id'))).toBe(true)
  })

  it('调用方卸载时它的声明自动注销：settings.all 里那一项不再 live', async () => {
    const { root, runCommand } = await bootSettings()
    const { fiber } = await caller(root, HELLO, (s) => s.define({ key: 'level', title: '级别', type: 'string' }))
    await scheduledWriteDone()
    const liveOf = (): boolean | undefined => (runCommand('settings.all') as SettingView[]).find((row) => row.key === 'level')?.live
    expect(liveOf()).toBe(true)
    await fiber.dispose()
    expect(liveOf()).toBe(false)
  })

  it('owners() 回一份副本；transferOwner 写盘并写 info', async () => {
    const { root, logs } = await bootSettings()
    const { settings } = await caller(root, HELLO, (s) => s.define({ key: 'level', title: '级别', type: 'string' }))
    const owners = settings.owners()
    owners['hello'] = '@changed/x'
    expect(settings.owners()).toEqual({ hello: '@t/gwb-hello' })
    await settings.transferOwner('home:hello', '@t/gwb-hello-2')
    expect(settings.owners()).toEqual({ hello: '@t/gwb-hello-2' })
    expect(readFileJson()['$owners']).toEqual({ hello: '@t/gwb-hello-2' })
    expect(textsOf(logs, 'info')).toContain('设置分区 hello 改归 @t/gwb-hello-2')
  })

  it('取不到调用方身份时 define 与 get 抛错', async () => {
    const { root } = await bootSettings()
    const { settings } = await caller(root, null)
    expect(() => settings.define({ key: 'k', title: 'K', type: 'string' })).toThrow('取不到调用方的身份')
    expect(() => settings.get('k')).toThrow('取不到调用方的身份')
  })

  it('写盘失败写 warn，再把异常抛给调用方', async () => {
    fs.mkdirSync(settingsFile)
    const { root, logs } = await bootSettings()
    const { settings } = await caller(root, HELLO, (s) => s.define({ key: 'level', title: '级别', type: 'string' }))
    await expect(settings.set('level', 'x')).rejects.toThrow()
    expect(textsOf(logs, 'warn').some((t) => t.startsWith('设置写入文件失败'))).toBe(true)
  })

  it('说明书服务在时登记包根的 skills/ 目录', async () => {
    const { skills } = await bootSettings()
    expect(skills.registeredDirs).toHaveLength(1)
    expect(skills.registeredDirs[0]).toMatch(/\/skills\/$/)
  })
})

describe('设置与凭据命令', () => {
  it('登记命令，plugin 写包名；设置插件卸载时注销', async () => {
    const { bus, settingsFiber } = await bootSettings()
    expect(bus.list().map((c) => [c.name, c.plugin])).toEqual([
      ['settings.all', '@godcreator/gwb-settings'],
      ['settings.get', '@godcreator/gwb-settings'],
      ['settings.set', '@godcreator/gwb-settings'],
      ['settings.delete', '@godcreator/gwb-settings'],
      ['credentials.list', '@godcreator/gwb-settings'],
      ['credentials.status', '@godcreator/gwb-settings'],
      ['credentials.set', '@godcreator/gwb-settings'],
      ['credentials.delete', '@godcreator/gwb-settings'],
      ['credentials.reveal', '@godcreator/gwb-settings'],
      ['credentials.copy', '@godcreator/gwb-settings'],
      ['credentials.import', '@godcreator/gwb-settings'],
      ['credentials.generate', '@godcreator/gwb-settings'],
    ])
    await settingsFiber.dispose()
    expect(bus.list()).toEqual([])
  })

  it('普通设置按位置读写删仍返回原值和原回执', async () => {
    const { root, runCommand } = await bootSettings()
    const { settings } = await caller(root, HELLO, (s) => s.define({ key: 'level', title: '级别', type: 'string', default: 'info' }))
    const slot = { section: 'hello', key: 'level' }
    expect(await runCommand('settings.set', { ...slot, value: 'debug' })).toEqual({ ok: true })
    expect(settings.get('level')).toBe('debug')
    expect(runCommand('settings.get', slot)).toBe('debug')
    expect(runCommand('settings.all')).toEqual([{ ...slot, title: '级别', type: 'string', value: 'debug', default: 'info', live: true }])
    expect(await runCommand('settings.delete', slot)).toEqual({ ok: true })
    expect(runCommand('settings.get', slot)).toBeUndefined()
    expect(settings.get('level')).toBe('info')
  })

  it.each(['mcp', 'ui', 'plugin'] as const)('来源 %s 的 settings 命令都拒绝凭据，插件服务仍可读写', async (via) => {
    const { root, runCommand } = await bootSettings()
    const { settings } = await caller(root, HELLO, (s) => {
      s.define({ key: 'token', title: '令牌', type: 'secret' })
      s.define({ key: 'level', title: '级别', type: 'string' })
    })
    await settings.set('token', 'fake-local-token')
    await settings.set('level', 'debug')
    const slot = { section: 'hello', key: 'token' }
    expect(() => runCommand('settings.get', slot, { via })).toThrow('请用 credentials.*')
    await expect(runCommand('settings.set', { ...slot, value: 'fake-replaced' }, { via })).rejects.toThrow('请用 credentials.*')
    await expect(runCommand('settings.delete', slot, { via })).rejects.toThrow('请用 credentials.*')
    expect(runCommand('credentials.status', slot, { via })).toEqual({ ...slot, type: 'secret', secret: true, isSet: true, live: true })
    expect(runCommand('settings.get', { section: 'hello', key: 'level' }, { via })).toBe('debug')
    expect(settings.get('token')).toBe('fake-local-token')
    await settings.delete('token')
    expect(runCommand('credentials.status', slot, { via })).toMatchObject({ secret: true, isSet: false })
  })

  it('set/reveal 从 agent 清单隐藏，MCP 即使直接命中 handler 也被拒绝', async () => {
    const { root, bus, runCommand } = await bootSettings()
    const { settings } = await caller(root, HELLO, (s) => s.define({ key: 'token', title: '令牌', type: 'secret' }))
    await settings.set('token', 'fake-private-token')
    const slot = { section: 'hello', key: 'token' }
    expect(bus.commands.get('credentials.reveal')?.def.hiddenFromAgents).toBe(true)
    expect(bus.commands.get('credentials.set')?.def.hiddenFromAgents).toBe(true)
    expect(() => bus.commands.get('credentials.reveal')!.handler(slot, undefined as unknown as GwbCommandContext)).toThrow('凭据明文只供本地页面')
    expect(() => bus.commands.get('credentials.set')!.handler({ ...slot, value: 'fake-replaced' }, undefined as unknown as GwbCommandContext)).toThrow('凭据输入只供本地页面')
    expect(() => runCommand('credentials.reveal', slot, { via: 'mcp' })).toThrow('凭据明文只供本地页面和受信插件使用')
    expect(() => runCommand('credentials.set', { ...slot, value: 'fake-replaced' }, { via: 'mcp' })).toThrow('凭据输入只供本地页面')
    expect(runCommand('credentials.reveal', slot, { via: 'ui' })).toBe('fake-private-token')
    expect(runCommand('credentials.reveal', slot)).toBe('fake-private-token')
    const saved = await runCommand('credentials.set', { ...slot, value: 'fake-ui-saved' }, { via: 'ui' })
    expect(saved).toMatchObject({ secret: true, isSet: true })
    expect(JSON.stringify(saved)).not.toContain('fake-ui-saved')
    expect(settings.get('token')).toBe('fake-ui-saved')
    await expect(runCommand('credentials.set', { ...slot, value: null }, { via: 'ui' })).rejects.toThrow('凭据值要是字符串')
    expect(settings.get('token')).toBe('fake-ui-saved')
  })

  it('两份清单互不混入：凭据无值和默认值，只有一种类型的分区另一清单回空数组', async () => {
    const { root, runCommand } = await bootSettings()
    const { settings } = await caller(root, HELLO, (s) => {
      s.define({ key: 'token', title: '令牌', type: 'secret', default: 'fake-default' })
      s.define({ key: 'shared-token', title: '共享', type: 'secret', shared: true })
      s.define({ key: 'level', title: '级别', type: 'string' })
    })
    await settings.set('token', 'fake-saved')
    const ordinary = runCommand('settings.all', { section: 'hello' }) as SettingView[]
    const credentials = runCommand('credentials.list', { section: 'hello' }) as SettingView[]
    expect(ordinary.map((row) => row.key)).toEqual(['level'])
    expect(credentials).toEqual([{ section: 'hello', key: 'token', title: '令牌', type: 'secret', live: true, secret: true, isSet: true, mask: '••••' }])
    expect(JSON.stringify(credentials)).not.toContain('fake-')
    expect(runCommand('settings.all', { section: '*' })).toEqual([])
    expect((runCommand('credentials.list', { section: '*' }) as SettingView[]).map((row) => row.key)).toEqual(['shared-token'])
    await caller(root, { id: 'home:plain', pkg: '@t/plain' }, (s) => s.define({ key: 'a', title: 'A', type: 'string' }))
    expect(runCommand('credentials.list', { section: 'plain' })).toEqual([])
    expect(() => runCommand('credentials.list', { section: 'missing' })).toThrow('没有分区 missing')
    expect(() => runCommand('credentials.list', { sections: 'hello' })).toThrow('credentials.list 不认识参数')
    await settings.set('level', 'debug')
  })

  it('凭据命令拒绝普通项，status 缺失回 null，其他操作不偷偷创建凭据', async () => {
    const { root, runCommand } = await bootSettings()
    const { settings } = await caller(root, HELLO, (s) => s.define({ key: 'level', title: '级别', type: 'string' }))
    await settings.set('level', 'debug')
    const ordinary = { section: 'hello', key: 'level' }
    const missing = { section: 'hello', key: 'missing' }
    expect(runCommand('credentials.status', missing)).toBeNull()
    for (const name of ['credentials.status', 'credentials.reveal']) {
      expect(() => runCommand(name, ordinary)).toThrow('这是普通设置')
    }
    await expect(runCommand('credentials.delete', ordinary)).rejects.toThrow('这是普通设置')
    await expect(runCommand('credentials.set', { ...ordinary, value: 'fake-token' })).rejects.toThrow('已启用插件声明的 secret')
    expect(() => runCommand('credentials.reveal', missing)).toThrow('凭据项不存在')
    await expect(runCommand('credentials.delete', missing)).rejects.toThrow('凭据项不存在')
    await expect(runCommand('credentials.set', { ...missing, value: 'fake-token' })).rejects.toThrow('已启用插件声明的 secret')
    expect(settings.get('level')).toBe('debug')
    expect(runCommand('credentials.list')).toEqual([])
  })

  it('插件停用后可清除遗留凭据，重复清除幂等并保留凭据类型', async () => {
    const { root, runCommand } = await bootSettings()
    const { settings, fiber } = await caller(root, HELLO, (s) => s.define({ key: 'token', title: '令牌', type: 'secret' }))
    await settings.set('token', 'fake-orphan')
    await fiber.dispose()
    const slot = { section: 'hello', key: 'token' }
    await expect(runCommand('credentials.set', { ...slot, value: 'fake-replaced' })).rejects.toThrow('已启用插件声明的 secret')
    for (let i = 0; i < 2; i++) {
      expect(await runCommand('credentials.delete', slot, { via: 'mcp' })).toEqual({ ...slot, type: 'secret', secret: true, isSet: false, live: false })
    }
    expect(readSettings(settingsFile, () => {}).sections.hello?.token).toMatchObject({ type: 'secret' })
    expect(readSettings(settingsFile, () => {}).sections.hello?.token?.value).toBeUndefined()
    expect(() => runCommand('settings.get', slot)).toThrow('请用 credentials.*')
  })

  it('settings.all 带 section 只回那个分区；分区不存在、参数认不出都报错', async () => {
    const { root, runCommand } = await bootSettings()
    await caller(root, HELLO, (s) => s.define({ key: 'level', title: '级别', type: 'string' }))
    const rows = runCommand('settings.all', { section: 'hello' }) as SettingView[]
    expect(rows.map((row) => [row.section, row.key])).toEqual([['hello', 'level']])
    expect(() => runCommand('settings.all', { section: 'nope' })).toThrow(/没有分区 nope；现有的分区：.*hello/)
    expect(() => runCommand('settings.all', { sections: 'hello' })).toThrow('不认识参数 sections')
    expect(() => runCommand('settings.all', { section: '' })).toThrow('section 要是非空字符串')
  })

  it('参数不对时抛错，写明要什么', async () => {
    const { runCommand } = await bootSettings()
    expect(() => runCommand('settings.get', 'x')).toThrow('参数要是一个对象：{ section, key }')
    expect(() => runCommand('settings.get', { key: 'k' })).toThrow('section 要是个非空字符串')
    expect(() => runCommand('settings.get', { section: 's', key: '' })).toThrow('key 要是个非空字符串')
  })
})

describe('一组设置经服务与命令', () => {
  const models: SettingGroupDef = {
    key: 'models',
    title: '模型',
    fields: [
      { key: 'model', title: '模型名', type: 'string' },
      { key: 'api', title: '请求地址', type: 'string', default: 'https://api.example.com' },
      { key: 'token', title: '令牌', type: 'secret' },
    ],
  }
  const listSlot = { section: 'hello', key: 'models' }
  const liveKeys = (runCommand: (name: string, args?: unknown) => unknown): string[] =>
    [...(runCommand('settings.all') as SettingView[]), ...(runCommand('credentials.list') as SettingView[])].filter((row) => row.live).map((row) => row.key).sort()

  it('settings.set 改名单：新实例补声明、去掉的实例 live:false 且值留着；getGroup 现读', async () => {
    const { root, runCommand } = await bootSettings()
    const { settings } = await caller(root, HELLO, (s) => s.defineGroup(models))
    expect(await runCommand('settings.set', { ...listSlot, value: ['deepseek', 'kimi'] }, { via: 'mcp' })).toEqual({ ok: true })
    expect(liveKeys(runCommand)).toEqual(['models', 'models.deepseek.api', 'models.deepseek.model', 'models.deepseek.token', 'models.kimi.api', 'models.kimi.model', 'models.kimi.token'])
    await runCommand('settings.set', { section: 'hello', key: 'models.kimi.model', value: 'kimi-k2' }, { via: 'mcp' })
    expect(settings.getGroup('models').map((item) => item.name)).toEqual(['deepseek', 'kimi'])
    await settings.set('models', ['deepseek'])
    const kimiModel = (runCommand('settings.all', { section: 'hello' }) as SettingView[]).find((row) => row.key === 'models.kimi.model')
    expect(kimiModel).toMatchObject({ value: 'kimi-k2', live: false })
    expect(settings.getGroup('models')).toEqual([{ name: 'deepseek', values: { model: undefined, api: 'https://api.example.com', token: undefined } }])
    expect(readFileJson()).toMatchObject({ hello: { models: { value: ['deepseek'] }, 'models.kimi.model': { value: 'kimi-k2', title: 'kimi · 模型名' } } })
  })

  it('不合规的名单经命令与服务都整次拒绝，文件不变', async () => {
    const { root, runCommand } = await bootSettings()
    const { settings } = await caller(root, HELLO, (s) => s.defineGroup(models))
    await settings.set('models', ['deepseek'])
    const before = fs.readFileSync(settingsFile, 'utf8')
    await expect(runCommand('settings.set', { ...listSlot, value: ['deepseek', 'Kimi'] }, { via: 'mcp' })).rejects.toThrow('实例名不合规')
    await expect(settings.set('models', ['deepseek', 'deepseek'])).rejects.toThrow('实例名重复了')
    await expect(settings.set('models', 'deepseek')).rejects.toThrow('要是字符串数组')
    expect(fs.readFileSync(settingsFile, 'utf8')).toBe(before)
    expect(settings.getGroup('models').map((item) => item.name)).toEqual(['deepseek'])
  })

  it('派生的 secret 字段经 credentials.import 写入：list 打码，getGroup 回明文', async () => {
    const sourceFile = path.join(home, 'token.txt')
    fs.writeFileSync(sourceFile, 'fake-deepseek-token\n')
    const { root, runCommand } = await bootSettings()
    const { settings } = await caller(root, HELLO, (s) => s.defineGroup(models))
    await settings.set('models', ['deepseek'])
    const to = { section: 'hello', key: 'models.deepseek.token' }
    const result = await runCommand('credentials.import', { from: { file: sourceFile, format: 'text' }, to }, { via: 'mcp' })
    expect(result).toEqual({ ...to, type: 'secret', secret: true, isSet: true, live: true })
    const listed = runCommand('credentials.list', { section: 'hello' }) as SettingView[]
    expect(listed).toEqual([{ ...to, title: 'deepseek · 令牌', type: 'secret', live: true, secret: true, isSet: true, mask: '••••' }])
    expect(JSON.stringify(listed)).not.toContain('fake-deepseek-token')
    expect(settings.getGroup('models')[0]?.values['token']).toBe('fake-deepseek-token')
    expect(fs.readFileSync(settingsFile, 'utf8')).not.toContain('fake-deepseek-token')
  })

  it('getGroup 只认自己声明过的组；调用方卸载时名单与派生项都不再 live', async () => {
    const { root, runCommand } = await bootSettings()
    const { settings, fiber } = await caller(root, HELLO, (s) => s.defineGroup(models))
    await settings.set('models', ['deepseek'])
    expect(() => settings.getGroup('other')).toThrow('没有用 defineGroup 声明过一组设置 other')
    await fiber.dispose()
    expect(liveKeys(runCommand)).toEqual([])
  })
})

describe('凭据管理在服务中完成，不经过命令回包', () => {
  const fake = 'fake-source-secret-2026'
  const destination = { section: 'hello', key: 'target-token' }
  const defineCredentials = (settings: GwbSettingsApi): void => {
    settings.define({ key: 'source-token', title: '来源', type: 'secret' })
    settings.define({ key: 'target-token', title: '目标', type: 'secret' })
  }

  it('同 home 复制只返回目标状态；后续修改来源不改变目标', async () => {
    const { root, runCommand, logs } = await bootSettings()
    const { settings } = await caller(root, HELLO, defineCredentials)
    await settings.set('source-token', fake)
    const result = await runCommand('credentials.copy', { from: { section: 'hello', key: 'source-token' }, to: destination }, { via: 'mcp' })
    expect(result).toEqual({ ...destination, type: 'secret', secret: true, isSet: true, live: true })
    expect(settings.get('target-token')).toBe(fake)
    await settings.set('source-token', 'fake-changed-source')
    expect(settings.get('target-token')).toBe(fake)
    expect(JSON.stringify(result)).not.toContain(fake)
    expect(textsOf(logs, 'info').join('\n')).not.toContain(fake)
  })

  it('跨 home 只读点名来源，复制之后各自保管；没有来源不回退 default', async () => {
    const sourceFile = path.join(home, 'default', 'settings.json')
    const source = { sections: { hello: { 'source-token': { type: 'secret', value: fake } } }, owners: {} }
    await writeSettings(sourceFile, source)
    const sourceSettings = fs.readFileSync(sourceFile, 'utf8')
    const sourceCredentials = fs.readFileSync(path.join(home, 'default', 'credentials.json'), 'utf8')
    const currentHome = path.join(home, 'isolated')
    const { root, runCommand } = await bootSettings(currentHome)
    const { settings } = await caller(root, HELLO, defineCredentials)
    await expect(runCommand('credentials.copy', { from: { section: 'hello', key: 'source-token' }, to: destination })).rejects.toThrow('来源不是非空')
    await expect(runCommand('credentials.copy', { from: { home: 'absent', section: 'hello', key: 'source-token' }, to: destination })).rejects.toThrow('来源 home 不存在')
    const result = await runCommand('credentials.copy', { from: { home: 'default', section: 'hello', key: 'source-token' }, to: destination })
    expect(result).toMatchObject({ secret: true, isSet: true })
    expect(settings.get('target-token')).toBe(fake)
    expect(fs.readFileSync(sourceFile, 'utf8')).toBe(sourceSettings)
    expect(fs.readFileSync(path.join(home, 'default', 'credentials.json'), 'utf8')).toBe(sourceCredentials)
    await settings.set('target-token', 'fake-target-specific')
    expect(readSettings(sourceFile, () => {}).sections.hello?.['source-token']?.value).toBe(fake)
    source.sections.hello['source-token'].value = 'fake-source-rotated'
    await writeSettings(sourceFile, source)
    expect(settings.get('target-token')).toBe('fake-target-specific')
  })

  it.each(['text', 'json'] as const)('从 %s 文件导入，不修改来源、不在结果或日志回显', async (format) => {
    const sourceFile = path.join(home, 'import-source')
    const contents = format === 'text' ? `${fake}\r\n` : JSON.stringify({ account: { token: fake } })
    fs.writeFileSync(sourceFile, contents)
    const { root, runCommand, logs } = await bootSettings()
    const { settings } = await caller(root, HELLO, defineCredentials)
    const from = { file: sourceFile, format, ...(format === 'json' ? { path: ['account', 'token'] } : {}) }
    const result = await runCommand('credentials.import', { from, to: destination }, { via: 'mcp' })
    expect(settings.get('target-token')).toBe(fake)
    expect(result).toMatchObject({ secret: true, isSet: true })
    expect(JSON.stringify(result)).not.toContain(fake)
    expect(fs.readFileSync(sourceFile, 'utf8')).toBe(contents)
    expect(textsOf(logs, 'info').join('\n')).not.toContain(fake)
  })

  it('损坏 JSON 导入失败不泄漏片段，不改变原目标', async () => {
    const sourceFile = path.join(home, 'malformed.json')
    const contents = `{"token":"${fake}`
    fs.writeFileSync(sourceFile, contents)
    const { root, runCommand, logs } = await bootSettings()
    const { settings } = await caller(root, HELLO, defineCredentials)
    await settings.set('target-token', 'fake-original')
    let message = ''
    try { await runCommand('credentials.import', { from: { file: sourceFile, format: 'json' }, to: destination, overwrite: true }) } catch (error) { message = String(error) }
    expect(message).toContain('不是有效 JSON')
    expect(message).not.toContain(fake)
    expect(settings.get('target-token')).toBe('fake-original')
    expect(fs.readFileSync(sourceFile, 'utf8')).toBe(contents)
    expect(textsOf(logs, 'warn').join('\n')).not.toContain(fake)
  })

  it('目标必须 live secret，未知、普通与已停用的项都不能导入', async () => {
    const sourceFile = path.join(home, 'source.txt')
    fs.writeFileSync(sourceFile, fake)
    const { root, runCommand } = await bootSettings()
    let unbind: (() => void) | undefined
    await caller(root, HELLO, (settings) => {
      settings.define({ key: 'ordinary', title: '普通', type: 'string' })
      unbind = settings.define({ key: 'inactive', title: '停用', type: 'secret' })
    })
    unbind!()
    for (const key of ['unknown', 'ordinary', 'inactive']) {
      await expect(runCommand('credentials.import', { from: { file: sourceFile, format: 'text' }, to: { section: 'hello', key } })).rejects.toThrow('已启用插件声明的 secret')
    }
    await scheduledWriteDone()
  })

  it('已有目标必须显式 overwrite，生成结果只有状态且随机值已落盘', async () => {
    const { root, runCommand, logs } = await bootSettings()
    const { settings } = await caller(root, HELLO, defineCredentials)
    await settings.set('target-token', fake)
    await expect(runCommand('credentials.generate', { to: destination })).rejects.toThrow('overwrite:true')
    expect(settings.get('target-token')).toBe(fake)
    const result = await runCommand('credentials.generate', { to: destination, bytes: 16, overwrite: true }, { via: 'mcp' })
    const generated = settings.get('target-token') as string
    expect(generated).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(Buffer.from(generated, 'base64url')).toHaveLength(16)
    expect(readSettings(settingsFile, () => {}).sections.hello?.['target-token']?.value).toBe(generated)
    expect(JSON.stringify(result)).not.toContain(generated)
    expect(textsOf(logs, 'info').join('\n')).not.toContain(generated)
    expect(fs.readFileSync(settingsFile, 'utf8')).not.toContain(generated)
  })

  it('同时 copy、import、generate 而不允许覆盖时，只有第一个写入成功', async () => {
    const sourceFile = path.join(home, 'source.txt')
    fs.writeFileSync(sourceFile, 'fake-imported')
    const { root, runCommand } = await bootSettings()
    const { settings } = await caller(root, HELLO, defineCredentials)
    await settings.set('source-token', fake)
    const results = await Promise.allSettled([
      runCommand('credentials.copy', { from: { section: 'hello', key: 'source-token' }, to: destination }),
      runCommand('credentials.import', { from: { file: sourceFile, format: 'text' }, to: destination }),
      runCommand('credentials.generate', { to: destination }),
    ])
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'rejected'])
    expect(settings.get('target-token')).toBe(fake)
    expect(readSettings(settingsFile, () => {}).sections.hello?.['target-token']?.value).toBe(fake)
  })

  it('凭据文件写失败后内存恢复原值，错误和日志不包含来源内容', async () => {
    const { root, runCommand, logs } = await bootSettings()
    const { settings } = await caller(root, HELLO, defineCredentials)
    await settings.set('source-token', fake)
    await settings.set('target-token', 'fake-original')
    vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error(fake))
    await expect(runCommand('credentials.copy', { from: { section: 'hello', key: 'source-token' }, to: destination, overwrite: true })).rejects.toThrow('credentials.json 写入失败')
    expect(settings.get('target-token')).toBe('fake-original')
    expect(readSettings(settingsFile, () => {}).sections.hello?.['target-token']?.value).toBe('fake-original')
    expect(textsOf(logs, 'warn').join('\n')).not.toContain(fake)
  })

  it('凭据已落盘但普通设置写失败时，内存按已落盘凭据恢复而不伪造回滚', async () => {
    const { root, runCommand } = await bootSettings()
    const { settings } = await caller(root, HELLO, defineCredentials)
    await settings.set('source-token', fake)
    await settings.set('target-token', 'fake-original')
    const rename = fs.promises.rename.bind(fs.promises)
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (to === settingsFile) throw new Error('fake-settings-write-error')
      await rename(from, to)
    })
    await expect(runCommand('credentials.copy', { from: { section: 'hello', key: 'source-token' }, to: destination, overwrite: true })).rejects.toThrow('settings.json 写入失败')
    expect(settings.get('target-token')).toBe(fake)
    expect(readSettings(settingsFile, () => {}).sections.hello?.['target-token']?.value).toBe(fake)
    expect(runCommand('credentials.status', destination, { via: 'mcp' })).toMatchObject({ secret: true, isSet: true })
  })

  it('旧 settings 中的值迁出后，重启服务第一次 get 就能取到凭据', async () => {
    fs.writeFileSync(settingsFile, JSON.stringify({ hello: { 'target-token': { type: 'secret', value: fake } } }))
    const first = await bootSettings()
    const { settings } = await caller(first.root, HELLO, defineCredentials)
    expect(settings.get('target-token')).toBe(fake)
    await settings.set('source-token', 'fake-other')
    expect(fs.readFileSync(settingsFile, 'utf8')).not.toContain(fake)
    await first.settingsFiber.dispose()
    const second = await bootSettings()
    let loaded: unknown
    await caller(second.root, HELLO, (api) => {
      defineCredentials(api)
      loaded = api.get('target-token')
    })
    expect(loaded).toBe(fake)
    expect(second.runCommand('credentials.status', destination, { via: 'mcp' })).toEqual({ ...destination, type: 'secret', secret: true, isSet: true, live: true })
  })
})

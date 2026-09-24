import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from 'cordis'
import type { Fiber, Message, Plugin } from 'cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import GwbSettings, { type GwbSettingsApi, type SettingView } from '../src/index.js'

let home: string
let settingsFile: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-settings-service-'))
  settingsFile = path.join(home, 'settings.json')
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
})

interface RegisteredCommand {
  def: { name: string; description?: string; usage?: string; plugin: string }
  handler: (args?: unknown) => unknown
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

async function bootSettings() {
  const root = new Context()
  const logs: Message[] = []
  root.logger.exporter({ export: (message) => void logs.push(message) })
  const bus = fakeCommandBus()
  const skills = fakeSkills()
  root.provide('gwbKernel', { dataDir: home, version: 'test', emit: () => {}, setShell: () => () => {} })
  root.provide('gwbCommands', bus)
  root.provide('gwbSkills', skills)
  const settingsPlugin: Plugin = GwbSettings
  const settingsFiber = await root.plugin(settingsPlugin)
  const runCommand = (commandName: string, args?: unknown): unknown => bus.commands.get(commandName)!.handler(args)
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
/** define 之后有一次合并写盘排在定时器上；等 settings.json 出现（那次写完）再往下，免得两次写同时改名到同一个文件 */
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
    await scheduledWriteDone()
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

  it('delete 抹掉值、定义还在，get 回到 default', async () => {
    const { root, logs } = await bootSettings()
    const { settings } = await caller(root, HELLO, (s) => s.define({ key: 'level', title: '级别', type: 'string', default: 'info' }))
    await scheduledWriteDone()
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
    await scheduledWriteDone()
    const owners = settings.owners()
    owners['hello'] = '@changed/x'
    expect(settings.owners()).toEqual({ hello: '@t/gwb-hello' })
    await settings.transferOwner('home:hello', '@t/gwb-hello-2')
    expect(settings.owners()).toEqual({ hello: '@t/gwb-hello-2' })
    expect(readFileJson()['$owners']).toEqual({ hello: '@t/gwb-hello-2' })
    expect(textsOf(logs, 'info')).toContain('设置分区 hello 过户给 @t/gwb-hello-2')
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
    await scheduledWriteDone()
    await expect(settings.set('level', 'x')).rejects.toThrow()
    expect(textsOf(logs, 'warn').some((t) => t.startsWith('设置落盘失败'))).toBe(true)
  })

  it('说明书服务在时登记包根的 skills/ 目录', async () => {
    const { skills } = await bootSettings()
    expect(skills.registeredDirs).toHaveLength(1)
    expect(skills.registeredDirs[0]).toMatch(/\/skills\/$/)
  })
})

describe('四条命令', () => {
  it('登记四条，plugin 写包名；设置插件卸载时注销', async () => {
    const { bus, settingsFiber } = await bootSettings()
    expect(bus.list().map((c) => [c.name, c.plugin])).toEqual([
      ['settings.all', '@godcreator/gwb-settings'],
      ['settings.get', '@godcreator/gwb-settings'],
      ['settings.set', '@godcreator/gwb-settings'],
      ['settings.delete', '@godcreator/gwb-settings'],
    ])
    await settingsFiber.dispose()
    expect(bus.list()).toEqual([])
  })

  it('按位置读写删：settings.get 对 secret 项也回明文，settings.all 不回', async () => {
    const { root, runCommand } = await bootSettings()
    const { settings } = await caller(root, HELLO, (s) => s.define({ key: 'token', title: '令牌', type: 'secret' }))
    await scheduledWriteDone()
    expect(await runCommand('settings.set', { section: 'hello', key: 'token', value: 'abc' })).toEqual({ ok: true })
    expect(settings.get('token')).toBe('abc')
    expect(runCommand('settings.get', { section: 'hello', key: 'token' })).toBe('abc')
    expect(JSON.stringify(runCommand('settings.all'))).not.toContain('abc')
    expect(await runCommand('settings.delete', { section: 'hello', key: 'token' })).toEqual({ ok: true })
    expect(runCommand('settings.get', { section: 'hello', key: 'token' })).toBeUndefined()
  })

  it('参数不对时抛错，写明要什么', async () => {
    const { runCommand } = await bootSettings()
    expect(() => runCommand('settings.get', 'x')).toThrow('参数要是一个对象：{ section, key }')
    expect(() => runCommand('settings.get', { key: 'k' })).toThrow('section 要是个非空字符串')
    expect(() => runCommand('settings.get', { section: 's', key: '' })).toThrow('key 要是个非空字符串')
  })
})

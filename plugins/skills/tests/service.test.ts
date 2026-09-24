import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from 'cordis'
import type { Fiber, Message, Plugin } from 'cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import GwbSkills, { type GwbSkillsApi } from '../src/index.js'

let workDir: string

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-skills-service-'))
})

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
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

/** 在 workDir 下造一个装说明书的目录，返回它的路径 */
function writeSkillsDir(dirName: string, files: Record<string, string>): string {
  const skillsDir = path.join(workDir, dirName)
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(skillsDir, ...rel.split('/'))
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, text, 'utf8')
  }
  return skillsDir
}

async function bootSkills() {
  const root = new Context()
  const logs: Message[] = []
  root.logger.exporter({ export: (message) => void logs.push(message) })
  const bus = fakeCommandBus()
  root.provide('gwbCommands', bus)
  const skillsPlugin: Plugin = GwbSkills
  const skillsFiber = await root.plugin(skillsPlugin)
  const runCommand = (commandName: string, args?: unknown): unknown => bus.commands.get(commandName)!.handler(args)
  return { root, logs, bus, skillsFiber, runCommand }
}

/** 装一个调用方插件，fiber 上放 loader 会放的 `entry`（pkg 为 null 时不放），交回它拿到的服务与它的 fiber */
async function caller(root: Context, pkg: string | null): Promise<{ skills: GwbSkillsApi; fiber: Fiber }> {
  let skills: GwbSkillsApi | undefined
  const fiber = await root.plugin({
    name: 'caller',
    inject: ['gwbSkills'],
    apply: (ctx: Context) => {
      if (pkg !== null) (ctx.fiber as unknown as { entry: unknown }).entry = { id: 'home:x', options: { name: pkg } }
      skills = ctx.gwbSkills
    },
  })
  if (skills === undefined) throw new Error('调用方没拿到 gwbSkills')
  return { skills, fiber }
}

const warningsOf = (logs: Message[]): string[] => logs.filter((m) => m.type === 'warn').map((m) => m.args.map(String).join(' '))

const ALPHA = { 'alpha/SKILL.md': '---\nname: alpha\ndescription: 甲\n---\n甲的正文', 'alpha/references/more.md': '附件' }

describe('GwbSkills 服务', () => {
  it('登记两条命令，plugin 写包名；说明书插件卸载时注销', async () => {
    const { bus, skillsFiber } = await bootSkills()
    expect(bus.list()).toEqual([
      { name: 'skill.list', description: '此刻挂着的 skill（名字 + 描述 + 挂它的件）', usage: '无参数', plugin: '@godcreator/gwb-skills' },
      { name: 'skill.read', description: '读一份 skill 的正文', usage: '参数 { name, file? }，file 缺省 SKILL.md', plugin: '@godcreator/gwb-skills' },
    ])
    await skillsFiber.dispose()
    expect(bus.list()).toEqual([])
  })

  it('register 收下目录里的说明书，plugin 取调用方包名；字符串路径与 file URL 都认', async () => {
    const { root } = await bootSkills()
    const { skills } = await caller(root, '@t/gwb-a')
    skills.register(writeSkillsDir('a', ALPHA))
    const { skills: other } = await caller(root, '@t/gwb-b')
    other.register(pathToFileURL(writeSkillsDir('b', { 'beta/SKILL.md': '---\ndescription: 乙\n---\n' })))
    expect(skills.list()).toEqual([
      { name: 'alpha', description: '甲', plugin: '@t/gwb-a', files: ['SKILL.md', 'references/more.md'] },
      { name: 'beta', description: '乙', plugin: '@t/gwb-b', files: ['SKILL.md'] },
    ])
  })

  it('read 默认读 SKILL.md，也读清单里的附件；每次现读磁盘', async () => {
    const { root } = await bootSkills()
    const { skills } = await caller(root, '@t/gwb-a')
    const dir = writeSkillsDir('a', ALPHA)
    skills.register(dir)
    expect(await skills.read('alpha')).toContain('甲的正文')
    expect(await skills.read('alpha', 'references/more.md')).toBe('附件')
    fs.writeFileSync(path.join(dir, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: 甲\n---\n改过的正文')
    expect(await skills.read('alpha')).toContain('改过的正文')
  })

  it('read 只认清单里的文件：不在表里的说明书、不在清单里的文件、带 .. 的路径都回 undefined', async () => {
    const { root } = await bootSkills()
    const { skills } = await caller(root, '@t/gwb-a')
    skills.register(writeSkillsDir('a', ALPHA))
    fs.writeFileSync(path.join(workDir, 'secret.md'), '不该读到')
    expect(await skills.read('nope')).toBeUndefined()
    expect(await skills.read('alpha', 'later.md')).toBeUndefined()
    expect(await skills.read('alpha', '../../secret.md')).toBeUndefined()
  })

  it('清单里的文件后来被删了，read 回 undefined 并写 warn', async () => {
    const { root, logs } = await bootSkills()
    const { skills } = await caller(root, '@t/gwb-a')
    const dir = writeSkillsDir('a', ALPHA)
    skills.register(dir)
    fs.rmSync(path.join(dir, 'alpha', 'references', 'more.md'))
    expect(await skills.read('alpha', 'references/more.md')).toBeUndefined()
    expect(warningsOf(logs).some((t) => t.includes('读 alpha/references/more.md 失败'))).toBe(true)
  })

  it('扫描中的问题按调用方包名写 warn', async () => {
    const { root, logs } = await bootSkills()
    const { skills } = await caller(root, '@t/gwb-a')
    skills.register(writeSkillsDir('a', { 'gamma/readme.md': '没有主文件' }))
    expect(warningsOf(logs).some((t) => t.includes('[@t/gwb-a] gamma') && t.includes('SKILL.md'))).toBe(true)
  })

  it('同名说明书先到先得：后来的那份不收并写 warn', async () => {
    const { root, logs } = await bootSkills()
    const { skills: first } = await caller(root, '@t/gwb-a')
    first.register(writeSkillsDir('a', ALPHA))
    const { skills: second } = await caller(root, '@t/gwb-b')
    second.register(writeSkillsDir('b', { 'alpha/SKILL.md': '---\nname: alpha\ndescription: 冒名\n---\n' }))
    expect(first.list()).toEqual([expect.objectContaining({ name: 'alpha', plugin: '@t/gwb-a' })])
    expect(warningsOf(logs).some((t) => t.includes('alpha 已被 @t/gwb-a 占着'))).toBe(true)
  })

  it('注销函数只撤自己收下的那几份；调用方卸载时自动注销', async () => {
    const { root } = await bootSkills()
    const { skills: first, fiber: firstFiber } = await caller(root, '@t/gwb-a')
    const offFirst = first.register(writeSkillsDir('a', ALPHA))
    const { skills: second } = await caller(root, '@t/gwb-b')
    second.register(writeSkillsDir('b', { 'alpha/SKILL.md': '---\nname: alpha\ndescription: 冒名\n---\n', 'beta/SKILL.md': '---\ndescription: 乙\n---\n' }))
    offFirst()
    expect(first.list().map((s) => s.name)).toEqual(['beta'])
    const { skills: third, fiber: thirdFiber } = await caller(root, '@t/gwb-c')
    third.register(writeSkillsDir('c', { 'gamma/SKILL.md': '---\ndescription: 丙\n---\n' }))
    await thirdFiber.dispose()
    await firstFiber.dispose()
    expect(first.list().map((s) => s.name)).toEqual(['beta'])
  })

  it('注销函数不删别人后来登记的同名说明书', async () => {
    const { root } = await bootSkills()
    const { skills: first, fiber: firstFiber } = await caller(root, '@t/gwb-a')
    const offFirst = first.register(writeSkillsDir('a', ALPHA))
    offFirst()
    const { skills: second } = await caller(root, '@t/gwb-b')
    second.register(writeSkillsDir('b', { 'alpha/SKILL.md': '---\nname: alpha\ndescription: 接手\n---\n' }))
    offFirst()
    await firstFiber.dispose()
    expect(second.list()).toEqual([expect.objectContaining({ name: 'alpha', plugin: '@t/gwb-b' })])
  })

  it('取不到调用方身份时 register 抛错', async () => {
    const { root } = await bootSkills()
    const { skills } = await caller(root, null)
    expect(() => skills.register(workDir)).toThrow('取不到调用方的身份')
  })
})

describe('skill.list 与 skill.read 两条命令', () => {
  it('skill.list 回 { count, skills }', async () => {
    const { root, runCommand } = await bootSkills()
    const { skills } = await caller(root, '@t/gwb-a')
    skills.register(writeSkillsDir('a', ALPHA))
    expect(runCommand('skill.list')).toEqual({ count: 1, skills: skills.list() })
  })

  it('skill.read 读到回 { ok, data: { name, file, text } }，file 缺省或空串都读 SKILL.md', async () => {
    const { root, runCommand } = await bootSkills()
    const { skills } = await caller(root, '@t/gwb-a')
    skills.register(writeSkillsDir('a', ALPHA))
    expect(await runCommand('skill.read', { name: 'alpha', file: 'references/more.md' })).toEqual({
      ok: true,
      data: { name: 'alpha', file: 'references/more.md', text: '附件' },
    })
    const withEmptyFile = (await runCommand('skill.read', { name: 'alpha', file: '' })) as { data: { file: string } }
    expect(withEmptyFile.data.file).toBe('SKILL.md')
  })

  it('skill.read 参数不对、读不到都回失败回执，不区分没这份说明书与没这个文件', async () => {
    const { root, runCommand } = await bootSkills()
    const { skills } = await caller(root, '@t/gwb-a')
    skills.register(writeSkillsDir('a', ALPHA))
    expect(await runCommand('skill.read', undefined)).toEqual({ ok: false, error: 'skill.read 要 { name: string, file?: string }' })
    expect(await runCommand('skill.read', { name: '' })).toEqual({ ok: false, error: 'skill.read 要 { name: string, file?: string }' })
    expect(await runCommand('skill.read', { name: 'nope' })).toEqual({ ok: false, error: '读不到 nope/SKILL.md（不在登记表里）' })
    expect(await runCommand('skill.read', { name: 'alpha', file: 'x.md' })).toEqual({ ok: false, error: '读不到 alpha/x.md（不在登记表里）' })
  })
})

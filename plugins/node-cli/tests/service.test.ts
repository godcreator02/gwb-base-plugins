import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from 'cordis'
import type { Fiber, Message, Plugin } from 'cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import GwbNodeCli, { type CliRunResult, type GwbNodeCliApi, type NodeCliSpec } from '../src/index.js'

let workDir: string
let entry: string

/** 这个脚本把自己看到的 argv、cwd 与 ELECTRON_RUN_AS_NODE 写到 stdout */
const REPORTER = "process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), asNode: process.env.ELECTRON_RUN_AS_NODE, extra: process.env.GWB_EXTRA }))"

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-node-cli-service-'))
  entry = path.join(workDir, 'dist', 'cli.js')
  fs.mkdirSync(path.dirname(entry))
  fs.writeFileSync(entry, REPORTER)
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

async function bootNodeCli() {
  const root = new Context()
  const logs: Message[] = []
  root.logger.exporter({ export: (message) => void logs.push(message) })
  const bus = fakeCommandBus()
  root.provide('gwbCommands', bus)
  const nodeCliPlugin: Plugin = GwbNodeCli
  const nodeCliFiber = await root.plugin(nodeCliPlugin)
  const runCommand = (commandName: string, args?: unknown): unknown => bus.commands.get(commandName)!.handler(args)
  return { root, logs, bus, nodeCliFiber, runCommand }
}

/** 装一个调用方插件，fiber 上放 loader 会放的 `entry`（pkg 为 null 时不放），交回它拿到的服务与它的 fiber */
async function caller(root: Context, pkg: string | null): Promise<{ nodeCli: GwbNodeCliApi; fiber: Fiber }> {
  let nodeCli: GwbNodeCliApi | undefined
  const fiber = await root.plugin({
    name: 'caller',
    inject: ['gwbNodeCli'],
    apply: (ctx: Context) => {
      if (pkg !== null) (ctx.fiber as unknown as { entry: unknown }).entry = { id: 'home:x', options: { name: pkg } }
      nodeCli = ctx.gwbNodeCli
    },
  })
  if (nodeCli === undefined) throw new Error('调用方没拿到 gwbNodeCli')
  return { nodeCli, fiber }
}

const spec = (extra: Partial<NodeCliSpec> = {}): NodeCliSpec => ({ name: 'hello.run', entry, ...extra })
const reportOf = (outcome: unknown): { argv: string[]; cwd: string; asNode: string; extra?: string } =>
  JSON.parse((outcome as CliRunResult).stdout.text) as { argv: string[]; cwd: string; asNode: string; extra?: string }

describe('GwbNodeCli 服务', () => {
  it('登记 node-cli.list；运行插件卸载时注销', async () => {
    const { bus, nodeCliFiber } = await bootNodeCli()
    expect(bus.list()).toEqual([{ name: 'node-cli.list', description: '此刻登记了哪些 node CLI', usage: '无参数', plugin: '@godcreator/gwb-node-cli' }])
    await nodeCliFiber.dispose()
    expect(bus.list()).toEqual([])
  })

  it('register 进表，也登记成总线命令：plugin 缺省取调用方包名，用法缺省是参数形状说明', async () => {
    const { root, bus, runCommand } = await bootNodeCli()
    const { nodeCli } = await caller(root, '@t/gwb-hello')
    nodeCli.register(spec({ description: '打个招呼', args: ['--fixed'] }))
    expect(nodeCli.list()).toEqual([
      { name: 'hello.run', description: '打个招呼', entry, args: ['--fixed'], cwd: undefined, env: undefined, timeoutMs: 60_000, plugin: '@t/gwb-hello' },
    ])
    const busCommand = bus.list().find((c) => c.name === 'hello.run')!
    expect(busCommand.plugin).toBe('@t/gwb-hello')
    expect(busCommand.description).toBe('打个招呼')
    expect(busCommand.usage).toContain('参数 { args?: string[], cwd?: string }')
    expect(runCommand('node-cli.list')).toEqual(nodeCli.list())
  })

  it('spec 写了 plugin 与 usage 就用 spec 的', async () => {
    const { root, bus } = await bootNodeCli()
    const { nodeCli } = await caller(root, '@t/gwb-hello')
    nodeCli.register(spec({ plugin: '@t/other', usage: '无参数' }))
    expect(bus.list().find((c) => c.name === 'hello.run')).toMatchObject({ plugin: '@t/other', usage: '无参数' })
  })

  it('run 用当前 node 跑 entry：固定参数在前、追加参数在后，带 ELECTRON_RUN_AS_NODE，cwd 缺省是 entry 所在目录', async () => {
    const { root } = await bootNodeCli()
    const { nodeCli } = await caller(root, '@t/gwb-hello')
    nodeCli.register(spec({ args: ['--fixed'], env: { GWB_EXTRA: '额外' } }))
    const outcome = await nodeCli.run('hello.run', ['追加 参数'])
    expect(outcome.ok).toBe(true)
    const report = reportOf(outcome)
    expect(report.argv).toEqual(['--fixed', '追加 参数'])
    expect(report.asNode).toBe('1')
    expect(report.extra).toBe('额外')
    expect(fs.realpathSync(report.cwd)).toBe(fs.realpathSync(path.dirname(entry)))
  })

  it('cwd 优先级：按次给的 > 登记时给的 > entry 所在目录', async () => {
    const { root } = await bootNodeCli()
    const { nodeCli } = await caller(root, '@t/gwb-hello')
    nodeCli.register(spec({ cwd: workDir }))
    expect(fs.realpathSync(reportOf(await nodeCli.run('hello.run')).cwd)).toBe(fs.realpathSync(workDir))
    const perCall = path.join(workDir, 'per-call')
    fs.mkdirSync(perCall)
    expect(fs.realpathSync(reportOf(await nodeCli.run('hello.run', [], { cwd: perCall })).cwd)).toBe(fs.realpathSync(perCall))
  })

  it('按次给的 cwd 不合规时不启动进程，回 { ok: false, error } 并写 warn', async () => {
    const { root, logs } = await bootNodeCli()
    const { nodeCli } = await caller(root, '@t/gwb-hello')
    nodeCli.register(spec())
    const outcome = await nodeCli.run('hello.run', [], { cwd: 'relative/dir' })
    expect(outcome).toEqual({ ok: false, error: 'cwd 要是绝对路径（这儿不知道该相对于谁），给的是：relative/dir' })
    expect(logs.some((m) => m.type === 'warn' && String(m.args[0]).startsWith('hello.run 没跑'))).toBe(true)
  })

  it('总线命令收 { args, cwd } 或直接一串参数', async () => {
    const { root, runCommand } = await bootNodeCli()
    const { nodeCli } = await caller(root, '@t/gwb-hello')
    nodeCli.register(spec())
    expect(reportOf(await runCommand('hello.run', { args: ['a'], cwd: workDir })).argv).toEqual(['a'])
    expect(reportOf(await runCommand('hello.run', ['b', 'c'])).argv).toEqual(['b', 'c'])
  })

  it('进程失败照回回执；跑不存在的命令抛错', async () => {
    const { root } = await bootNodeCli()
    const { nodeCli } = await caller(root, '@t/gwb-hello')
    fs.writeFileSync(entry, 'process.exit(4)')
    nodeCli.register(spec())
    expect(await nodeCli.run('hello.run')).toMatchObject({ ok: false, exitCode: 4 })
    await expect(nodeCli.run('nope')).rejects.toThrow('没有这条 node CLI：nope')
  })

  it('注销函数同时撤掉表里那条与总线命令；调用方卸载时自动注销', async () => {
    const { root, bus } = await bootNodeCli()
    const { nodeCli, fiber } = await caller(root, '@t/gwb-hello')
    const unregister = nodeCli.register(spec())
    unregister()
    expect(nodeCli.list()).toEqual([])
    expect(bus.list().map((c) => c.name)).toEqual(['node-cli.list'])
    nodeCli.register(spec({ name: 'hello.again' }))
    await fiber.dispose()
    expect(nodeCli.list()).toEqual([])
    expect(bus.list().map((c) => c.name)).toEqual(['node-cli.list'])
  })

  it('取不到调用方身份时 register 抛错', async () => {
    const { root } = await bootNodeCli()
    const { nodeCli } = await caller(root, null)
    expect(() => nodeCli.register(spec())).toThrow('取不到调用方的身份')
  })
})

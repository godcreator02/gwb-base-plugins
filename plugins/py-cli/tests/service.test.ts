import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context, Service } from 'cordis'
import type { Fiber, Message, Plugin } from 'cordis'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import GwbPyCli, { venvPaths, type CliRunResult, type GwbPyCliApi, type PyCliSpec } from '../src/index.js'

/**
 * venv 按「已经就绪」的样子摆好（目录、出身记号、dist-info），守卫因此直接跳过、不启动 uv。
 * 入口点 `Scripts/tool.exe` 是当前 node 的一份拷贝，靠固定参数 `-e <脚本>` 把它看到的东西写到 stdout
 */
const DIST = { distName: 'gwb-fake-tool', version: '0.0.1' }
const REPORTER = "process.stdout.write(JSON.stringify({ argv: process.argv.slice(1), cwd: process.cwd(), utf8: process.env.PYTHONUTF8, io: process.env.PYTHONIOENCODING, extra: process.env.GWB_EXTRA }))"

let nodeCopyDir: string
let packageRoot: string

beforeAll(() => {
  nodeCopyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-py-cli-node-copy-'))
  fs.copyFileSync(process.execPath, path.join(nodeCopyDir, 'tool.exe'))
})

afterAll(() => {
  fs.rmSync(nodeCopyDir, { recursive: true, force: true })
})

beforeEach(() => {
  packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-py-cli-service-'))
})

afterEach(() => {
  fs.rmSync(packageRoot, { recursive: true, force: true })
})

function layOutReadyVenv(): void {
  const paths = venvPaths(packageRoot)
  fs.mkdirSync(paths.scriptsDir, { recursive: true })
  fs.mkdirSync(path.join(paths.sitePackages, 'gwb_fake_tool-0.0.1.dist-info'), { recursive: true })
  fs.writeFileSync(paths.stampPath, `${packageRoot}\n`)
  fs.copyFileSync(path.join(nodeCopyDir, 'tool.exe'), path.join(paths.scriptsDir, 'tool.exe'))
}

interface RegisteredCommand {
  def: { name: string; description?: string; usage?: string; plugin: string; effect: string }
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

async function bootPyCli() {
  const root = new Context()
  const logs: Message[] = []
  root.logger.exporter({ export: (message) => void logs.push(message) })
  const bus = fakeCommandBus()
  root.provide('gwbCommands', bus)
  const pyCliPlugin: Plugin = GwbPyCli
  const pyCliFiber = await root.plugin(pyCliPlugin)
  const runCommand = (commandName: string, args?: unknown): unknown => bus.commands.get(commandName)!.handler(args)
  return { root, logs, bus, pyCliFiber, runCommand }
}

/** 装一个调用方插件，fiber 上放 loader 会放的 `entry`（pkg 为 null 时不放），交回它拿到的服务与它的 fiber */
async function caller(root: Context, pkg: string | null): Promise<{ pyCli: GwbPyCliApi; fiber: Fiber }> {
  let pyCli: GwbPyCliApi | undefined
  const fiber = await root.plugin({
    name: 'caller',
    inject: ['gwbPyCli'],
    apply: (ctx: Context) => {
      if (pkg !== null) (ctx.fiber as unknown as { entry: unknown }).entry = { id: 'home:x', options: { name: pkg } }
      pyCli = ctx.gwbPyCli
    },
  })
  if (pyCli === undefined) throw new Error('调用方没拿到 gwbPyCli')
  return { pyCli, fiber }
}

const toolSpec = (extra: Partial<PyCliSpec> = {}): PyCliSpec => ({ name: 'tool.run', packageRoot, ...DIST, command: 'tool', effect: 'read', args: ['-e', REPORTER], ...extra })
type Report = { argv: string[]; cwd: string; utf8: string; io: string; extra?: string }
const reportOf = (outcome: unknown): Report => JSON.parse((outcome as CliRunResult).stdout.text) as Report
const textsOf = (logs: Message[], type: string): string[] => logs.filter((m) => m.type === type).map((m) => m.args.map(String).join(' '))
/** register 顺带发起的守卫不等它完成；等它把结果写进日志 */
async function bootstrapLogged(logs: Message[], name: string): Promise<void> {
  for (let attempt = 0; attempt < 200 && !logs.some((m) => String(m.args[0]).includes(name) && String(m.args[0]).includes('venv')); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('GwbPyCli 服务', () => {
  it('登记 py-cli.list；运行插件卸载时注销', async () => {
    const { bus, pyCliFiber } = await bootPyCli()
    expect(bus.list()).toEqual([{ name: 'py-cli.list', description: '此刻登记了哪些 python CLI', usage: '无参数', plugin: '@godcreator/gwb-py-cli', effect: 'read' }])
    await pyCliFiber.dispose()
    expect(bus.list()).toEqual([])
  })

  it('register 进表，也登记成总线命令：plugin 取调用方包名，用法缺省是参数形状说明；venv 已就绪时守卫跳过并写 info', async () => {
    layOutReadyVenv()
    const { root, bus, logs, runCommand } = await bootPyCli()
    const { pyCli } = await caller(root, '@t/gwb-tool')
    pyCli.register(toolSpec({ description: '一个工具' }))
    expect(pyCli.list()).toEqual([
      {
        name: 'tool.run',
        description: '一个工具',
        packageRoot,
        ...DIST,
        command: 'tool',
        module: undefined,
        args: ['-e', REPORTER],
        cwd: undefined,
        env: undefined,
        timeoutMs: 60_000,
        plugin: '@t/gwb-tool',
      },
    ])
    const busCommand = bus.list().find((c) => c.name === 'tool.run')!
    expect(busCommand).toMatchObject({ plugin: '@t/gwb-tool', description: '一个工具', effect: 'read' })
    expect(busCommand.usage).toContain('缺省是包根下的 py/ 目录')
    expect(runCommand('py-cli.list')).toEqual(pyCli.list())
    await bootstrapLogged(logs, 'tool.run')
    expect(textsOf(logs, 'info')).toContain('venv 已就绪，跳过：tool.run')
  })

  it('ensureReady 在 venv 已就绪时回 { ready: true, action: skipped }', async () => {
    layOutReadyVenv()
    const { root } = await bootPyCli()
    const { pyCli } = await caller(root, '@t/gwb-tool')
    expect(await pyCli.ensureReady({ packageRoot, ...DIST })).toEqual({ ready: true, action: 'skipped' })
  })

  it.skipIf(process.platform !== 'win32')('run 启动 Scripts/<command>.exe：固定参数在前、追加参数在后，带两条 UTF-8 环境变量，cwd 缺省是包根的 py/', async () => {
    layOutReadyVenv()
    const { root } = await bootPyCli()
    const { pyCli } = await caller(root, '@t/gwb-tool')
    pyCli.register(toolSpec({ env: { GWB_EXTRA: '额外' } }))
    const outcome = await pyCli.run('tool.run', ['追加 参数'])
    expect(outcome.ok).toBe(true)
    const report = reportOf(outcome)
    expect(report.argv).toEqual(['追加 参数'])
    expect(report.utf8).toBe('1')
    expect(report.io).toBe('utf-8')
    expect(report.extra).toBe('额外')
    expect(fs.realpathSync(report.cwd)).toBe(fs.realpathSync(venvPaths(packageRoot).projectDir))
  })

  it.skipIf(process.platform !== 'win32')('cwd 优先级：按次给的 > 登记时给的 > 包根的 py/；总线命令收 { args, cwd }', async () => {
    layOutReadyVenv()
    const { root, runCommand } = await bootPyCli()
    const { pyCli } = await caller(root, '@t/gwb-tool')
    pyCli.register(toolSpec({ cwd: packageRoot }))
    expect(fs.realpathSync(reportOf(await pyCli.run('tool.run')).cwd)).toBe(fs.realpathSync(packageRoot))
    const perCall = path.join(packageRoot, 'per-call')
    fs.mkdirSync(perCall)
    const viaBus = reportOf(await runCommand('tool.run', { args: ['a'], cwd: perCall }))
    expect(fs.realpathSync(viaBus.cwd)).toBe(fs.realpathSync(perCall))
    expect(viaBus.argv).toEqual(['a'])
  })

  it('module 形态启动 Scripts/python.exe -m <module>：python.exe 不在时回启动失败的回执，并写 error', async () => {
    layOutReadyVenv()
    const { root, logs } = await bootPyCli()
    const { pyCli } = await caller(root, '@t/gwb-tool')
    pyCli.register(toolSpec({ command: undefined, module: 'fake_tool', args: [] }))
    const outcome = (await pyCli.run('tool.run')) as CliRunResult
    expect(outcome).toMatchObject({ ok: false, exitCode: null, timedOut: false })
    expect(outcome.stderr.text).toContain('python.exe')
    expect(logs.some((m) => m.type === 'error' && String(m.args[0]).startsWith('tool.run'))).toBe(true)
  })

  it('按次给的 cwd 不合规时不启动进程，回 { ok: false, error } 并写 warn；跑不存在的命令抛错', async () => {
    layOutReadyVenv()
    const { root, logs } = await bootPyCli()
    const { pyCli } = await caller(root, '@t/gwb-tool')
    pyCli.register(toolSpec())
    expect(await pyCli.run('tool.run', [], { cwd: 'relative/dir' })).toEqual({ ok: false, error: 'cwd 要是绝对路径（这儿不知道该相对于谁），给的是：relative/dir' })
    expect(textsOf(logs, 'warn').some((t) => t.startsWith('tool.run 没有运行'))).toBe(true)
    await expect(pyCli.run('nope')).rejects.toThrow('没有这条 python CLI：nope')
  })

  it('venv 没就绪、也建不起来时 run 抛错，并写 warn', async () => {
    const { root, logs } = await bootPyCli()
    const { pyCli } = await caller(root, '@t/gwb-tool')
    pyCli.register(toolSpec())
    await expect(pyCli.run('tool.run')).rejects.toThrow('venv 没就绪，tool.run 无法运行')
    expect(textsOf(logs, 'warn').some((t) => t.startsWith('venv 没就绪，tool.run 无法运行'))).toBe(true)
  }, 60_000)

  it('注销函数同时撤掉表里那条与总线命令；调用方卸载时自动注销', async () => {
    layOutReadyVenv()
    const { root, bus } = await bootPyCli()
    const { pyCli, fiber } = await caller(root, '@t/gwb-tool')
    const unregister = pyCli.register(toolSpec())
    unregister()
    expect(pyCli.list()).toEqual([])
    expect(bus.list().map((c) => c.name)).toEqual(['py-cli.list'])
    pyCli.register(toolSpec({ name: 'tool.again' }))
    await fiber.dispose()
    expect(pyCli.list()).toEqual([])
    expect(bus.list().map((c) => c.name)).toEqual(['py-cli.list'])
  })

  it('取不到调用方身份时 register 抛错', async () => {
    const { root } = await bootPyCli()
    const { pyCli } = await caller(root, null)
    expect(() => pyCli.register(toolSpec())).toThrow('取不到调用方的身份')
  })
})

describe('GwbPyCli 经调用方的上下文登记总线命令', () => {
  it('总线看到的登记方是调用方，不是运行插件自己', async () => {
    layOutReadyVenv()
    const root = new Context()
    const logs: Message[] = []
    root.logger.exporter({ export: (message) => void logs.push(message) })
    const seenPackages: string[] = []
    /** 按服务写的总线替身：登记时记下 this.ctx 上 loader 条目的包名，也就是真命令总线认作登记方的那个 */
    class IdentityRecordingBus extends Service {
      constructor(ctx: Context) {
        super(ctx, 'gwbCommands')
      }
      register(): () => void {
        const fiber = this.ctx.fiber as unknown as { entry?: { options: { name: string } } }
        seenPackages.push(fiber.entry?.options.name ?? '（没有条目）')
        return () => {}
      }
      list(): [] {
        return []
      }
      async run(): Promise<{ ok: true }> {
        return { ok: true }
      }
    }
    const busPlugin: Plugin = IdentityRecordingBus
    await root.plugin(busPlugin)
    const pyCliPlugin: Plugin = GwbPyCli
    await root.plugin(pyCliPlugin)
    const { pyCli } = await caller(root, '@t/gwb-tool')
    pyCli.register(toolSpec({ description: '一个工具' }))
    await bootstrapLogged(logs, 'tool.run')
    expect(seenPackages.at(-1)).toBe('@t/gwb-tool')
  })

  it('总线拒收时撤掉表里那条，把总线的错抛给调用方', async () => {
    const root = new Context()
    root.provide('gwbCommands', {
      register(def: { name: string }) {
        if (def.name !== 'py-cli.list') throw new Error(`总线拒收 ${def.name}`)
        return () => {}
      },
      list: () => [],
      run: async () => ({ ok: true }),
    })
    const pyCliPlugin: Plugin = GwbPyCli
    await root.plugin(pyCliPlugin)
    const { pyCli } = await caller(root, '@t/gwb-tool')
    expect(() => pyCli.register(toolSpec())).toThrow('总线拒收 tool.run')
    expect(pyCli.list()).toEqual([])
  })
})

import path from 'node:path'
import { Service } from 'cordis'
import type { GwbContext } from '@godcreator/gwb-plugin-api'
// 这两个 import 同时激活命令插件与说明书插件的 `declare module 'cordis'`，给 ctx 加上 gwbCommands、gwbSkills
import type { GwbCommands } from '@godcreator/gwb-commands'
import type {} from '@godcreator/gwb-skills'
import { ensureVenv, venvPaths, type BootstrapResult } from './bootstrap.js'
import { checkCwd, parseInvocation } from './invoke.js'
import { createRegistry, type PyCliRegistry, type PyCliSpec, type RegisteredPyCli } from './registry.js'
import { runProcess, type CliRunResult } from './run.js'

export type { PyCliSpec, RegisteredPyCli } from './registry.js'
export type { CliRunResult, CliStream } from './run.js'
export type { BootstrapResult, VenvPaths } from './bootstrap.js'
export type { CwdCheck, Invocation } from './invoke.js'
export { checkCwd, parseInvocation } from './invoke.js'
export { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from './registry.js'
export { STAMP_NAME, venvPaths } from './bootstrap.js'

export const LIST_COMMAND = 'py-cli.list'

const PLUGIN_NAME = 'gwb-py-cli'
const PACKAGE_NAME = '@godcreator/gwb-py-cli'

/** 构建产物在 dist/ 下，包根的 skills/ 就是 '../skills/'；这个目录要列进 package.json 的 files */
const OWN_SKILLS_DIR = new URL('../skills/', import.meta.url)

/** 少了这两条，Windows 上 python 子进程的中文输出是乱码 */
const PY_ENV = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }

/** 总线命令缺省的用法：参数形状由运行插件定，登记方只写自己那部分 */
const INVOKE_SHAPE =
  '参数 { args?: string[], cwd?: string }：args 追加在固定参数后（直接给一个字符串数组也当 args）；' +
  'cwd 要是存在的目录的绝对路径，缺省是包根下的 py/ 目录'

/** 一次调用被拒（cwd 不合规之类）：没启动进程，回一句说清要什么的话 */
export interface CliRunRefused {
  ok: false
  error: string
}

/** `run` 回的两种：运行过了（进程回执）或没运行（被拒） */
export type CliRunOutcome = CliRunResult | CliRunRefused

type VenvIdentity = Pick<RegisteredPyCli, 'packageRoot' | 'distName' | 'version' | 'name'>

/** `Scripts/<command>.exe`，或 `Scripts/python.exe -m <module>` */
function executableAndPrefixArgs(registration: RegisteredPyCli): { command: string; prefixArgs: string[] } {
  const paths = venvPaths(registration.packageRoot)
  const command =
    registration.command !== undefined
      ? path.join(paths.scriptsDir, `${registration.command}.exe`)
      : path.join(paths.scriptsDir, 'python.exe')
  const prefixArgs = registration.module !== undefined ? ['-m', registration.module] : []
  return { command, prefixArgs }
}

/** 调用方拿到的接口。写 `inject: ['gwbPyCli']` 才有 */
export interface GwbPyCliApi {
  /**
   * 检查一次 venv：不在就建、版本对不上就同步、已经好了就跳过。幂等。
   * 不抛——uv 不在 PATH、同步没成，一律回 `{ ready: false, reason }`。同一个包根上并发调用只真跑一次
   */
  ensureReady(opts: { packageRoot: string; distName: string; version: string }): Promise<BootstrapResult>
  /**
   * 登记一条命令，身份从调用方的 fiber 上取；顺带发起一次 venv 检查，不等它完成。
   * 回注销函数；不用自己包 `ctx.effect`，插件卸载时自动从表上和命令总线上注销
   */
  register(spec: PyCliSpec): () => void
  /** 此刻表里有哪些，按登记先后 */
  list(): RegisteredPyCli[]
  /**
   * 运行一条。运行前先检查 venv，venv 没了会当场重建。`opts.cwd` 是按次给的工作目录，
   * 必须是存在的目录的绝对路径，不合规不抛、回 `{ ok: false, error }`（`spec.cwd` 仍是缺省）。没这条命令时抛
   */
  run(name: string, extraArgs?: readonly string[], opts?: { cwd?: string }): Promise<CliRunOutcome>
}

export default class GwbPyCli extends Service implements GwbPyCliApi {
  static inject = ['gwbCommands']

  /** 用 TS 的 `private` 不用 `#`：cordis 给每个调用方派生 `Object.create(this)`，`#` 字段在派生对象上一读就抛错 */
  private readonly pyCliRegistry: PyCliRegistry
  /** 本插件自己的上下文。方法里的 `this.ctx` 是调用方的，调用方未必 inject 过 gwbCommands，往总线登记命令要用这一份 */
  private readonly providerContext: GwbContext
  private readonly logInfo: (message: string) => void
  private readonly logWarn: (message: string) => void
  private readonly logError: (message: string) => void
  /** 正在进行的 venv 检查，按包根去重：并发运行时不同时启动两个 uv sync */
  private readonly venvChecksInFlight = new Map<string, Promise<BootstrapResult>>()

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbPyCli')
    this.providerContext = ctx
    // 构造时 this.ctx 还是本插件自己的上下文，logger 记在本插件名下
    const logger = ctx.logger(PLUGIN_NAME)
    this.logInfo = (message: string): void => logger.info(message)
    this.logWarn = (message: string): void => logger.warn(message)
    this.logError = (message: string): void => logger.error(message)
    this.pyCliRegistry = createRegistry((message) => this.logWarn(message))
  }

  [Service.init](): void {
    const commandBus = this.providerContext.gwbCommands
    // inject 保证了它在，这句只是把类型收窄
    if (commandBus === undefined) return
    this.registerListCommand(commandBus)
    this.providerContext.logger(PLUGIN_NAME).info(`python CLI 运行插件就绪（ctx.gwbPyCli），列出已登记的工具调 ${LIST_COMMAND}`)
    this.registerOwnSkillsWheneverSkillsPluginIsLoaded()
  }

  private registerListCommand(commandBus: GwbCommands): void {
    this.providerContext.effect(() =>
      commandBus.register({ name: LIST_COMMAND, description: '此刻登记了哪些 python CLI', usage: '无参数', plugin: PACKAGE_NAME }, () =>
        this.pyCliRegistry.list(),
      ),
    )
  }

  private registerOwnSkillsWheneverSkillsPluginIsLoaded(): void {
    this.providerContext.inject(['gwbSkills'], (contextWithSkills) => {
      contextWithSkills.effect(() => contextWithSkills.gwbSkills.register(OWN_SKILLS_DIR))
    })
  }

  /** 检查一次 venv 并把结果写进日志 */
  private async ensureReadyAndLog(identity: VenvIdentity, logger: { info: (m: string) => void; warn: (m: string) => void }): Promise<BootstrapResult> {
    const result = await this.ensureReady(identity)
    if (result.ready) {
      logger.info(result.action === 'skipped' ? `venv 已就绪，跳过：${identity.name}` : `venv 建好了：${identity.name}`)
    } else {
      logger.warn(`venv 没就绪，${identity.name} 无法运行：${result.reason ?? '没给出原因'}`)
    }
    return result
  }

  async ensureReady(opts: { packageRoot: string; distName: string; version: string }): Promise<BootstrapResult> {
    const packageRootKey = path.resolve(opts.packageRoot)
    const checkInFlight = this.venvChecksInFlight.get(packageRootKey)
    if (checkInFlight !== undefined) return checkInFlight

    const venvCheck = ensureVenv({
      packageRoot: opts.packageRoot,
      distName: opts.distName,
      version: opts.version,
      log: (message) => this.providerContext.logger(PLUGIN_NAME).info(message),
    }).finally(() => {
      this.venvChecksInFlight.delete(packageRootKey)
    })
    this.venvChecksInFlight.set(packageRootKey, venvCheck)
    return venvCheck
  }

  /** `fiber.entry` 是 loader 加上的，不在 cordis 的类型里，按运行时形状取 */
  private callerPackageName(): string {
    const fiber = this.ctx.fiber as unknown as { entry?: { options?: { name?: unknown } } } | undefined
    const name = fiber?.entry?.options?.name
    if (typeof name !== 'string' || name === '') {
      throw new Error('取不到调用方的身份——ctx.gwbPyCli 只能在经 cordis.yml 加载的插件里用')
    }
    return name
  }

  /** 用同一个名字登记成总线命令，plugin 取调用方的包名 */
  private registerOnCommandBus(spec: PyCliSpec, callerPackage: string): (() => void) | undefined {
    const commandBus = this.providerContext.gwbCommands
    return commandBus?.register({ name: spec.name, description: spec.description ?? '', usage: spec.usage ?? INVOKE_SHAPE, plugin: callerPackage }, (args) => {
      const invocation = parseInvocation(args)
      return this.invoke(spec.name, invocation.args, invocation.cwd)
    })
  }

  register(spec: PyCliSpec): () => void {
    const callerPackage = this.callerPackageName()
    const unregisterFromTable = this.pyCliRegistry.register(callerPackage, spec)
    this.logInfo(`CLI ${spec.name}（${callerPackage}）已登记`)
    const registration = this.pyCliRegistry.get(spec.name)!
    const unregisterFromBus = this.registerOnCommandBus(spec, callerPackage)
    const unregister = (): void => {
      unregisterFromTable()
      unregisterFromBus?.()
    }
    // this.ctx 是调用方的上下文，调用方卸载时自动注销
    this.ctx.effect(() => unregister)
    // 顺带把它的 venv 建起来，不挡着调用方的 apply 往下走
    void this.ensureReadyAndLog(registration, this.providerContext.logger(PLUGIN_NAME))
    return unregister
  }

  list(): RegisteredPyCli[] {
    return this.pyCliRegistry.list()
  }

  async run(name: string, extraArgs: readonly string[] = [], opts?: { cwd?: string }): Promise<CliRunOutcome> {
    return this.invoke(name, extraArgs, opts?.cwd)
  }

  /** `run` 与总线命令都走这里。`uncheckedCwd` 没收窄过，总线传来什么都得先过 `checkCwd` */
  private async invoke(name: string, extraArgs: readonly string[], uncheckedCwd: unknown): Promise<CliRunOutcome> {
    const registration = this.pyCliRegistry.get(name)
    if (registration === undefined) throw new Error(`没有这条 python CLI：${name}`)
    // cwd 不合规就不启动进程，也不检查 venv
    const perCallCwd = checkCwd(uncheckedCwd)
    if (!perCallCwd.ok) {
      this.logWarn(`${name} 没有运行：${perCallCwd.error}`)
      return { ok: false, error: perCallCwd.error }
    }
    return this.runRegistered(registration, extraArgs, perCallCwd.cwd)
  }

  /** 每次运行前都检查 venv：已就绪时只是三次文件系统调用，venv 被删了当场重建，没有单独的重试路径 */
  private async assertVenvReady(registration: RegisteredPyCli): Promise<void> {
    const ready = await this.ensureReady(registration)
    if (!ready.ready) {
      // 登记时那次检查写过日志，这里抛错之前也要留一句，不然运行时 venv 坏了日志里看不出来
      this.logWarn(`venv 没就绪，${registration.name} 无法运行：${ready.reason ?? '没给出原因'}`)
      throw new Error(`venv 没就绪，${registration.name} 无法运行：${ready.reason ?? '没给出原因'}`)
    }
  }


  private async runRegistered(registration: RegisteredPyCli, extraArgs: readonly string[], perCallCwd: string | undefined): Promise<CliRunResult> {
    await this.assertVenvReady(registration)
    const { command, prefixArgs } = executableAndPrefixArgs(registration)
    this.logInfo(`运行 ${registration.name}（追加 ${extraArgs.length} 个参数，时限 ${registration.timeoutMs}ms）`)
    const result = await runProcess({
      command,
      args: [...prefixArgs, ...registration.args, ...extraArgs],
      // 按次给的 > 登记时给的 > 那个 python 项目目录
      cwd: perCallCwd ?? registration.cwd ?? venvPaths(registration.packageRoot).projectDir,
      env: { ...PY_ENV, ...registration.env },
      timeoutMs: registration.timeoutMs,
    })
    this.logRunOutcome(registration.name, result)
    return result
  }

  private logRunOutcome(name: string, result: CliRunResult): void {
    if (result.ok) {
      this.logInfo(`${name} 运行完成：退出码 ${String(result.exitCode)}，耗时 ${result.durationMs}ms`)
    } else if (result.exitCode === null && !result.timedOut) {
      // 启动失败（可执行文件不在之类）：原因 runProcess 写进了 stderr
      this.logError(`${name} 启动失败：${result.stderr.text.trim().slice(-300) || '没给出原因'}`)
    } else if (result.timedOut) {
      this.logWarn(`${name} 超时（时限 ${result.timeoutMs}ms），已结束整个进程树`)
    } else {
      this.logWarn(`${name} 运行失败：退出码 ${String(result.exitCode)}\n${result.stderr.text.trim().slice(-500)}`)
    }
  }
}

declare module 'cordis' {
  interface Context {
    gwbPyCli: GwbPyCliApi
  }
}

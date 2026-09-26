import path from 'node:path'
import { Service } from 'cordis'
import type { GwbContext } from '@godcreator/gwb-kernel-desktop'
// 这两个 import 同时激活命令插件与说明书插件的 `declare module 'cordis'`，给 ctx 加上 gwbCommands、gwbSkills
import type { GwbCommands } from '@godcreator/gwb-commands'
import type {} from '@godcreator/gwb-skills'
import { checkCwd, parseInvocation } from './invoke.js'
import { createRegistry, type NodeCliRegistry, type NodeCliSpec, type RegisteredNodeCli } from './registry.js'
import { runProcess, type CliRunResult } from './run.js'

export type { NodeCliSpec, RegisteredNodeCli } from './registry.js'
export type { CliRunResult, CliStream } from './run.js'
export type { CwdCheck, Invocation } from './invoke.js'
export { checkCwd, parseInvocation } from './invoke.js'
export { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from './registry.js'

export const LIST_COMMAND = 'node-cli.list'

const PLUGIN_NAME = 'gwb-node-cli'
const PACKAGE_NAME = '@godcreator/gwb-node-cli'

/** 构建产物在 dist/ 下，包根的 skills/ 就是 '../skills/'；这个目录要列进 package.json 的 files */
const OWN_SKILLS_DIR = new URL('../skills/', import.meta.url)

/** 插件运行在内核的 Electron 主进程里，`process.execPath` 是 electron.exe；不带这个变量，子进程会启动一个 Electron 应用 */
const ELECTRON_AS_NODE = { ELECTRON_RUN_AS_NODE: '1' }

/** 总线命令缺省的用法：参数形状由运行插件定，登记方只写自己那部分 */
const INVOKE_SHAPE =
  '参数 { args?: string[], cwd?: string }：args 追加在固定参数后（直接给一个字符串数组也当 args）；' +
  'cwd 要是存在的目录的绝对路径，缺省是那个 js 所在的目录'

/** 一次调用被拒（cwd 不合规之类）：没启动进程，回一句说清要什么的话 */
export interface CliRunRefused {
  ok: false
  error: string
}

/** `run` 回的两种：运行过了（进程回执）或没运行（被拒） */
export type CliRunOutcome = CliRunResult | CliRunRefused

/** 调用方拿到的接口。写 `inject: ['gwbNodeCli']` 才有 */
export interface GwbNodeCliApi {
  /** 登记一条命令，身份从调用方的 fiber 上取。回注销函数；不用自己包 `ctx.effect`，插件卸载时自动从表上和命令总线上注销 */
  register(spec: NodeCliSpec): () => void
  /** 此刻表里有哪些，按登记先后 */
  list(): RegisteredNodeCli[]
  /**
   * 运行一条。`extraArgs` 追加在 spec 的固定参数后面；`opts.cwd` 是按次给的工作目录，
   * 必须是存在的目录的绝对路径，不合规不抛、回 `{ ok: false, error }`（`spec.cwd` 仍是缺省）。没这条命令时抛
   */
  run(name: string, extraArgs?: readonly string[], opts?: { cwd?: string }): Promise<CliRunOutcome>
}

export default class GwbNodeCli extends Service implements GwbNodeCliApi {
  static inject = ['gwbCommands']

  /** 用 TS 的 `private` 不用 `#`：cordis 给每个调用方派生 `Object.create(this)`，`#` 字段在派生对象上一读就抛错 */
  private readonly nodeCliRegistry: NodeCliRegistry
  private readonly logInfo: (message: string) => void
  private readonly logWarn: (message: string) => void
  private readonly logError: (message: string) => void
  /** 本插件自己的上下文。方法里的 `this.ctx` 是调用方的；登记本插件自己的命令、写本插件的日志用这一份 */
  private readonly providerContext: GwbContext

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbNodeCli')
    this.providerContext = ctx
    // 构造时 this.ctx 还是本插件自己的上下文，logger 记在本插件名下
    const logger = ctx.logger(PLUGIN_NAME)
    this.logInfo = (message: string): void => logger.info(message)
    this.logWarn = (message: string): void => logger.warn(message)
    this.logError = (message: string): void => logger.error(message)
    this.nodeCliRegistry = createRegistry((message) => this.logWarn(message))
  }

  [Service.init](): void {
    const commandBus = this.providerContext.gwbCommands
    // inject 保证了它在，这句只是把类型收窄
    if (commandBus === undefined) return
    this.registerListCommand(commandBus)
    this.providerContext.logger(PLUGIN_NAME).info(`node CLI 运行插件就绪（ctx.gwbNodeCli），列出已登记的工具调 ${LIST_COMMAND}`)
    this.registerOwnSkillsWheneverSkillsPluginIsLoaded()
  }

  private registerListCommand(commandBus: GwbCommands): void {
    this.providerContext.effect(() =>
      commandBus.register({ name: LIST_COMMAND, description: '此刻登记了哪些 node CLI', usage: '无参数', plugin: PACKAGE_NAME, effect: 'read' }, () =>
        this.nodeCliRegistry.list(),
      ),
    )
  }

  private registerOwnSkillsWheneverSkillsPluginIsLoaded(): void {
    this.providerContext.inject(['gwbSkills'], (contextWithSkills) => {
      contextWithSkills.effect(() => contextWithSkills.gwbSkills.register(OWN_SKILLS_DIR))
    })
  }

  /** `fiber.entry` 是 loader 加上的，不在 cordis 的类型里，按运行时形状取 */
  private callerPackageName(): string {
    const fiber = this.ctx.fiber as unknown as { entry?: { options?: { name?: unknown } } } | undefined
    const name = fiber?.entry?.options?.name
    if (typeof name !== 'string' || name === '') {
      throw new Error('取不到调用方的身份——ctx.gwbNodeCli 只能在经 cordis.yml 加载的插件里用')
    }
    return name
  }

  /**
   * 用同一个名字登记成总线命令。总线要经调用方的上下文取（`ctx.get` 不查 inject）：总线从取它的上下文认登记方的包名，
   * 经本插件的上下文取会把命令记在本插件名下、与 plugin 对不上而被拒
   */
  private registerOnCommandBus(spec: NodeCliSpec, callerPackage: string): (() => void) | undefined {
    const commandBusSeenByCaller = this.ctx.get('gwbCommands')
    return commandBusSeenByCaller?.register(
      { name: spec.name, description: spec.description ?? '', usage: spec.usage ?? INVOKE_SHAPE, plugin: spec.plugin ?? callerPackage, effect: spec.effect },
      (args) => {
        const invocation = parseInvocation(args)
        return this.invoke(spec.name, invocation.args, invocation.cwd)
      },
    )
  }

  /** 总线拒收（缺 description、plugin 不是调用方的包名）时撤掉已进表的那条再抛 */
  private registerOnCommandBusOrUndoTable(spec: NodeCliSpec, callerPackage: string, unregisterFromTable: () => void): (() => void) | undefined {
    try {
      return this.registerOnCommandBus(spec, callerPackage)
    } catch (busRefusal) {
      unregisterFromTable()
      throw busRefusal
    }
  }

  register(spec: NodeCliSpec): () => void {
    const callerPackage = this.callerPackageName()
    const unregisterFromTable = this.nodeCliRegistry.register(callerPackage, spec)
    const unregisterFromBus = this.registerOnCommandBusOrUndoTable(spec, callerPackage, unregisterFromTable)
    this.logInfo(`CLI ${spec.name}（${callerPackage}）已登记`)
    const unregister = (): void => {
      unregisterFromTable()
      unregisterFromBus?.()
    }
    // this.ctx 是调用方的上下文，调用方卸载时自动注销；不然插件卸了命令还在，一调就启动一个指向不存在文件的进程
    this.ctx.effect(() => unregister)
    return unregister
  }

  list(): RegisteredNodeCli[] {
    return this.nodeCliRegistry.list()
  }

  async run(name: string, extraArgs: readonly string[] = [], opts?: { cwd?: string }): Promise<CliRunOutcome> {
    return this.invoke(name, extraArgs, opts?.cwd)
  }

  /** `run` 与总线命令都走这里。`uncheckedCwd` 没收窄过，总线传来什么都得先过 `checkCwd` */
  private async invoke(name: string, extraArgs: readonly string[], uncheckedCwd: unknown): Promise<CliRunOutcome> {
    const registration = this.nodeCliRegistry.get(name)
    if (registration === undefined) throw new Error(`没有这条 node CLI：${name}`)
    const perCallCwd = checkCwd(uncheckedCwd)
    if (!perCallCwd.ok) {
      this.logWarn(`${name} 没有运行：${perCallCwd.error}`)
      return { ok: false, error: perCallCwd.error }
    }
    return this.runRegistered(registration, extraArgs, perCallCwd.cwd)
  }

  private async runRegistered(registration: RegisteredNodeCli, extraArgs: readonly string[], perCallCwd: string | undefined): Promise<CliRunResult> {
    this.logInfo(`运行 ${registration.name}（追加 ${extraArgs.length} 个参数，时限 ${registration.timeoutMs}ms）`)
    const result = await runProcess({
      command: process.execPath,
      args: [registration.entry, ...registration.args, ...extraArgs],
      // 按次给的 > 登记时给的 > 那个 js 所在目录；不继承内核进程的 cwd
      cwd: perCallCwd ?? registration.cwd ?? path.dirname(registration.entry),
      env: { ...ELECTRON_AS_NODE, ...registration.env },
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
    gwbNodeCli: GwbNodeCliApi
  }
}

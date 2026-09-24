import path from 'node:path'
import { Service } from 'cordis'
import type { GwbContext } from '@godcreator/gwb-plugin-api'
// 只为激活 commands 插件的 `declare module 'cordis'`——它给 ctx 加上 gwbCommands 这个名字
import type {} from '@godcreator/gwb-commands'
// 只为激活 skills 插件的 `declare module 'cordis'`——下面局部注入要用 gwbSkills 这个名字
import type {} from '@godcreator/gwb-skills'
import { checkCwd, parseInvocation } from './invoke.js'
import { createRegistry, type NodeCliRegistry, type NodeCliSpec, type RegisteredNodeCli } from './registry.js'
import { runProcess, type CliRunResult } from './run.js'

export type { NodeCliSpec, RegisteredNodeCli } from './registry.js'
export type { CliRunResult, CliStream } from './run.js'
export type { CwdCheck, Invocation } from './invoke.js'
export { checkCwd, parseInvocation } from './invoke.js'
export { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from './registry.js'

/**
 * 运行 node 写的命令行工具。插件把**自己编译出来的**那个 `cli.js` 登记进来，启动进程、收输出、
 * 超时结束都在这里——每个插件不用各写一遍 spawn 与超时。
 *
 * **argv[0] 一律 `process.execPath`，不查 PATH、不认 bin 包装脚本、不经 shell。**
 * 装进 node_modules 之后用全路径调用，Windows 上的引号转义与带空格的路径问题一并消除。
 *
 * **登记的命令同时登记成 `gwbCommands` 的总线命令**——界面、命令行、agent 都经同一个入口调用，
 * 所以这个插件必须 `inject` 命令总线：没有它，登记进来的命令出不了这个进程。
 */

/** 此刻登记了哪些 */
export const LIST_COMMAND = 'node-cli.list'

const PLUGIN_NAME = 'gwb-node-cli'

/**
 * 插件运行在内核的 Electron 主进程里，`process.execPath` 是 electron.exe——
 * 不带这个变量，子进程会启动一个 Electron 应用，而不是用 node 模式运行那个 js
 */
const ELECTRON_AS_NODE = { ELECTRON_RUN_AS_NODE: '1' }

/**
 * 每条登记进总线的命令，缺省用法都是这一句：agent 只看用法就得知道参数怎么给。
 * 写在这里而不是让每个登记方插件自己写，是因为参数形状由运行插件决定，登记方只写自己那部分
 */
const INVOKE_SHAPE =
  '参数 { args?: string[], cwd?: string }：args 追加在固定参数后（直接给一串也当 args）；' +
  'cwd 要是存在的目录的绝对路径，缺省落在那个 js 自己旁边'

/** 一次调用被拒（cwd 不合规之类）：没启动进程，回一句说清要什么的话 */
export interface CliRunRefused {
  ok: false
  error: string
}

/** `run` 回的两种：跑过了（进程回执）或没跑（被拒） */
export type CliRunOutcome = CliRunResult | CliRunRefused

/** 使用方拿到的服务接口。写 `inject: ['gwbNodeCli']` 才有 */
export interface GwbNodeCliApi {
  /**
   * 登记一条命令。身份不用给——由这儿从调用方的 fiber 上取。
   *
   * 回一个注销函数，给要提前注销的场景用。**不用自己包 `ctx.effect`**：插件卸载时这条命令
   * 自动从表上、也从命令总线上注销。
   */
  register(spec: NodeCliSpec): () => void
  /** 此刻表里有哪些条,按登记先后 */
  list(): RegisteredNodeCli[]
  /**
   * 跑一条。`extraArgs` 追加在 spec 的固定参数后面；`opts.cwd` 是**按次**给的工作目录，
   * 必须是存在的目录的绝对路径，不合规**不抛**、回 `{ ok: false, error }`（`spec.cwd` 仍是缺省）。
   * 没这条命令时抛
   */
  run(name: string, extraArgs?: readonly string[], opts?: { cwd?: string }): Promise<CliRunOutcome>
}

/** 登记进总线的命令：描述由登记方写，用法缺省是运行插件写的参数形状 */
export default class GwbNodeCli extends Service implements GwbNodeCliApi {
  /** 没有命令总线就不加载——inject 是 cordis 的等待机制，不是建议 */
  static inject = ['gwbCommands']

  /**
   * 注册表本体。**用 TS 的 `private` 不用 `#`**：cordis 给每个消费者派生一份
   * `Object.create(this)`，而 `#` 私有字段的内部槽不在原型链上，派生对象上一读就抛错。
   */
  private readonly registry: NodeCliRegistry
  /** 提供方自己的日志函数。构造时 this.ctx 还是自己，logger 绑的是本插件 */
  private readonly info: (message: string) => void
  private readonly warn: (message: string) => void
  private readonly error: (message: string) => void
  /**
   * 提供方自己的 ctx。方法里的 `this.ctx` 是**调用方**的，而调用方未必 inject 过
   * `gwbCommands`——往总线上登记命令得用这一份，不然取不到。注销另说：dispose 登记在调用方的
   * effect 上，调用方卸载时照样注销干净
   */
  private readonly own: GwbContext

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbNodeCli')
    this.own = ctx
    // 构造时 this.ctx 还是**提供方**自己的，logger 绑的是本插件
    const logger = ctx.logger(PLUGIN_NAME)
    this.info = (message: string): void => logger.info(message)
    this.warn = (message: string): void => logger.warn(message)
    this.error = (message: string): void => logger.error(message)
    this.registry = createRegistry((message) => this.warn(message))
  }

  /** 服务就绪时登记列表命令；包在 effect 里，本插件卸载时自动注销 */
  [Service.init](): void {
    const cli = this.own.gwbCommands
    // inject 保证了它在，这句只是把类型收窄
    if (cli === undefined) return

    this.own.effect(() =>
      cli.register({ name: LIST_COMMAND, description: '此刻登记了哪些 node CLI', usage: '无参数', plugin: '@godcreator/gwb-node-cli' }, () =>
        this.registry.list(),
      ),
    )
    this.own.logger(PLUGIN_NAME).info(`node CLI 运行器就绪（ctx.gwbNodeCli）,看表走 ${LIST_COMMAND}`)
    // 说明书**局部注入**：没装 skills 插件的 home 里运行插件照常加载。
    // 构建产物在 dist/ 下，包根的 skills/ 是 '../skills/'；那个目录要写进 package.json 的 files
    this.own.inject(['gwbSkills'], (scoped) => {
      scoped.effect(() => scoped.gwbSkills.register(new URL('../skills/', import.meta.url)))
    })
  }

  /**
   * 登记它的是哪个插件。方法里的 `this.ctx` 是**调用方**的 ctx，`fiber.entry` 是 loader
   * 加上的（不是 cordis 本身的接口），所以按运行时形状取、不改全局类型声明
   */
  private owner(): string {
    const fiber = this.ctx.fiber as unknown as { entry?: { options?: { name?: unknown } } } | undefined
    const name = fiber?.entry?.options?.name
    if (typeof name !== 'string' || name === '') {
      throw new Error('取不到调用方的身份——ctx.gwbNodeCli 只能在经 cordis.yml 挂上的件里用')
    }
    return name
  }

  register(spec: NodeCliSpec): () => void {
    const plugin = this.owner()
    const off = this.registry.register(plugin, spec)
    this.info(`CLI ${spec.name}（${plugin}）登记上了`)
    const cli = this.own.gwbCommands
    // 总线命令的 plugin 归属：spec 给了就用 spec 的，缺省是调用方的包名
    const offCli = cli?.register({ name: spec.name, description: spec.description ?? '', usage: spec.usage ?? INVOKE_SHAPE, plugin: spec.plugin ?? plugin }, (args) => {
      const invocation = parseInvocation(args)
      return this.invoke(spec.name, invocation.args, invocation.cwd)
    })
    const dispose = (): void => {
      off()
      offCli?.()
    }
    // 登记到**调用方**的 effect 上，插件卸载时自动注销。忘了注销的症状是「插件卸了命令还在，
    // 一调就启动一个指向不存在文件的进程」——不报错，所以在这里自动注销
    this.ctx.effect(() => dispose)
    return dispose
  }

  list(): RegisteredNodeCli[] {
    return this.registry.list()
  }

  async run(name: string, extraArgs: readonly string[] = [], opts?: { cwd?: string }): Promise<CliRunOutcome> {
    return this.invoke(name, extraArgs, opts?.cwd)
  }

  /** `run` 与总线命令都走这里。`cwdRaw` 没收窄过——总线传来什么都得先过 `checkCwd` */
  private async invoke(name: string, extraArgs: readonly string[], cwdRaw: unknown): Promise<CliRunOutcome> {
    const found = this.registry.get(name)
    if (found === undefined) throw new Error(`没有这条 node CLI：${name}`)
    // 按次给的 cwd 不合规就不启动进程：错误文本写清要什么，回给调用方读
    const perCall = checkCwd(cwdRaw)
    if (!perCall.ok) {
      this.warn(`${name} 没跑：${perCall.error}`)
      return { ok: false, error: perCall.error }
    }
    // 启动与结束都写日志：一个子进程从启动到结束，日志里要能对得上
    this.info(`跑 ${name}（追加 ${extraArgs.length} 个参数,时限 ${found.timeoutMs}ms）`)
    const result = await runProcess({
      command: process.execPath,
      args: [found.entry, ...found.args, ...extraArgs],
      // 按次给的 > 登记时给的 > 那个 js 所在目录。**不继承内核进程的 cwd**——那是内核的目录，
      // 跟这条命令毫无关系，而且随内核怎么启动而变。要确定的工作目录就自己给
      cwd: perCall.cwd ?? found.cwd ?? path.dirname(found.entry),
      env: { ...ELECTRON_AS_NODE, ...found.env },
      timeoutMs: found.timeoutMs,
    })
    if (result.ok) {
      this.info(`${name} 跑完了：退出码 ${String(result.exitCode)}，耗时 ${result.durationMs}ms`)
    } else if (result.exitCode === null && !result.timedOut) {
      // 启动失败（可执行文件不在之类）：原因 runProcess 写进了 stderr
      this.error(`${name} 起不动：${result.stderr.text.trim().slice(-300) || '没说原因'}`)
    } else if (result.timedOut) {
      this.warn(`${name} 超时（时限 ${result.timeoutMs}ms），整棵进程树已收掉`)
    } else {
      this.warn(`${name} 没跑成：退出码 ${String(result.exitCode)}\n${result.stderr.text.trim().slice(-500)}`)
    }
    return result
  }
}

declare module 'cordis' {
  interface Context {
    gwbNodeCli: GwbNodeCliApi
  }
}

import path from 'node:path'
import { Service } from 'cordis'
import type { GwbContext } from '@godcreator02/gwb-plugin-api'
// 只为激活 commands 件的 `declare module 'cordis'`——它给 ctx 加上 gwbCommands 这个名字
import type {} from '@godcreator02/gwb-commands'
// 只为激活 skills 件的 `declare module 'cordis'`——下面局部注入要用 gwbSkills 这个名字
import type {} from '@godcreator02/gwb-skills'
import { createRegistry, type NodeCliRegistry, type NodeCliSpec, type RegisteredNodeCli } from './registry.js'
import { runProcess, type CliRunResult } from './run.js'

export type { NodeCliSpec, RegisteredNodeCli } from './registry.js'
export type { CliRunResult, CliStream } from './run.js'
export { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from './registry.js'

/**
 * 跑 node 写的 CLI。件把**自己编译出来的**那个 `cli.js` 登记进来，起进程、收输出、
 * 按时限收尾都归这儿——每个件不用各写一遍 spawn 与超时。
 *
 * **argv[0] 一律 `process.execPath`,不查 PATH、不认 bin 垫片、不过 shell。**
 * 装进 node_modules 之后全路径调用,一次根除 Windows 上的引号地狱与带空格的路径。
 *
 * **登记的命令同时挂进 `gwbCommands` 总线**——界面、命令行、agent 从此走同一个口,
 * 所以这个件硬 `inject` 总线:没有它,登记进来的命令出不了这个进程。
 */

/** 此刻登记了哪些 */
export const LIST_COMMAND = 'node-cli.list'

const PLUGIN_NAME = 'gwb-node-cli'

/**
 * 宿主是 electron 当 node 使起来的,所以 `process.execPath` 是 electron.exe——
 * 不带这个变量它会去开一扇窗,而不是跑那个 js。内核起宿主时同一个绕法（见内核仓
 * `host-process.ts`）
 */
const ELECTRON_AS_NODE = { ELECTRON_RUN_AS_NODE: '1' }

/** 消费方拿到的那一格。写 `inject: ['gwbNodeCli']` 才有 */
export interface GwbNodeCliApi {
  /**
   * 登记一条命令。身份不用给——由这儿从调用方的 fiber 上取。
   *
   * 回一个注销函数给要提前摘的场景。**不用自己包 `ctx.effect`**：件卸载时这条命令
   * 自动从表上、也从命令总线上摘掉。
   */
  register(spec: NodeCliSpec): () => void
  /** 此刻表里有哪些条,按登记先后 */
  list(): RegisteredNodeCli[]
  /** 跑一条。`extraArgs` 追加在 spec 的固定参数后面。没这条命令时抛 */
  run(name: string, extraArgs?: readonly string[]): Promise<CliRunResult>
}

/** 总线那头递来的参数：给一串就是追加参数,给 `{ args: [...] }` 也认,别的忽略 */
function toExtraArgs(args?: unknown): string[] {
  if (Array.isArray(args)) return args.map(String)
  if (typeof args === 'object' && args !== null && 'args' in args) {
    const inner = (args as { args?: unknown }).args
    if (Array.isArray(inner)) return inner.map(String)
  }
  return []
}

export default class GwbNodeCli extends Service implements GwbNodeCliApi {
  /** 没有命令总线就不挂——inject 是 cordis 的等待机制,不是建议 */
  static inject = ['gwbCommands']

  /**
   * 注册表本体。**用 TS 的 `private` 不用 `#`**：cordis 给每个消费者派生一份
   * `Object.create(this)`,而 `#` 私有字段的内部槽不在原型链上,派生对象上一读就炸。
   */
  private readonly registry: NodeCliRegistry
  /** 提供方自己的嗓门。构造时 this.ctx 还是自己，logger 绑的是本件 */
  private readonly info: (message: string) => void
  private readonly warn: (message: string) => void
  private readonly error: (message: string) => void
  /**
   * 提供方自己的 ctx。方法里的 `this.ctx` 是**消费者**的,而消费者未必 inject 过
   * `gwbCommands`——往总线上挂命令得用这一份,不然取不到。收尾另说：dispose 挂在消费者的
   * effect 上,消费者卸载时照样摘干净
   */
  private readonly own: GwbContext

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbNodeCli')
    this.own = ctx
    // 构造时 this.ctx 还是**提供方**自己的,logger 绑的是本件
    const logger = ctx.logger(PLUGIN_NAME)
    this.info = (message: string): void => logger.info(message)
    this.warn = (message: string): void => logger.warn(message)
    this.error = (message: string): void => logger.error(message)
    this.registry = createRegistry((message) => this.warn(message))
  }

  /** 服务就绪时把看表那条命令挂上；effect 包着,本件卸载时自动注销 */
  [Service.init](): void {
    const cli = this.own.gwbCommands
    // inject 保证了它在,这句只是把类型收窄
    if (cli === undefined) return

    this.own.effect(() =>
      cli.register({ name: LIST_COMMAND, description: '此刻登记了哪些 node CLI', plugin: PLUGIN_NAME }, () =>
        this.registry.list(),
      ),
    )
    this.own.logger(PLUGIN_NAME).info(`node CLI 运行器就绪（ctx.gwbNodeCli）,看表走 ${LIST_COMMAND}`)
    // 说明书那一格,**局部注入**:没装 skills 件的 home 里运行器照常挂。
    // 产物在 dist/ 下,包根的 skills/ 是 '../skills/';那个目录得进 package.json 的 files
    this.own.inject(['gwbSkills'], (scoped) => {
      scoped.effect(() => scoped.gwbSkills.register(new URL('../skills/', import.meta.url)))
    })
  }

  /**
   * 登记它的是哪个件。方法里的 `this.ctx` 是**消费者**的 ctx,`fiber.entry` 是 loader
   * 挂上的（不是 cordis 本体的面）,所以按运行时形状取、不动全局类型声明
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
    const offCli = cli?.register(
      { name: spec.name, description: spec.description ?? '', plugin },
      (args) => this.run(spec.name, toExtraArgs(args)),
    )
    const dispose = (): void => {
      off()
      offCli?.()
    }
    // 挂在**调用方**的 effect 上,件卸载时自动摘。忘了收的症状是「件卸了命令还在,
    // 一调就跑一个指向不存在文件的进程」——静默的错,这层自动把它消掉
    this.ctx.effect(() => dispose)
    return dispose
  }

  list(): RegisteredNodeCli[] {
    return this.registry.list()
  }

  async run(name: string, extraArgs: readonly string[] = []): Promise<CliRunResult> {
    const found = this.registry.get(name)
    if (found === undefined) throw new Error(`没有这条 node CLI：${name}`)
    // 起跑与收尾都出声:一条子进程从生到死,日志里得能对上账
    this.info(`跑 ${name}（追加 ${extraArgs.length} 个参数,时限 ${found.timeoutMs}ms）`)
    const result = await runProcess({
      command: process.execPath,
      args: [found.entry, ...found.args, ...extraArgs],
      // 不给就落在那个 js 自己旁边。**不继承宿主的 cwd**——那是内核的目录,跟这条命令毫无关系,
      // 而且随内核怎么起而变。要确定的工作目录就自己给 cwd
      cwd: found.cwd ?? path.dirname(found.entry),
      env: { ...ELECTRON_AS_NODE, ...found.env },
      timeoutMs: found.timeoutMs,
    })
    if (result.ok) {
      this.info(`${name} 跑完了：退出码 ${String(result.exitCode)}，耗时 ${result.durationMs}ms`)
    } else if (result.exitCode === null && !result.timedOut) {
      // 起不来（可执行文件不在之类）：原因 runProcess 收进了 stderr
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

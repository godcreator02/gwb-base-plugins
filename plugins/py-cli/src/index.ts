import path from 'node:path'
import { Service } from 'cordis'
import type { GwbContext } from '@godcreator02/gwb-plugin-api'
// 只为激活 commands 件的 `declare module 'cordis'`——它给 ctx 加上 gwbCommands 这个名字
import type {} from '@godcreator02/gwb-commands'
import { ensureVenv, venvPaths, type BootstrapResult } from './bootstrap.js'
import { createRegistry, type PyCliRegistry, type PyCliSpec, type RegisteredPyCli } from './registry.js'
import { runProcess, type CliRunResult } from './run.js'

export type { PyCliSpec, RegisteredPyCli } from './registry.js'
export type { CliRunResult, CliStream } from './run.js'
export type { BootstrapResult, VenvPaths } from './bootstrap.js'
export { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from './registry.js'
export { STAMP_NAME, venvPaths } from './bootstrap.js'

/**
 * 跑 python 写的 CLI。**消费方件**的包根下带一个 python 项目（`py/`），守卫用 uv 在那儿
 * 建一个 venv——件装在 `node_modules` 里，venv 也就在 `node_modules` 里——然后 spawn venv
 * 里的可执行文件。这个件自己不带任何 python 项目，它只做运行器。
 *
 * **守卫是幂等的,而且每次跑命令之前都过一遍**：已经好了就是三次 fs 调用、零进程；
 * venv 被外力抹掉了（`pnpm install` 重解整个 `.pnpm/<hash>` 目录就会）当场重建。
 * 自愈不是单独一条路径,它就是守卫本身。
 *
 * **登记的命令同时挂进 `gwbCommands` 总线**,所以这个件硬 `inject` 总线。
 */

/** 此刻登记了哪些 */
export const LIST_COMMAND = 'py-cli.list'

const PLUGIN_NAME = 'gwb-py-cli'

/**
 * 给 python 子进程的两条。机器级 `PYTHONUTF8=1` 是本生态的前提,这儿再注一遍是
 * 零成本的兜底——少了它 Windows 上中文输出就是一片乱码,而且报错报得莫名其妙
 */
const PY_ENV = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }

/** 消费方拿到的那一格。写 `inject: ['gwbPyCli']` 才有 */
export interface GwbPyCliApi {
  /**
   * 校验一次 venv：不在就建、版本对不上就同步、已经好了就跳过。**幂等**。
   *
   * 不抛——uv 不在 PATH、同步没成，一律收敛成 `{ ready: false, reason }`。
   * 同一个包根上并发调只会真跑一趟。
   */
  ensureReady(opts: { packageRoot: string; distName: string; version: string }): Promise<BootstrapResult>
  /**
   * 登记一条命令。身份不用给——由这儿从调用方的 fiber 上取。
   *
   * 顺手发起一次守卫（不挡着件挂上）。回一个注销函数给要提前摘的场景，
   * **不用自己包 `ctx.effect`**：件卸载时这条命令自动从表上、也从命令总线上摘掉。
   */
  register(spec: PyCliSpec): () => void
  /** 此刻表里有哪些条,按登记先后 */
  list(): RegisteredPyCli[]
  /** 跑一条。跑之前守卫过一遍,所以 venv 没了会当场重建。没这条命令时抛 */
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

export default class GwbPyCli extends Service implements GwbPyCliApi {
  /** 没有命令总线就不挂——inject 是 cordis 的等待机制,不是建议 */
  static inject = ['gwbCommands']

  /**
   * 注册表本体。**用 TS 的 `private` 不用 `#`**：cordis 给每个消费者派生一份
   * `Object.create(this)`,而 `#` 私有字段的内部槽不在原型链上,派生对象上一读就炸。
   */
  private readonly registry: PyCliRegistry
  /** 提供方自己的 ctx。往总线上挂命令得用这一份——消费者未必 inject 过 gwbCommands */
  private readonly own: GwbContext
  /** 正在跑的守卫,按包根去重。并发调 run 时不该同时起两个 uv sync */
  private readonly inflight = new Map<string, Promise<BootstrapResult>>()

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbPyCli')
    this.own = ctx
    // 构造时 this.ctx 还是**提供方**自己的,logger 绑的是本件
    this.registry = createRegistry((message) => ctx.logger(PLUGIN_NAME).warn(message))
  }

  /** 服务就绪时把看表那条命令挂上；effect 包着,本件卸载时自动注销 */
  [Service.init](): void {
    const cli = this.own.gwbCommands
    // inject 保证了它在,这句只是把类型收窄
    if (cli === undefined) return

    this.own.effect(() =>
      cli.register({ name: LIST_COMMAND, description: '此刻登记了哪些 python CLI', plugin: PLUGIN_NAME }, () =>
        this.registry.list(),
      ),
    )
    this.own.logger(PLUGIN_NAME).info(`python CLI 运行器就绪（ctx.gwbPyCli）,看表走 ${LIST_COMMAND}`)
  }

  /** 守卫一趟并把结果说出来。日志的措辞就是实机验收时要看的那一行 */
  private async bootstrap(
    record: Pick<RegisteredPyCli, 'packageRoot' | 'distName' | 'version' | 'name'>,
    logger: { info: (m: string) => void; warn: (m: string) => void },
  ): Promise<BootstrapResult> {
    const result = await this.ensureReady(record)
    if (result.ready) {
      logger.info(result.action === 'skipped' ? `venv 已就绪,跳过：${record.name}` : `venv 建好了：${record.name}`)
    } else {
      logger.warn(`venv 没就绪,${record.name} 跑不了：${result.reason ?? '没说原因'}`)
    }
    return result
  }

  async ensureReady(opts: { packageRoot: string; distName: string; version: string }): Promise<BootstrapResult> {
    const key = path.resolve(opts.packageRoot)
    const running = this.inflight.get(key)
    if (running !== undefined) return running

    const task = ensureVenv({
      packageRoot: opts.packageRoot,
      distName: opts.distName,
      version: opts.version,
      log: (message) => this.own.logger(PLUGIN_NAME).info(message),
    }).finally(() => {
      this.inflight.delete(key)
    })
    this.inflight.set(key, task)
    return task
  }

  /**
   * 登记它的是哪个件。方法里的 `this.ctx` 是**消费者**的 ctx,`fiber.entry` 是 loader
   * 挂上的（不是 cordis 本体的面）,所以按运行时形状取、不动全局类型声明
   */
  private owner(): string {
    const fiber = this.ctx.fiber as unknown as { entry?: { options?: { name?: unknown } } } | undefined
    const name = fiber?.entry?.options?.name
    if (typeof name !== 'string' || name === '') {
      throw new Error('取不到调用方的身份——ctx.gwbPyCli 只能在经 cordis.yml 挂上的件里用')
    }
    return name
  }

  register(spec: PyCliSpec): () => void {
    const plugin = this.owner()
    const off = this.registry.register(plugin, spec)
    const record = this.registry.get(spec.name)!
    const cli = this.own.gwbCommands
    const offCli = cli?.register({ name: spec.name, description: spec.description ?? '', plugin }, (args) =>
      this.run(spec.name, toExtraArgs(args)),
    )
    const dispose = (): void => {
      off()
      offCli?.()
    }
    // 挂在**调用方**的 effect 上,件卸载时自动摘
    this.ctx.effect(() => dispose)
    // 顺手把它的 venv 建起来,不挡着调用方的 apply 往下走
    void this.bootstrap(record, this.own.logger(PLUGIN_NAME))
    return dispose
  }

  list(): RegisteredPyCli[] {
    return this.registry.list()
  }

  async run(name: string, extraArgs: readonly string[] = []): Promise<CliRunResult> {
    const found = this.registry.get(name)
    if (found === undefined) throw new Error(`没有这条 python CLI：${name}`)
    return this.runRecord(found, extraArgs)
  }

  /**
   * 真正跑一条。**先守卫再跑**——幂等，已就绪时只是三次 fs 调用；venv 被外力抹掉时
   * 当场重建。自愈就是这一句，没有单独的重试路径。
   */
  private async runRecord(record: RegisteredPyCli, extraArgs: readonly string[]): Promise<CliRunResult> {
    const ready = await this.ensureReady(record)
    if (!ready.ready) {
      throw new Error(`venv 没就绪,${record.name} 跑不了：${ready.reason ?? '没说原因'}`)
    }
    const paths = venvPaths(record.packageRoot)
    // Scripts 与 .exe 是 Windows 专属——Windows-only 是本生态的分发前提,见 bootstrap 的头注
    const command =
      record.command !== undefined
        ? path.join(paths.scriptsDir, `${record.command}.exe`)
        : path.join(paths.scriptsDir, 'python.exe')
    const prefix = record.module !== undefined ? ['-m', record.module] : []
    return runProcess({
      command,
      args: [...prefix, ...record.args, ...extraArgs],
      cwd: record.cwd ?? paths.projectDir,
      env: { ...PY_ENV, ...record.env },
      timeoutMs: record.timeoutMs,
    })
  }
}

declare module 'cordis' {
  interface Context {
    gwbPyCli: GwbPyCliApi
  }
}

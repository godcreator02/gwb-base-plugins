import path from 'node:path'
import { Service } from 'cordis'
import type { GwbContext } from '@godcreator/gwb-plugin-api'
// 只为激活 commands 件的 `declare module 'cordis'`——它给 ctx 加上 gwbCommands 这个名字
import type {} from '@godcreator/gwb-commands'
// 只为激活 skills 件的 `declare module 'cordis'`——下面局部注入要用 gwbSkills 这个名字
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

/**
 * 每条登记进总线的命令，描述末尾都带这一句：agent 只看描述就得知道参数怎么给。
 * 写在这儿而不是让每个消费方件自己写，是因为形状是运行器定的，件只定它自己那半
 */
const INVOKE_SHAPE =
  '参数 { args?: string[], cwd?: string }：args 追加在固定参数后（直接给一串也当 args）；' +
  'cwd 要是存在的目录的绝对路径，缺省落在包根的 py/ 下'

/** 一次调用被拒（cwd 不合规之类）：没起进程，回一句说清要什么的话 */
export interface CliRunRefused {
  ok: false
  error: string
}

/** `run` 回的两种：跑过了（进程回执）或没跑（被拒） */
export type CliRunOutcome = CliRunResult | CliRunRefused

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
  /**
   * 跑一条。跑之前守卫过一遍,所以 venv 没了会当场重建。`opts.cwd` 是**按次**给的工作目录，
   * 必须是存在的目录的绝对路径，不合规**不抛**、回 `{ ok: false, error }`（`spec.cwd` 仍是缺省）。
   * 没这条命令时抛
   */
  run(name: string, extraArgs?: readonly string[], opts?: { cwd?: string }): Promise<CliRunOutcome>
}

/** 挂进总线的描述：件写的那半在前，运行器定的参数形状在后 */
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
  /** 提供方自己的嗓门。构造时 this.ctx 还是自己，logger 绑的是本件 */
  private readonly info: (message: string) => void
  private readonly warn: (message: string) => void
  private readonly error: (message: string) => void
  /** 正在跑的守卫,按包根去重。并发调 run 时不该同时起两个 uv sync */
  private readonly inflight = new Map<string, Promise<BootstrapResult>>()

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbPyCli')
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
      cli.register({ name: LIST_COMMAND, description: '此刻登记了哪些 python CLI', usage: '无参数', plugin: '@godcreator/gwb-py-cli' }, () =>
        this.registry.list(),
      ),
    )
    this.own.logger(PLUGIN_NAME).info(`python CLI 运行器就绪（ctx.gwbPyCli）,看表走 ${LIST_COMMAND}`)
    // 说明书那一格,**局部注入**:没装 skills 件的 home 里运行器照常挂。
    // 产物在 dist/ 下,包根的 skills/ 是 '../skills/';那个目录得进 package.json 的 files
    this.own.inject(['gwbSkills'], (scoped) => {
      scoped.effect(() => scoped.gwbSkills.register(new URL('../skills/', import.meta.url)))
    })
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
    this.info(`CLI ${spec.name}（${plugin}）登记上了`)
    const record = this.registry.get(spec.name)!
    const cli = this.own.gwbCommands
    const offCli = cli?.register({ name: spec.name, description: spec.description ?? '', usage: spec.usage ?? INVOKE_SHAPE, plugin }, (args) => {
      const invocation = parseInvocation(args)
      return this.invoke(spec.name, invocation.args, invocation.cwd)
    })
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

  async run(name: string, extraArgs: readonly string[] = [], opts?: { cwd?: string }): Promise<CliRunOutcome> {
    return this.invoke(name, extraArgs, opts?.cwd)
  }

  /** `run` 与总线那条路同吃这一处。`cwdRaw` 是没收窄过的——总线递来什么都得先过 `checkCwd` */
  private async invoke(name: string, extraArgs: readonly string[], cwdRaw: unknown): Promise<CliRunOutcome> {
    const found = this.registry.get(name)
    if (found === undefined) throw new Error(`没有这条 python CLI：${name}`)
    // 按次的 cwd 不合规就不起进程、也不跑守卫：错误文本就是文档,回去让调用方读
    const perCall = checkCwd(cwdRaw)
    if (!perCall.ok) {
      this.warn(`${name} 没跑：${perCall.error}`)
      return { ok: false, error: perCall.error }
    }
    return this.runRecord(found, extraArgs, perCall.cwd)
  }

  /**
   * 真正跑一条。**先守卫再跑**——幂等，已就绪时只是三次 fs 调用；venv 被外力抹掉时
   * 当场重建。自愈就是这一句，没有单独的重试路径。
   */
  private async runRecord(record: RegisteredPyCli, extraArgs: readonly string[], cwd: string | undefined): Promise<CliRunResult> {
    const ready = await this.ensureReady(record)
    if (!ready.ready) {
      // register 时那趟守卫有日志,run 时这道重验过去静默抛——venv 坏了的现场得留一句
      this.warn(`venv 没就绪,${record.name} 跑不了：${ready.reason ?? '没说原因'}`)
      throw new Error(`venv 没就绪,${record.name} 跑不了：${ready.reason ?? '没说原因'}`)
    }
    const paths = venvPaths(record.packageRoot)
    // Scripts 与 .exe 是 Windows 专属——Windows-only 是本生态的分发前提,见 bootstrap 的头注
    const command =
      record.command !== undefined
        ? path.join(paths.scriptsDir, `${record.command}.exe`)
        : path.join(paths.scriptsDir, 'python.exe')
    const prefix = record.module !== undefined ? ['-m', record.module] : []
    // 起跑与收尾都出声:一条子进程从生到死,日志里得能对上账
    this.info(`跑 ${record.name}（追加 ${extraArgs.length} 个参数,时限 ${record.timeoutMs}ms）`)
    const result = await runProcess({
      command,
      args: [...prefix, ...record.args, ...extraArgs],
      // 按次给的 > 登记时给的 > 那个 python 项目目录
      cwd: cwd ?? record.cwd ?? paths.projectDir,
      env: { ...PY_ENV, ...record.env },
      timeoutMs: record.timeoutMs,
    })
    if (result.ok) {
      this.info(`${record.name} 跑完了：退出码 ${String(result.exitCode)}，耗时 ${result.durationMs}ms`)
    } else if (result.exitCode === null && !result.timedOut) {
      // 起不来（可执行文件不在之类）：原因 runProcess 收进了 stderr
      this.error(`${record.name} 起不动：${result.stderr.text.trim().slice(-300) || '没说原因'}`)
    } else if (result.timedOut) {
      this.warn(`${record.name} 超时（时限 ${result.timeoutMs}ms），整棵进程树已收掉`)
    } else {
      this.warn(`${record.name} 没跑成：退出码 ${String(result.exitCode)}\n${result.stderr.text.trim().slice(-500)}`)
    }
    return result
  }
}

declare module 'cordis' {
  interface Context {
    gwbPyCli: GwbPyCliApi
  }
}

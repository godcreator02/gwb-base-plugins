import { Service } from 'cordis'
import type { GwbContext } from '@godcreator02/gwb-plugin-api'
// 只为激活 commands 件的 `declare module 'cordis'`——它给 ctx 加上 gwbCommands 这个名字
import type {} from '@godcreator02/gwb-commands'
import { createPaneRegistry, type PaneOwner, type PaneRegistry, type PaneSpec, type RegisteredPane } from './pane-registry.js'
import { createPluginRegistry, type PluginInfo, type PluginRegistry, type RegisteredPlugin } from './plugin-registry.js'

export type { PaneSpec, PaneOwner, RegisteredPane } from './pane-registry.js'
export type { PluginInfo, RegisteredPlugin } from './plugin-registry.js'

/**
 * node 半：窗格注册服务。件在自己的 `apply` 里说「我有一格窗格」，浏览器那半经
 * `shell.panes` 这条命令把表取过去。
 *
 * **为什么是运行时注册而不是包清单里静态声明**：判据见内核仓 decisions。简单说，
 * cordis 下件挂上时它的 node 半就在跑了，注册发生在 `apply` 里，而 `client.js` 仍然
 * 是点了才动态 import——动态注册一分懒加载都没牺牲。
 *
 * **为什么表要经命令过桥**：内核的 fd3 派发除两条自省命令外一律走 `ctx.gwbCommands`，
 * 内核本体不认识任何件的命令名。所以这个件硬 `inject` 命令总线：没有它，注册表出不了
 * 这个进程，外壳就是个开不出任何东西的空井——那种时候不如不挂，cordis 会在日志里
 * 明说它在等谁。
 */

/** 浏览器半取表的两条命令。注册与调用两处同吃这两个常量 */
export const PANES_COMMAND = 'shell.panes'
export const PLUGINS_COMMAND = 'shell.plugins'

/** 消费方拿到的那一格。写 `inject: ['gwbShell']` 才有 */
export interface GwbShellApi {
  /**
   * 注册一格窗格。身份不用给——`pkg` 与 `entryId` 由这儿从调用方的 fiber 上取。
   *
   * 回一个注销函数给要提前摘的场景。**不用自己包 `ctx.effect`**：件卸载时这一格
   * 自动从表上摘掉。
   */
  registerPane(spec: PaneSpec): () => void
  /**
   * 报一下自己叫什么。给人看的名字归运行时，不进包清单——包清单里那种字段没人读的
   * 时候没有任何机制会发现（`gwb.title` 就这么死了一阵）。
   *
   * 收尾同 `registerPane`：件卸载时自动从表上摘掉。
   */
  describeSelf(info: PluginInfo): () => void
  /** 此刻表里有哪些格，按注册先后 */
  panes(): RegisteredPane[]
  /** 此刻有哪些件报过名字，按报名先后 */
  plugins(): RegisteredPlugin[]
}

export default class GwbShell extends Service implements GwbShellApi {
  /** 没有命令总线就不挂——inject 是 cordis 的等待机制，不是建议 */
  static inject = ['gwbCommands']

  /**
   * 注册表本体。**用 TS 的 `private` 不用 `#`**：cordis 给每个消费者派生一份
   * `Object.create(this)`，而 `#` 私有字段的内部槽不在原型链上，派生对象上一读就炸。
   */
  private readonly registry: PaneRegistry
  /** 件级信息另一张表：键是 entryId，一条条目至多一条。判据见 plugin-registry 的头注 */
  private readonly plugentry: PluginRegistry

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbShell')
    // 构造时 this.ctx 还是**提供方**自己的，logger 绑的是本件
    const warn = (message: string): void => ctx.logger('gwb-shell').warn(message)
    this.registry = createPaneRegistry(warn)
    this.plugentry = createPluginRegistry(warn)
  }

  /** 服务就绪时把取表那两条命令挂上；effect 包着，本件卸载时自动注销 */
  [Service.init](): void {
    const cli = this.ctx.gwbCommands
    // inject 保证了它在，这句只是把类型收窄
    if (cli === undefined) return
    this.ctx.effect(() =>
      cli.register(
        { name: PANES_COMMAND, description: '此刻注册了哪些窗格', plugin: 'gwb-shell' },
        () => this.registry.list(),
      ),
    )
    this.ctx.effect(() =>
      cli.register(
        { name: PLUGINS_COMMAND, description: '此刻有哪些件报过名字', plugin: 'gwb-shell' },
        () => this.plugentry.list(),
      ),
    )
    this.ctx.logger('gwb-shell').info(`窗格注册就绪（ctx.gwbShell），取表走 ${PANES_COMMAND} 与 ${PLUGINS_COMMAND}`)
  }

  /**
   * 取它的是哪个件。方法里的 `this.ctx` 是**消费者**的 ctx，`fiber.entry` 是 loader
   * 挂上的（不是 cordis 本体的面），所以按运行时形状取、不动全局类型声明。
   *
   * 两样都要：`pkg` 认得出是哪个包，但同一个包挂两条条目时只有 `entryId` 分得开它们。
   */
  private owner(): PaneOwner {
    const fiber = this.ctx.fiber as unknown as { entry?: { id?: unknown; options?: { name?: unknown } } } | undefined
    const entry = fiber?.entry
    const entryId = entry?.id
    const pkg = entry?.options?.name
    if (typeof entryId !== 'string' || entryId === '' || typeof pkg !== 'string' || pkg === '') {
      throw new Error('取不到调用方的身份——ctx.gwbShell 只能在经 cordis.yml 挂上的件里用')
    }
    return { entryId, pkg }
  }

  registerPane(spec: PaneSpec): () => void {
    const off = this.registry.register(this.owner(), spec)
    // 挂在**调用方**的 effect 上（this.ctx 在方法里是消费者的），件卸载时自动摘。
    // 忘了收的症状是「件卸了格还在，点开是个死格」——静默的错，这层自动把它消掉
    this.ctx.effect(() => off)
    return off
  }

  describeSelf(info: PluginInfo): () => void {
    const off = this.plugentry.describe(this.owner(), info)
    this.ctx.effect(() => off)
    return off
  }

  panes(): RegisteredPane[] {
    return this.registry.list()
  }

  plugins(): RegisteredPlugin[] {
    return this.plugentry.list()
  }
}

declare module 'cordis' {
  interface Context {
    gwbShell: GwbShellApi
  }
}

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Service } from 'cordis'
import { requireKernel, type GwbContext, type GwbKernelApi } from '@godcreator02/gwb-plugin-api'
// 只为激活 commands 件的 `declare module 'cordis'`——它给 ctx 加上 gwbCommands 这个名字
import type {} from '@godcreator02/gwb-commands'
// 同一个道理，给 ctx 加上 gwbData：布局档经它落进 home
import type {} from '@godcreator02/gwb-data'
import { createPaneRegistry, type PaneOwner, type PaneRegistry, type PaneSpec, type RegisteredPane } from './pane-registry.js'
import { createPluginRegistry, type PluginInfo, type PluginRegistry, type RegisteredPlugin } from './plugin-registry.js'
import { LAYOUT_DOC, LAYOUT_GET_COMMAND, LAYOUT_SAVE_COMMAND, parseLayoutDoc } from './layout.js'
import { electronWindows, reloadWindows, type ReloadDeps } from './reload.js'

export type { PaneSpec, PaneOwner, RegisteredPane } from './pane-registry.js'
export type { PluginInfo, RegisteredPlugin } from './plugin-registry.js'
export type { SavedLayout, LayoutDoc } from './layout.js'

/**
 * node 半：窗格注册服务。件在自己的 `apply` 里说「我有一格窗格」，浏览器那半经
 * `shell.panes` 这条命令把表取过去。
 *
 * **为什么是运行时注册而不是包清单里静态声明**：判据见内核仓 decisions。简单说，
 * cordis 下件挂上时它的 node 半就在跑了，注册发生在 `apply` 里，而 `client.js` 仍然
 * 是点了才动态 import——动态注册一分懒加载都没牺牲。
 *
 * **为什么表要经命令过桥**：内核那条命令桥一律派给 `ctx.gwbCommands`，
 * 内核本体不认识任何件的命令名。所以这个件硬 `inject` 命令总线：没有它，注册表出不了
 * 这个进程，外壳就是个开不出任何东西的空井——那种时候不如不挂，cordis 会在日志里
 * 明说它在等谁。
 */

/** 浏览器半取表的两条命令。注册与调用两处同吃这两个常量 */
export const PANES_COMMAND = 'shell.panes'
export const PLUGINS_COMMAND = 'shell.plugins'
/** 布局档的两条命令。常量本体住 `layout.ts`（那是个纯模块，浏览器半 import 它不带 cordis） */
export { LAYOUT_GET_COMMAND, LAYOUT_SAVE_COMMAND } from './layout.js'

/**
 * 浏览器半开机问一次的环境：home 与三张样式表的 `file://` 地址。**由 node 半算**：本包的从
 * `import.meta.url` 算，令牌表按包解析。importmap 不在这儿——那是内核的事（浏览器半的取址），
 * 页面注完表才 import 本件的浏览器半。
 */
export const ENV_COMMAND = 'shell.env'

/**
 * 整页重载全部窗口。给命令面的——`plugins.update-all` 热升完靠它让页面重新 import 新束、
 * 重注 importmap；状态栏那颗「刷新」是同一件事的人手版。做法在 `reload.ts`
 */
export const RELOAD_COMMAND = 'shell.reload'

export interface ShellEnv {
  home: string
  /** 按序加载：令牌表、dockview 表、本件自己的表 */
  styles: string[]
}

const nodeRequire = createRequire(import.meta.url)
const fileUrl = (spec: string): string => pathToFileURL(nodeRequire.resolve(spec)).href

function shellEnv(home: string): ShellEnv {
  return {
    home,
    styles: [
      fileUrl('@godcreator02/gwb-tokens/theme.css'),
      new URL('./dockview.css', import.meta.url).href,
      new URL('./style.css', import.meta.url).href,
    ],
  }
}

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
  /**
   * 两个都是硬等待——inject 是 cordis 的等待机制，不是建议。没有命令总线，注册表出不了
   * 这个进程；没有 data 件，布局档没地方落，布局就活不过一次重启。
   */
  static inject = ['gwbCommands', 'gwbData']

  /**
   * 注册表本体。**用 TS 的 `private` 不用 `#`**：cordis 给每个消费者派生一份
   * `Object.create(this)`，而 `#` 私有字段的内部槽不在原型链上，派生对象上一读就炸。
   */
  private readonly registry: PaneRegistry
  /** 件级信息另一张表：键是 entryId，一条条目至多一条。判据见 plugin-registry 的头注 */
  private readonly plugentry: PluginRegistry
  /** 提供方自己的嗓门。构造时 this.ctx 还是自己，logger 绑的是本件 */
  private readonly info: (message: string) => void
  /** 内核那三个名字。构造时取——那时 this.ctx 还是提供方自己的 */
  private readonly kernel: GwbKernelApi

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbShell')
    this.kernel = requireKernel(ctx)
    // 构造时 this.ctx 还是**提供方**自己的，logger 绑的是本件
    const logger = ctx.logger('gwb-shell')
    const warn = (message: string): void => logger.warn(message)
    this.info = (message: string): void => logger.info(message)
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
        { name: PANES_COMMAND, description: '此刻注册了哪些窗格。无参数', plugin: 'gwb-shell' },
        () => this.registry.list(),
      ),
    )
    this.ctx.effect(() =>
      cli.register(
        { name: PLUGINS_COMMAND, description: '此刻有哪些件报过名字。无参数', plugin: 'gwb-shell' },
        () => this.plugentry.list(),
      ),
    )
    this.ctx.effect(() =>
      cli.register(
        { name: LAYOUT_GET_COMMAND, description: '外壳的布局档（当前布局＋已存清单），没存过回 null。无参数', plugin: 'gwb-shell' },
        () => this.ctx.gwbData.readDoc(LAYOUT_DOC),
      ),
    )
    this.ctx.effect(() =>
      cli.register(
        { name: LAYOUT_SAVE_COMMAND, description: '整份替换外壳的布局档。参数是整份布局档 { v, current, saved }（shell.layout.get 回的那个形状）', plugin: 'gwb-shell' },
        (args) => {
          // 存这头也过一遍形状：浏览器半自己的 bug 拼出坏档，不该有资格盖掉盘上那份好的
          const doc = parseLayoutDoc(args)
          if (doc === null) return { ok: false, error: '布局档形状不对，不落盘' }
          // registry.run 会 await 这个 promise，落盘的成败进回执
          return this.ctx.gwbData.writeDoc(LAYOUT_DOC, doc).then(() => undefined)
        },
      ),
    )
    const env = shellEnv(this.kernel.dataDir)
    this.ctx.effect(() =>
      cli.register({ name: ENV_COMMAND, description: '外壳浏览器半开机要的环境（home 与样式表的地址）。无参数', plugin: 'gwb-shell' }, () => env),
    )
    this.ctx.effect(() =>
      cli.register(
        {
          name: RELOAD_COMMAND,
          description: '整页重载全部窗口（BrowserWindow.webContents.reload）：装了新件、热升之后让页面重取注册表、重注 importmap。没有窗口回 ok:false。无参数',
          plugin: 'gwb-shell',
        },
        async () => {
          let deps: ReloadDeps
          try {
            deps = await electronWindows()
          } catch (err: unknown) {
            return { ok: false, error: `拿不到 electron 的窗口列表：${String(err)}` }
          }
          const result = reloadWindows(deps)
          if (result.ok) this.info(`整页重载了 ${String(result.reloaded)} 扇窗口`)
          return result
        },
      ),
    )
    // 把页面根要过来。入口是本包的 client.js，effect 包着：本件卸载页面根自动收回
    const entry = new URL('./client.js', import.meta.url).href
    this.ctx.effect(() => this.kernel.setShell(entry))
    this.ctx.logger('gwb-shell').info(
      `窗格注册就绪（ctx.gwbShell），取表走 ${PANES_COMMAND} 与 ${PLUGINS_COMMAND}，布局档走 ${LAYOUT_GET_COMMAND} 与 ${LAYOUT_SAVE_COMMAND}，整页重载走 ${RELOAD_COMMAND}；页面根已要来，入口 ${entry}`,
    )
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
    const owner = this.owner()
    const off = this.registry.register(owner, spec)
    // 「哪格窗格是谁的」是注册表最基本的账：过去只有撞名才出声，挂上了反而无声
    this.info(`窗格 ${spec.id}（${spec.title}）登记上了（${owner.pkg}）`)
    // 挂在**调用方**的 effect 上（this.ctx 在方法里是消费者的），件卸载时自动摘。
    // 忘了收的症状是「件卸了格还在，点开是个死格」——静默的错，这层自动把它消掉
    this.ctx.effect(() => off)
    return off
  }

  describeSelf(info: PluginInfo): () => void {
    const owner = this.owner()
    const off = this.plugentry.describe(owner, info)
    this.info(`${owner.pkg} 报了名字：${info.title}`)
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

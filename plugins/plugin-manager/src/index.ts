import { Service } from 'cordis'
import { isRecord, requireKernel, type GwbContext, type GwbResult } from '@godcreator02/gwb-plugin-api'
// 这几条 type import 只为激活对方的 `declare module 'cordis'`——它们给 ctx 加上那几个名字
// （commands 那条另带一个类型：一键热升要攥着总线的引用）。这些件在这儿**都是可选的**，
// 所以都走嵌套注入、都写 dev
import type { GwbCommands } from '@godcreator02/gwb-commands'
import type {} from '@godcreator02/gwb-data'
import type {} from '@godcreator02/gwb-settings'
import type {} from '@godcreator02/gwb-skills'
import { readHomeDependencies, readInstalledManifest, readPeerManifest, readSharedPackages } from './home.js'
import { assertId, assertPkgName, bareId, defaultIdFor, installSpec, uniqueId } from './ids.js'
import { readEntries, reconcile, toLabels, type PluginPackageView } from './inventory.js'
import { peerKindOf, planPeers, toPeerDependencies, type PeerKind } from './peers.js'
import { locatePnpm, runPnpm, runPnpmCapture } from './pnpm.js'
import { parseOutdated, type UpdateInfo } from './outdated.js'
import { isGwbLine, parseSearch, type SearchRow } from './search.js'
import { entriesForPackage } from './uninstall.js'
import { ownEntryId, treeOf, type EntryTreeLike } from './tree.js'
import { fiberStateOf, planUpdateAll, settleFiber, type PlannedEntry } from './update-all.js'

export type { EntrySnapshot, PluginEntryView, PluginPackageView } from './inventory.js'
export type { PeerKind, PeerPlanItem } from './peers.js'

/**
 * 管 home 里的**包**和 `cordis.yml` 里的**条目**。
 *
 * 两样东西是两回事，这个件的全部工作就是把它们对起来：包由 pnpm 装进 home，条目由
 * loader 写进 `cordis.yml`——**装了包不加条目等于什么都没发生**，而 home 里还躺着一批
 * 永远不该有条目的共享包。
 *
 * **装（`install`）还顺带一件事：把该进 home 的 peer 也装成 home 的直接依赖。** 件依赖一个
 * 会独立升级、只读文件不 import 代码的包时，那个包得在 home 的 `package.json` 里才有
 * `<home>/node_modules/<包名>` 那条会被 pnpm 改指的 junction——pnpm 自动补的 peer 只进
 * `.pnpm/`，`pnpm outdated` 看不见、`update-all` 也升不到。判据与实测在 `peers.ts`。
 * **卸载时不动 peer**：代价不对称——残留一个没人用的包只是占磁盘，误删一个还有件在用的
 * 包是运行时故障。所以 `uninstall` 不去追谁还在用它，这不是漏了。
 *
 * **卸载（`uninstall`）= 条目与包一起走人**，设置与数据留盘。第一版刻意不做卸载
 * （「删包比留着危险」），2026-09-08 推翻——装卸检升都齐了、独缺「拿掉」，而危险那半
 * 有解：先摘条目后卸包，pnpm 失败报一句不回滚（改判记在件仓文档站 decisions）。只摘
 * 一条条目、包留着，走 `removeEntry`——两个动作分工，不是同一个的两种写法。
 *
 * **可装什么**走 registry 检索（`search`，npm 标准协议、基址从 pnpm 配置来——装从哪来
 * 搜就到哪去；原先是一份手工白名单，2026-09-08 一天内两改：先随市场件并入，同日白名单
 * 也退了场），「装」这个动作也归这个件（`install`）。外加查新版本（`outdated`）与升到
 * 最新（`update`，**不建条目**——条目引的是包名，包换版本条目原样有效）。
 *
 * **一键热升（`updateAll`）= 一趟 pnpm 升完全部过期包，再逐条停用→启用重挂，不重启。**
 * 计划（谁升、谁重挂、谁最后）是 `update-all.ts` 里的纯函数；这儿只按计划执行。升级与
 * 重挂必须在**同一条命令**里做完：pnpm 会删旧版本目录，中间留一条命令的窗口，旧件读盘
 * 就读空。本件自己那条条目排最后、回执之后才动——处理器里停用自己等于把回执一起拔掉。
 *
 * **改名史**：原 `gwb-plugins`（包 `@godcreator02/gwb-plugins`），2026-09-12 断代改名为
 * `plugin-manager`——浏览器半（`src/client/` 那格窗格）随三仓拆分搬去
 * `@godcreator02/gwb-baseui`，本件只剩 node 半的服务与命令。旧包名在 registry 上弃用，
 * 新包从 0.1.0 起；**操作面板住 `@godcreator02/gwb-baseui`**。
 */

/** 停用/启用之后等 fiber 把手头的事做完，最多等这么久。到点就走，读到什么状态报什么 */
const SETTLE_MS = 5_000

/** 外壳的整页重载命令。**按名探**，不 import 外壳的常量——那会把 shell 变成运行时依赖 */
const SHELL_RELOAD_COMMAND = 'shell.reload'

const NAME = 'gwb-plugin-manager'

/** 显示名落在本件自己的数据里，一份 裸 id → label 的文档 */
const LABELS_DOC = 'labels'

/**
 * pnpm 装在哪。**home 级**——设置没有机器级，home 自持全部配置；换个 home 重填一次，
 * 或者把旧 home 的 settings.json 里那一行抄过去。
 */
const PNPM_PATH_KEY = 'pnpm-path'

export const LIST_COMMAND = 'plugin-manager.list'
export const INSTALL_COMMAND = 'plugin-manager.install'
export const ADD_ENTRY_COMMAND = 'plugin-manager.add-entry'
export const REMOVE_ENTRY_COMMAND = 'plugin-manager.remove-entry'
export const ENABLE_COMMAND = 'plugin-manager.enable'
export const DISABLE_COMMAND = 'plugin-manager.disable'
export const SET_LABEL_COMMAND = 'plugin-manager.set-label'
export const OUTDATED_COMMAND = 'plugin-manager.outdated'
export const UPDATE_COMMAND = 'plugin-manager.update'
export const UPDATE_ALL_COMMAND = 'plugin-manager.update-all'
export const SEARCH_COMMAND = 'plugin-manager.search'
export const UNINSTALL_COMMAND = 'plugin-manager.uninstall'
export const SHARED_COMMAND = 'plugin-manager.shared'

/** 装件时顺带处理的一条 peer。判据与理由在 `peers.ts` */
export interface PeerResult {
  pkg: string
  /** 件的清单里给它写的版本范围。**装的是 latest**，对不上时人一眼看得见 */
  range: string
  /**
   * `installed` 这次装成了 home 的直接依赖；`present` 本来就在 home 的 `package.json` 里、
   * 版本一个字没动；`skipped` 本生态自己提供的，不该由这条路装；`failed` 装不上——
   * **件本身已经装好了**，这一条得人自己来
   */
  action: 'installed' | 'present' | 'skipped' | 'failed'
  /** present 是 home 里那条 spec；skipped 是跳过的理由；failed 是那句错（带 pnpm 尾巴） */
  note?: string
}

/** 装机的回执 */
export interface InstallResult {
  ok: boolean
  pkg: string
  /** 装成了才有：新加的那条条目的完整 entryId */
  entryId?: string
  /**
   * 这个件声明了 peer 才有：每条各自的去向。**空着 = 它一条 peer 都没声明**，
   * 跟「声明了但全跳过了」分得开
   */
  peers?: PeerResult[]
  /** 值得说一声的：有 peer 没装上、或者 peer 那一步整个没跑成。**件本身照样是装上了的** */
  note?: string
  /** 没成时的一句话 */
  error?: string
  /** pnpm 没成时它输出的最后几行——原因就在那儿 */
  tail?: string
}

/** 查新版本的回执 */
export interface OutdatedReceipt {
  ok: boolean
  /** 成了才有：包名 → 版本差距。**空对象 = 全都最新**，跟「没查成」分得开 */
  updates?: Record<string, UpdateInfo>
  /** 没成时的一句话 */
  error?: string
}

/** 更新的回执。样式照 `InstallResult`，只是没有条目可回 */
export interface UpdateResult {
  ok: boolean
  pkg: string
  /** 没成时的一句话 */
  error?: string
  /** pnpm 没成时它输出的最后几行——原因就在那儿 */
  tail?: string
}

/** 一键热升里一条条目的去向 */
export interface RemountedEntry {
  /** 裸 id */
  id: string
  /**
   * `remounted`：停用再启用，重 import 了新版本；`skipped`：本来就停用，保持停用；
   * `deferred`：本件自己那条，回执发出之后才重挂；`failed`：动条目树时抛了，`state` 里是那句错
   */
  action: 'remounted' | 'skipped' | 'deferred' | 'failed'
  /** 重挂之后 fiber 到哪一步（ACTIVE / PENDING / FAILED…）。skipped 是 disabled，deferred 是动手前的状态 */
  state: string
}

/** 一键热升里升了的一个包 */
export interface UpdatedPackage {
  pkg: string
  from: string
  to: string
  /** 它的全部条目各自的去向 */
  entries: RemountedEntry[]
}

/** 一键热升的回执 */
export interface UpdateAllResult {
  ok: boolean
  /** 升了的包。pnpm 没成时是空的——一个包都没升、一条条目都没动 */
  updated: UpdatedPackage[]
  /** 本件自己在升级清单里：它那条条目回执之后才重挂，重挂完再整页重载 */
  selfDeferred: boolean
  /**
   * 整页重载做没做：`done` 是 `shell.reload` 已经跑过；`deferred` 是等本件自己重挂完再跑；
   * `unavailable` 是命令表里没有它（或它没成），界面要手动刷新——原因在 `note` 里。
   * 没升任何包、或者没成，就没有这一格
   */
  reload?: 'done' | 'deferred' | 'unavailable'
  /** 值得说一声的：全都最新、only 里点了名却不在清单里的、界面要手动刷新 */
  note?: string
  /** 没成时的一句话 */
  error?: string
  /** pnpm 没成时它输出的最后几行——原因就在那儿 */
  tail?: string
}

/** 检索的回执 */
export interface SearchReceipt {
  ok: boolean
  /** 成了才有：registry 上 `@godcreator02/gwb-*` 的全部。**空数组 = 源上一个都没有**，跟「没查成」分得开 */
  packages?: SearchRow[]
  /** 没成时的一句话 */
  error?: string
}

/** 卸载的回执 */
export interface UninstallResult {
  ok: boolean
  pkg: string
  /** 成了才有：这次跟着包一起摘掉的条目（裸 id），给界面报数用 */
  removedEntries?: string[]
  /** 没成时的一句话 */
  error?: string
  /** pnpm 没成时它输出的最后几行——原因就在那儿 */
  tail?: string
}

/**
 * 落 label 的那一格。收窄到用得着的两个方法——`ctx.gwbData` 满足它。
 *
 * **显示名不进 cordis.yml，也不进 settings，就住在这个件自己家里。** 理由：id 是身份、
 * 定死不给改，可人得能给条目起个看得懂的名字（尤其中文名，而 id 只能是 ASCII
 * kebab-case）。放自己家里之后，这个件不必为了一个显示名去依赖设置件。
 */
interface LabelStore {
  readDoc(doc: string): Promise<unknown>
  writeDoc(doc: string, value: unknown): Promise<void>
}

/** 读设置的那一格。收窄到用得着的一个方法 */
interface SettingsSlot {
  get(key: string): unknown
}

/** 消费方拿到的那一格。写 `inject: ['gwbPluginManager']` 才有 */
export interface GwbPluginManagerApi {
  /** 已装的包 → 它们各自的条目。两边都不丢，判据见 `reconcile` */
  list(): Promise<PluginPackageView[]>
  /**
   * home 里哪些包是共享包（清单里有 `gwb.shared`），各自提供哪些裸名。
   *
   * 界面用它把共享包从「装了没挂条目」那一区里摘出来——共享包不是件，永远不该有条目。
   * 内核算浏览器半 importmap 时扫的是同一批声明。
   */
  shared(): Promise<Record<string, string[]>>
  /**
   * `pnpm add` 进 home → **把该进 home 的 peer 也装成 home 的直接依赖** → 再自动加一条
   * 条目（**默认启用**）。
   *
   * **peer 那一步**（判据与理由在 `peers.ts`）：读刚装进来那个包的 `peerDependencies`，
   * 还没在 home `package.json` 里的那些，逐条 `pnpm add <包>`（latest）。已经在的**一个字
   * 不动**——不降级、不改写别人钉好的版本。宿主提供的（`cordis`）与本生态的件跳过，
   * 共享包与生态外的包装。**装不上不让整条 install 失败**：件本身照样是装上了的，
   * 没装上的那几条在回执的 `peers` 与 `note` 里点名。
   *
   * **卸载不动 peer**（`uninstall` 那条一如既往）：代价不对称——残留一个没人用的包只是占
   * 磁盘，误删一个还有件在用的包是运行时故障。
   *
   * **不抛**——pnpm 没成、找不到 pnpm，都收敛成一份 `ok: false` 的回执带上原因；
   * 包名不合规这种调用方写错了的事才抛。
   *
   * **同一个包 install 两次会得到两条条目**（第二条 id 带数字后缀）。不做「已经装过就
   * 跳过」的判断：同一个包挂多条条目本来就是合法形态，替调用方猜意图只会猜错。
   */
  install(pkg: string, spec?: string): Promise<InstallResult>
  /**
   * 查 home 里已装的包哪些有新版本。**不抛**——找不到 pnpm、输出认不出来，都收敛成一份
   * `ok: false` 的回执：界面上它只是一句安静的话，不该闹成一场事故。
   */
  outdated(): Promise<OutdatedReceipt>
  /**
   * 把一个已装的包升到最新（`pnpm add <pkg>@latest`）。**与 install 唯一的差别是不建条目**
   * ——条目引的是包名，包换版本条目原样有效。**跑着的 fiber 还持旧代码，重启内核后才
   * 换成新的**，调用方（界面）得把这句带到。
   *
   * 包没装（调用方写错了的事）当场抛；pnpm 没成收敛成 `ok: false` 的回执带尾巴。
   */
  update(pkg: string): Promise<UpdateResult>
  /**
   * 一键热升：`outdated()` 拿清单 → **一趟** `pnpm add a@x b@y …`（精确版本）→ 升了的每个包
   * 的每条条目**各自**停用再启用（重 import 新版本；本来就停用的跳过）→ `shell.reload`
   * 整页重载。**不重启内核。** `only` 给了就只升点名的那几个。
   *
   * **本件自己排最后、回执之后才重挂**（`selfDeferred: true`）：处理器里停用自己，回执就
   * 没了。那时整页重载也跟着推迟到自己重挂完之后（`reload: 'deferred'`）。
   *
   * **不抛**（`only` 里包名不合规这种调用方写错了的事除外）：查不出清单、找不到 pnpm、
   * pnpm 没成，都收敛成 `ok: false` 的回执；pnpm 没成时一条条目都不动。
   */
  updateAll(only?: readonly string[]): Promise<UpdateAllResult>
  /**
   * 列 registry 上 `@godcreator02/gwb-*` 的全部（npm 标准检索协议，`/-/v1/search`）。
   *
   * **registry 基址从 pnpm 配置解析**——装从哪来，搜就到哪去；这儿不认识任何具体的源。
   * **不抛**：解析不出基址、网络没成、响应认不出，都收敛成 `ok: false` 的一句话。
   */
  search(): Promise<SearchReceipt>
  /**
   * 卸载一个包：先把它在 `cordis.yml` 里的**全部条目**摘掉（fiber 随条目当场卸下），
   * 再 `pnpm remove` 掉包本身。设置与数据留在盘上——重装回来还是那份。
   *
   * **顺序是先摘条目后卸包**：反过来的话，条目会引着一个不在 home 里的包，`list()` 里
   * 出现一排 ghost。**pnpm 失败不回滚**：条目已摘是正当落点（包进「已装、没挂条目」
   * 那一区看得见、重试加条目就行），回执带尾巴。
   *
   * **`install` 替它装进来的 peer 一条都不动，也不去追谁还在用**——这不是漏了，是判过的：
   * 代价不对称，残留一个没人用的包只是占磁盘，误删一个还有件在用的包是运行时故障。
   * 真要清，人自己在 home 里 `pnpm remove`。
   *
   * 包没装（调用方写错了的事）当场抛；摘条目与 pnpm 那两步的「没成」收敛成回执。
   */
  uninstall(pkg: string): Promise<UninstallResult>
  /** 给已装的包再加一条条目。回新条目的完整 entryId。包没装、id 撞了都抛 */
  addEntry(pkg: string, id?: string, config?: unknown): Promise<string>
  /** 删一条条目。**不删包**——包留在 home 里，`list()` 里还看得见 */
  removeEntry(entryId: string): void
  enable(entryId: string): Promise<void>
  disable(entryId: string): Promise<void>
  /** 改显示名。给空串就是抹掉。没装数据件时回一句 `ok: false`，不崩 */
  setLabel(entryId: string, label: string): Promise<GwbResult>
}

export default class GwbPluginManager extends Service implements GwbPluginManagerApi {
  /**
   * 提供方自己的 ctx。方法里的 `this.ctx` 是**消费者**的，而这个件干的每一件事都以
   * **自己**的身份进行（改的是整棵树、写的是自己那份数据），所以一律用这一份。
   *
   * **用 TS 的 `private` 不用 `#`**：cordis 给每个消费者派生一份 `Object.create(this)`，
   * 而 `#` 私有字段的内部槽不在原型链上，派生对象上一读就炸。
   */
  private readonly own: GwbContext
  /** 这个 home 的目录：pnpm 的 cwd，也是那份 package.json 的所在 */
  private readonly home: string
  /** 承载 cordis.yml 的那棵树。构造时取——那时 this.ctx 还是自己 */
  private readonly tree: EntryTreeLike
  private readonly warn: (message: string) => void
  private readonly info: (message: string) => void
  /**
   * 那只 logger 本身。上面两个每次都经 `ctx.logger()` 取，而一键热升里「自己最后」那段
   * 跑在本件的 fiber 已经拆掉之后——那时 ctx 上什么都不能碰，只能拿早就攥在手里的这只
   */
  private readonly log: { info(message: string): void; warn(message: string): void }

  /** 数据件在才有。不在就退化成「只显示 id」，`setLabel` 回一句「没装数据件」 */
  private labelStore: LabelStore | undefined
  /** 设置件在才有。不在就跳过设置那一路，pnpm 只走自动查找 */
  private settings: SettingsSlot | undefined
  /** 命令总线在才有。一键热升拿它探 `shell.reload`、跑 `shell.reload`——包括本件自己重挂之后那一下 */
  private cli: GwbCommands | undefined
  /** 裸 id → 显示名。内存里这份是权威，盘上那份是它的副本 */
  private labels: Record<string, string> = {}
  /** 头一份 labels 读完没有。setLabel 要等它——不等的话第一次改名会被读盘那一下盖回去 */
  private labelsReady: Promise<void> = Promise.resolve()

  /**
   * pnpm 排队跑，一次只一趟。两条 install 同时开的话，pnpm 是读-改-写 home 那份
   * `package.json`，后写的会把前一条加进去的依赖抹掉——而且一声不吭。
   */
  private chain: Promise<unknown> = Promise.resolve()

  /** registry 基址的缓存。解析一次用到底——一个 home 活着的时候换源的概率，趋近于重开一个 home */
  private registry: string | undefined

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbPluginManager')
    this.own = ctx
    this.home = requireKernel(ctx).dataDir
    this.tree = treeOf(ctx)
    // 构造时 this.ctx 还是**提供方**自己的，logger 绑的是本件
    this.warn = (message: string): void => ctx.logger(NAME).warn(message)
    this.info = (message: string): void => ctx.logger(NAME).info(message)
    this.log = ctx.logger(NAME)
  }

  [Service.init](): void {
    this.wireData()
    this.wireSettings()
    this.wireCommands()
    this.wireSkills()
    this.info(`件管理就绪（ctx.gwbPluginManager），自己那条条目是 ${ownEntryId(this.own)}，看表走 ${LIST_COMMAND}`)
  }

  /** 说明书局部注入:skills 件不在时本件照常挂。skills/ 目录得进 package.json 的 files */
  private wireSkills(): void {
    this.own.inject(['gwbSkills'], (ctx) => {
      ctx.effect(() => ctx.gwbSkills.register(new URL('../skills/', import.meta.url)))
    })
  }

  /** 数据件是**可选**的：嵌套注入，在了才接上，走了自动摘，后来才挂也接得上 */
  private wireData(): void {
    this.own.inject(['gwbData'], (ctx) => {
      const store: LabelStore = ctx.gwbData
      this.labelStore = store
      this.labelsReady = store.readDoc(LABELS_DOC).then(
        (raw) => {
          this.labels = toLabels(raw)
        },
        (err: unknown) => {
          this.warn(`显示名读不出来，先当没有：${String(err)}`)
        },
      )
      ctx.effect(() => () => {
        this.labelStore = undefined
      })
    })
  }

  /** 设置件也是可选的。声明那一项 pnpm 路径，顺手把读它的口子接上 */
  private wireSettings(): void {
    this.own.inject(['gwbSettings'], (ctx) => {
      this.settings = ctx.gwbSettings
      // define 自己会挂在调用方的 effect 上，不用我们再包一层
      ctx.gwbSettings.define({
        key: PNPM_PATH_KEY,
        title: 'pnpm 路径',
        type: 'string',
        description:
          '装机用哪份 pnpm。不填就自动找（只认 npm 全局装出来的布局）；corepack、volta、standalone 装的要手填 pnpm.cjs 的绝对路径。',
      })
      ctx.effect(() => () => {
        this.settings = undefined
      })
    })
  }

  /** 命令总线也是可选的：没有它服务面照样完整，只是界面调不到 */
  private wireCommands(): void {
    this.own.inject(['gwbCommands'], (ctx) => {
      const cli = ctx.gwbCommands
      // inject 保证了它在，这句只是把类型收窄
      if (cli === undefined) return
      this.cli = cli
      ctx.effect(() => () => {
        this.cli = undefined
      })
      const on = (name: string, description: string, handler: (args?: unknown) => unknown): void => {
        ctx.effect(() => cli.register({ name, description, plugin: NAME }, handler))
      }

      on(LIST_COMMAND, 'home 里装了哪些包，各自在 cordis.yml 里有哪些条目。无参数', () => this.list())

      on(SHARED_COMMAND, 'home 里哪些包是共享包（清单里有 gwb.shared），各自提供哪些裸名。无参数', async () => ({
        ok: true,
        data: { packages: await this.shared() },
      }))

      on(
        INSTALL_COMMAND,
        'pnpm add 一个包进 home，把它还没在 home 的 peer 也装成直接依赖（cordis 与本生态的件跳过；已在的版本不动；装不上不影响件本身），再自动加一条条目。回执 { ok, pkg, entryId, peers?: [{ pkg, range, action, note? }], note? }，action 是 installed / present / skipped / failed。参数 { pkg, spec? }（spec 是版本或 tag）',
        async (args) => {
          const raw = asRecord(args)
          const result = await this.install(text(raw, 'pkg'), optional(raw, 'spec'))
          if (result.ok) return { ok: true, data: result }
          // 尾巴既拼进 error 那句话（人看的），也原样留在 data 里（界面要单独排版时用）
          const tail = result.tail === undefined ? '' : `\n${result.tail}`
          return { ok: false, error: `${result.error ?? '没说原因'}${tail}`, data: result }
        },
      )

      on(ADD_ENTRY_COMMAND, '给已装的包再加一条条目。参数 { pkg, id?, config? }', async (args) => {
        const raw = asRecord(args)
        const entryId = await this.addEntry(text(raw, 'pkg'), optional(raw, 'id'), raw['config'])
        return { ok: true, data: { entryId } }
      })

      on(REMOVE_ENTRY_COMMAND, '删一条条目（不删包）。参数 { entryId }', (args) => {
        this.removeEntry(text(asRecord(args), 'entryId'))
        return { ok: true }
      })

      on(ENABLE_COMMAND, '启用一条条目。参数 { entryId }', async (args) => {
        await this.enable(text(asRecord(args), 'entryId'))
        return { ok: true }
      })

      on(DISABLE_COMMAND, '停用一条条目。参数 { entryId }', async (args) => {
        await this.disable(text(asRecord(args), 'entryId'))
        return { ok: true }
      })

      on(SET_LABEL_COMMAND, '改一条条目的显示名。参数 { entryId, label }（label 给空串就是抹掉）', async (args) => {
        const raw = asRecord(args)
        return this.setLabel(text(raw, 'entryId'), label(raw))
      })

      on(OUTDATED_COMMAND, '查已装的包哪些有新版本（pnpm outdated，不联网到公网）。无参数', async () => {
        const result = await this.outdated()
        if (result.ok) return { ok: true, data: result }
        return { ok: false, error: result.error ?? '没说原因' }
      })

      on(UPDATE_COMMAND, '把一个已装的包升到最新（不建条目、不重挂；跑着的件重启内核后才换新——要热生效走 plugin-manager.update-all）。参数 { pkg }', async (args) => {
        const result = await this.update(text(asRecord(args), 'pkg'))
        if (result.ok) return { ok: true, data: result }
        const tail = result.tail === undefined ? '' : `\n${result.tail}`
        return { ok: false, error: `${result.error ?? '没说原因'}${tail}`, data: result }
      })

      on(
        UPDATE_ALL_COMMAND,
        '一键热升，不重启：一趟 pnpm add 把全部过期包升到 outdated 回的精确版本，再逐条停用→启用重挂新版本（本来就停用的跳过；本件自己排最后、回执发出后才重挂），最后 shell.reload 整页重载。回执 { updated: [{ pkg, from, to, entries: [{ id, action, state }] }], selfDeferred, reload, note? }。参数 { only?: string[] }（限定包名；不给或不传参数就全升）',
        async (args) => {
          const result = await this.updateAll(onlyList(args))
          if (result.ok) return { ok: true, data: result }
          const tail = result.tail === undefined ? '' : `\n${result.tail}`
          return { ok: false, error: `${result.error ?? '没说原因'}${tail}`, data: result }
        },
      )

      on(SEARCH_COMMAND, '列 registry 上 @godcreator02/gwb-* 的全部（装从哪条源来，搜就到哪去）。无参数', async () => {
        const result = await this.search()
        if (result.ok) return { ok: true, data: result }
        return { ok: false, error: result.error ?? '没说原因' }
      })

      on(UNINSTALL_COMMAND, '卸载一个包：它的全部条目与包一起拿掉，设置与数据留盘（只删一条条目走 plugin-manager.remove-entry）。参数 { pkg }', async (args) => {
        const result = await this.uninstall(text(asRecord(args), 'pkg'))
        if (result.ok) return { ok: true, data: result }
        const tail = result.tail === undefined ? '' : `\n${result.tail}`
        return { ok: false, error: `${result.error ?? '没说原因'}${tail}`, data: result }
      })
    })
  }

  async list(): Promise<PluginPackageView[]> {
    const deps = await readHomeDependencies(this.home)
    return reconcile(deps, readEntries(this.tree.store), this.labels)
  }

  async shared(): Promise<Record<string, string[]>> {
    return readSharedPackages(this.home)
  }

  async install(pkg: string, spec?: string): Promise<InstallResult> {
    // 调用方写错了的事当场抛；下面每一条「没成」都是正当结果，收敛成回执
    const target = installSpec(pkg, spec)

    const found = locatePnpm(this.pnpmPath())
    if (!found.ok) {
      this.warn(`装不了 ${target}：${found.error}`)
      return { ok: false, pkg, error: found.error }
    }

    this.info(`用 ${found.cjs}（${found.from === 'setting' ? '设置里填的' : 'PATH 里找到的'}）装 ${target}`)
    const run = await this.queue(() => runPnpm({ pnpmCjs: found.cjs, cwd: this.home, args: ['add', target] }))
    if (!run.ok) {
      const error = `pnpm add ${target} 没成（退出码 ${String(run.exitCode)}）`
      this.warn(`${error}\n${run.tail ?? ''}`)
      return run.tail === undefined ? { ok: false, pkg, error } : { ok: false, pkg, error, tail: run.tail }
    }

    /**
     * **peer 排在建条目之前**：条目一落 loader 就当场挂它，而件挂起来第一件事很可能就是
     * 现查 `<home>/node_modules/<peer>`。先把 peer 摆好，件起来时那条路径就已经在了。
     */
    const peers = await this.settlePeers(pkg, found.cjs)

    try {
      // 直接建条目、不再回头查一遍清单：pnpm 刚说过它成了，再问一次只是多一条失败路径
      const entryId = await this.createEntry(pkg)
      // 说「加上了」不说「挂上了」——挂载不等它，挂没挂上看 list() 的 active
      this.info(`${target} 装上了，条目 ${entryId} 已加进 cordis.yml`)
      return { ok: true, pkg, entryId, ...peers }
    } catch (err: unknown) {
      // **不回滚删包**：留着的包会出现在 list() 的「一条条目都没有」那一档里，有落点；
      // 删包比留着危险，而且删的时候未必只删掉这一个
      const error = `${target} 装上了，但条目加不进 cordis.yml：${String(err)}。包留在 home 里，看表走 ${LIST_COMMAND}`
      this.warn(error)
      return { ok: false, pkg, error, ...peers }
    }
  }

  /**
   * 把这个件声明的 peer 里**该进 home 的**装成 home 的直接依赖（跟件平级）。
   *
   * **为什么装、为什么 pnpm 自动补的那份顶不上用**，判据与实测读数在 `peers.ts` 的头注释。
   * 这儿只讲执行上的三个取舍：
   *
   * **一、装的是 latest，不是清单上那条 range。** 这个生态的 peer range 一律写 `>=`
   * （理由见各件 `package.json` 的 `//peerRange`），latest 通常都满足；而按 range 装会把
   * `^1.2.3` 这种范围原样写进 home 的 `package.json`，跟这儿每条依赖都是精确版本的形状
   * 对不上。range 原样带进回执，对不上时人看得见。
   *
   * **二、一条一趟 pnpm，不批量。** 一趟 `add a b c` 里有一个包源上没有，pnpm 整趟失败、
   * 好的那几个一个都装不上，而且它不告诉你是哪个挂的。peer 数量是个位数，多起几个进程
   * 换「装不上的那个点得出名字」值。
   *
   * **三、永不抛、永不让装机失败。** 件本身已经装上了，peer 这一步的每一种没成都只是
   * 回执里的一行——这条命令是所有 home 装件的必经之路，它多一条抛出的路径就多一次
   * 「什么都装不了」。
   */
  private async settlePeers(pkg: string, pnpmCjs: string): Promise<{ peers?: PeerResult[]; note?: string }> {
    let plan: ReturnType<typeof planPeers>
    try {
      const declared = toPeerDependencies(await readInstalledManifest(this.home, pkg))
      const names = Object.keys(declared)
      if (names.length === 0) return {}
      // 种类只对本生态那些包问得出意思，可读一份清单是几微秒的事，不值得为它再分一次流
      const kinds: Record<string, PeerKind | undefined> = {}
      for (const peer of names) kinds[peer] = peerKindOf(await readPeerManifest(this.home, pkg, peer))
      plan = planPeers(declared, await readHomeDependencies(this.home), kinds)
    } catch (err: unknown) {
      const note = `${pkg} 装好了，但它的 peer 清单没读成（${String(err)}），一条都没装。要的话自己在 home 里 pnpm add`
      this.warn(note)
      return { note }
    }

    const peers: PeerResult[] = []
    for (const item of plan) {
      if (item.decision !== 'install') {
        const stay: PeerResult = { pkg: item.pkg, range: item.range, action: item.decision }
        peers.push(item.note === undefined ? stay : { ...stay, note: item.note })
        continue
      }
      const run = await this.queue(() => runPnpm({ pnpmCjs, cwd: this.home, args: ['add', item.pkg] }))
      if (run.ok) {
        this.info(`${pkg} 的 peer ${item.pkg}（清单写 ${item.range}）装成了 home 的直接依赖`)
        peers.push({ pkg: item.pkg, range: item.range, action: 'installed' })
        continue
      }
      const why = `pnpm add ${item.pkg} 没成（退出码 ${String(run.exitCode)}）${run.tail === undefined ? '' : `\n${run.tail}`}`
      this.warn(`${pkg} 的 peer ${item.pkg} 没装上：${why}`)
      peers.push({ pkg: item.pkg, range: item.range, action: 'failed', note: why })
    }

    const failed = peers.filter((peer) => peer.action === 'failed').map((peer) => peer.pkg)
    if (failed.length === 0) return { peers }
    return {
      peers,
      note: `${pkg} 装好了，但这几条 peer 没装上：${failed.join('、')}。件跑起来现查 <home>/node_modules/<包名> 会扑空——自己在 home 里 pnpm add 一趟，或者先看它在不在源上`,
    }
  }

  /**
   * 查 home 里已装的包哪些有新版本（`pnpm outdated --json`）。
   *
   * **退出码 1 是「存在过期包」，是结果不是失败**；0 且 stdout 为空才是「全都最新」。
   * 与 install 共用同一条串行队列——它只读不写，排队等一等无妨，省得另想一套并发故事。
   */
  async outdated(): Promise<OutdatedReceipt> {
    const found = locatePnpm(this.pnpmPath())
    if (!found.ok) return { ok: false, error: found.error }

    const run = await this.queue(() =>
      runPnpmCapture({ pnpmCjs: found.cjs, cwd: this.home, args: ['outdated', '--json'] }),
    )
    // pnpm 的「人话」都在 stderr 上，两条失败路都把它带上
    const say = (message: string): string =>
      run.stderrTail === '' ? message : `${message}\n${run.stderrTail}`
    if (run.exitCode === null) return { ok: false, error: say(`pnpm 起不来（退出码 ${String(run.exitCode)}）`) }
    if (run.exitCode !== 0 && run.exitCode !== 1) {
      return { ok: false, error: say(`pnpm outdated 没成（退出码 ${String(run.exitCode)}）`) }
    }
    const updates = parseOutdated(run.stdout)
    if (updates === undefined) {
      return { ok: false, error: say('pnpm outdated 的输出认不出来（要的是一份 JSON）——pnpm 大版本间形状可能变了') }
    }
    return { ok: true, updates }
  }

  async update(pkg: string): Promise<UpdateResult> {
    // 调用方写错了的事当场抛；下面每一条「没成」都是正当结果，收敛成回执
    assertPkgName(pkg)
    const deps = await readHomeDependencies(this.home)
    if (deps[pkg] === undefined) {
      throw new Error(`home 里没装 ${pkg}，谈不上更新。装走 ${INSTALL_COMMAND}。`)
    }

    const found = locatePnpm(this.pnpmPath())
    if (!found.ok) {
      this.warn(`升不了 ${pkg}：${found.error}`)
      return { ok: false, pkg, error: found.error }
    }

    this.info(`用 ${found.cjs}（${found.from === 'setting' ? '设置里填的' : 'PATH 里找到的'}）把 ${pkg} 升到最新`)
    const run = await this.queue(() => runPnpm({ pnpmCjs: found.cjs, cwd: this.home, args: ['add', `${pkg}@latest`] }))
    if (!run.ok) {
      const error = `pnpm add ${pkg}@latest 没成（退出码 ${String(run.exitCode)}）`
      this.warn(`${error}\n${run.tail ?? ''}`)
      return run.tail === undefined ? { ok: false, pkg, error } : { ok: false, pkg, error, tail: run.tail }
    }

    // 条目不动（引的是包名，包换版本条目原样有效）。跑着的 fiber 还持旧代码，重启才换
    this.info(`${pkg} 升到最新了。跑着的件还持旧代码，重启内核后才换成新的（要热生效走 ${UPDATE_ALL_COMMAND}）`)
    return { ok: true, pkg }
  }

  async updateAll(only?: readonly string[]): Promise<UpdateAllResult> {
    // 调用方写错了的事当场抛；下面每一条「没成」都是正当结果，收敛成回执
    for (const pkg of only ?? []) assertPkgName(pkg)
    const bare = (extra?: string): UpdateAllResult => ({ ok: false, updated: [], selfDeferred: false, ...(extra === undefined ? {} : { error: extra }) })

    const checked = await this.outdated()
    if (!checked.ok || checked.updates === undefined) return bare(checked.error ?? '查不出过期清单')

    const plan = planUpdateAll(checked.updates, this.tree.store, ownEntryId(this.own), only)
    const notes: string[] = []
    if (plan.ignored.length > 0) notes.push(`only 里这几个不在过期清单里，没动：${plan.ignored.join('、')}`)
    if (plan.packages.length === 0) {
      return { ok: true, updated: [], selfDeferred: false, note: ['全都最新', ...notes].join('；') }
    }

    const found = locatePnpm(this.pnpmPath())
    if (!found.ok) {
      this.warn(`升不了：${found.error}`)
      return bare(found.error)
    }
    // 一趟装完：pnpm 是读-改-写 home 的 package.json，逐包起进程跟并发 install 一样会互相盖
    this.info(`用 ${found.cjs}（${found.from === 'setting' ? '设置里填的' : 'PATH 里找到的'}）一趟装 ${plan.pnpmArgs.slice(1).join(' ')}`)
    const run = await this.queue(() => runPnpm({ pnpmCjs: found.cjs, cwd: this.home, args: plan.pnpmArgs }))
    if (!run.ok) {
      const error = `pnpm ${plan.pnpmArgs.join(' ')} 没成（退出码 ${String(run.exitCode)}）。一个包都没升、一条条目都没动`
      this.warn(`${error}\n${run.tail ?? ''}`)
      return run.tail === undefined ? bare(error) : { ...bare(error), tail: run.tail }
    }

    // 从这儿起旧版本目录已经没了：升了的每条条目都得在**这条命令里**重挂，不留窗口
    const updated: UpdatedPackage[] = []
    let deferred: PlannedEntry | undefined
    for (const pkg of plan.packages) {
      const entries: RemountedEntry[] = []
      for (const entry of pkg.entries) {
        if (entry.self && !entry.disabled) {
          deferred = entry
          entries.push({ id: entry.id, action: 'deferred', state: fiberStateOf(this.tree.store[entry.id]) })
          continue
        }
        entries.push(await this.remount(entry))
      }
      updated.push({ pkg: pkg.pkg, from: pkg.from, to: pkg.to, entries })
    }
    const summary = updated.map((p) => `${p.pkg} ${p.from} → ${p.to}`).join('，')
    const cli = this.cli

    if (deferred === undefined) {
      const reload = await reloadVia(cli)
      if (reload.note !== undefined) notes.push(reload.note)
      this.info(`一键热升完成：${summary}${reload.reload === 'done' ? '；界面已整页重载' : ''}`)
      return { ok: true, updated, selfDeferred: false, reload: reload.reload, ...noteOf(notes) }
    }

    /**
     * **自己最后，而且在回执之后。** 处理器里停用自己，await 链随 fiber 一起拆掉，回执永远
     * 到不了调用方。所以先把回执交出去，下一个宏任务再动手——那时命令的应答早已发出。
     * 闭包**只持 tree、id、总线的引用与那只 logger**：本件这条 fiber 拆掉之后 ctx 上的
     * 东西一样都不能碰（取服务会「inactive context」）；`this` 上别的方法也不进来
     */
    const tree = this.tree
    const id = deferred.id
    const log = this.log
    setTimeout(() => {
      void remountEntry(tree, id)
        .then((state) => {
          log.info(`本件自己（${id}）重挂了：${state}`)
          return reloadVia(cli)
        })
        .then((reload) => {
          if (reload.note !== undefined) log.warn(reload.note)
        })
        .catch((err: unknown) => {
          log.warn(`本件自己（${id}）重挂没成：${String(err)}`)
        })
    }, 0)
    const canReload = hasCommand(cli, SHELL_RELOAD_COMMAND)
    if (!canReload) notes.push(`命令表里没有 ${SHELL_RELOAD_COMMAND}，界面要手动刷新`)
    this.info(`一键热升：${summary}；本件自己（${id}）回执之后重挂${canReload ? '，随后整页重载' : ''}`)
    return { ok: true, updated, selfDeferred: true, reload: canReload ? 'deferred' : 'unavailable', ...noteOf(notes) }
  }

  /** 按计划重挂一条：本来就停用的跳过（保持停用），动树时抛了收成 failed */
  private async remount(entry: PlannedEntry): Promise<RemountedEntry> {
    if (entry.disabled) return { id: entry.id, action: 'skipped', state: 'disabled' }
    try {
      const state = await remountEntry(this.tree, entry.id)
      this.info(`条目 ${entry.id} 重挂了：${state}`)
      return { id: entry.id, action: 'remounted', state }
    } catch (err: unknown) {
      this.warn(`条目 ${entry.id} 重挂没成：${String(err)}`)
      return { id: entry.id, action: 'failed', state: String(err) }
    }
  }

  /**
   * registry 基址：装从哪来，搜就到哪去。**从 pnpm 的配置解析**（scope 条目，退全全局
   * `registry`，再退 npm 官方源）——跟 install/outdated 走的是同一份配置，这儿不认识任何
   * 具体的源。解析一次缓存到底；解不出来回 undefined，调用方给一句人话。
   */
  private async registryBase(): Promise<string | undefined> {
    if (this.registry !== undefined) return this.registry
    const found = locatePnpm(this.pnpmPath())
    if (!found.ok) return undefined
    for (const key of ['@godcreator02:registry', 'registry']) {
      const run = await this.queue(() => runPnpmCapture({ pnpmCjs: found.cjs, cwd: this.home, args: ['config', 'get', key] }))
      const value = run.stdout.trim()
      if (run.exitCode === 0 && /^https?:\/\//.test(value)) {
        this.registry = value.endsWith('/') ? value : `${value}/`
        this.info(`检索跟装走同一条源：${this.registry}（pnpm config 的 ${key}）`)
        return this.registry
      }
    }
    return undefined
  }

  async search(): Promise<SearchReceipt> {
    const base = await this.registryBase()
    if (base === undefined) {
      const found = locatePnpm(this.pnpmPath())
      return {
        ok: false,
        error: found.ok ? '解析不出 registry 地址（pnpm config 里没配）。装包走哪条源，检索就跟到哪。' : found.error,
      }
    }
    // text 钉在 scope 上：列的就是这条线的全家，筛选（gwb- 前缀）在解析后做
    const url = `${base}-/v1/search?text=${encodeURIComponent('@godcreator02')}&size=250`
    try {
      // 宿主是 Electron 当 node 使，Node 18 起 fetch 是全局的
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (!response.ok) return { ok: false, error: `registry 回了 ${String(response.status)}（${url}）` }
      const rows = parseSearch(await response.text())
      if (rows === undefined) {
        return { ok: false, error: '检索响应认不出来（要的是 npm registry 的 search JSON）。' }
      }
      return { ok: true, packages: rows.filter((row) => isGwbLine(row.pkg)) }
    } catch (err: unknown) {
      return { ok: false, error: `检索没成（10 秒没等到，或源够不着）：${String(err)}` }
    }
  }

  async uninstall(pkg: string): Promise<UninstallResult> {
    // 调用方写错了的事当场抛；下面每一条「没成」都是正当结果，收敛成回执
    assertPkgName(pkg)
    const deps = await readHomeDependencies(this.home)
    if (deps[pkg] === undefined) {
      throw new Error(`home 里没装 ${pkg}，谈不上卸载。只删条目走 ${REMOVE_ENTRY_COMMAND}。`)
    }

    // 第一步：摘条目。逐条 tree.remove——它一次做两件事（写回 yml、当场卸 fiber），
    // 依赖这个包的其他件会随 fiber 一起被 cordis 摘下、停在「没挂上」那一档
    const ids = entriesForPackage(this.tree.store, pkg)
    for (const id of ids) this.tree.remove(id)

    // 第二步：卸包。排在既有串行队列里，与 install/update 同一条
    const found = locatePnpm(this.pnpmPath())
    if (!found.ok) {
      this.warn(`卸不了 ${pkg}：条目已摘（${ids.length} 条），${found.error}`)
      return { ok: false, pkg, removedEntries: ids, error: found.error }
    }
    const run = await this.queue(() => runPnpm({ pnpmCjs: found.cjs, cwd: this.home, args: ['remove', pkg] }))
    if (!run.ok) {
      // 不回滚：条目已摘是正当落点，包进「已装、没挂条目」那一区看得见、重试挂条目就行
      const error = `pnpm remove ${pkg} 没成（退出码 ${String(run.exitCode)}）。条目已摘 ${ids.length} 条，包还在 home 里`
      this.warn(`${error}\n${run.tail ?? ''}`)
      return run.tail === undefined
        ? { ok: false, pkg, removedEntries: ids, error }
        : { ok: false, pkg, removedEntries: ids, error, tail: run.tail }
    }

    this.info(`${pkg} 卸载了：${ids.length} 条条目摘掉，包从 home 移除。设置与数据留在盘上`)
    return { ok: true, pkg, removedEntries: ids }
  }

  async addEntry(pkg: string, id?: string, config?: unknown): Promise<string> {
    assertPkgName(pkg)
    const deps = await readHomeDependencies(this.home)
    if (deps[pkg] === undefined) {
      throw new Error(`home 里没装 ${pkg}，加不了条目。先走 ${INSTALL_COMMAND}，或者自己去 home 里 pnpm add。`)
    }
    const entryId = await this.createEntry(pkg, id, config)
    // install 那条路有它自己的「装上了」，这条补的是单独加条目的那一趟
    this.info(`条目 ${entryId}（${pkg}）加进 cordis.yml 了`)
    return entryId
  }

  removeEntry(entryId: string): void {
    const id = this.locate(entryId)
    this.tree.remove(id)
    // 显示名留着不抹：id 是确定性的，同一个包装回来还是这个 id，那时旧名字正好接上——
    // 跟设置和数据一个规矩（删条目不删它的设置与数据）
    this.info(`条目 ${id} 已删（只删这一条，包没动；要连包一起拿掉走 ${UNINSTALL_COMMAND}）`)
  }

  async enable(entryId: string): Promise<void> {
    // **null 是「删掉这个字段」**，不是「设成 null」——loader 的 update 拿 null 当删用
    const id = this.locate(entryId)
    await this.tree.update(id, { disabled: null })
    this.info(`条目 ${id} 已启用`)
  }

  async disable(entryId: string): Promise<void> {
    const id = this.locate(entryId)
    await this.tree.update(id, { disabled: true })
    this.info(`条目 ${id} 已停用`)
  }

  async setLabel(entryId: string, label: string): Promise<GwbResult> {
    const id = this.locate(entryId)
    const store = this.labelStore
    if (store === undefined) {
      return {
        ok: false,
        error: '没装数据件（@godcreator02/gwb-data），显示名存不下来。装上它、在 cordis.yml 里加一条条目，再改一次。',
      }
    }
    // 等头一份读完再改，不然这次写的会被那一下读盘盖回去
    await this.labelsReady
    const trimmed = label.trim()
    const next = { ...this.labels }
    if (trimmed === '') delete next[id]
    else next[id] = trimmed
    await store.writeDoc(LABELS_DOC, next)
    this.labels = next
    this.info(trimmed === '' ? `条目 ${id} 的显示名已抹掉` : `条目 ${id} 的显示名改成「${trimmed}」`)
    return { ok: true }
  }

  /** 设置里填的那份 pnpm。设置件没装就是 undefined，走自动查找 */
  private pnpmPath(): string | undefined {
    const value = this.settings?.get(PNPM_PATH_KEY)
    return typeof value === 'string' && value !== '' ? value : undefined
  }

  /**
   * 完整 entryId 与裸 id 都认，回裸 id。
   *
   * 件从 ctx 上读到的是完整的 `home:commands`，而 `tree` 上的每个方法认的是裸 id
   * （见 `ids.ts` 的 `bareId`）。两边不换算的话，`resolve` 会当场「cannot resolve entry」。
   */
  private locate(entryId: string): string {
    const id = bareId(entryId)
    if (this.tree.store[id] === undefined) {
      throw new Error(`cordis.yml 里没有 id 是 ${JSON.stringify(id)} 的条目。看表走 ${LIST_COMMAND}。`)
    }
    return id
  }

  /**
   * 往 `cordis.yml` 里加一条。`tree.create` 一次做两件事——写回 yml、当场挂上，
   * 所以这儿不用再手动 `ctx.plugin`。
   *
   * **id 一定要显式给。** 不给的话 loader 发一个 8 位随机 hex，而且每次启动都换一个：
   * 那条条目的设置与数据（都按 id 的末段分区）从此每启动一次新建一份。
   */
  private async createEntry(pkg: string, id?: string, config?: unknown): Promise<string> {
    // 撞名在**整棵树**范围内判：id 在 cordis.yml 里全局唯一，loader 的 store 就是一张平表
    const taken = new Set(Object.keys(this.tree.store))
    let final: string
    if (id === undefined) {
      final = uniqueId(defaultIdFor(pkg), taken)
    } else {
      assertId(id)
      if (taken.has(id)) throw new Error(`条目 id ${JSON.stringify(id)} 已经被占了。换一个，或者不给由这边编一个。`)
      final = id
    }
    // 每次给一个新对象：create 会把它原样塞进 group.data，共用一个对象等于两条条目共享配置
    const options: Record<string, unknown> = { id: final, name: pkg }
    if (config !== undefined) options['config'] = config

    /**
     * **只等它把条目写进去，不等它挂上。**
     *
     * `tree.create` 一次做两件事，而它回的那个 promise 里**包着挂载**——挂载可能永远不
     * 完成：`inject` 永远满足不了的件，它的 fiber 按设计就是无限等着。真 await 下去的话，
     * 装一个依赖还没装的件就会让这条命令**永远没有回执**（实机撞过：挂第二条服务提供方
     * 的条目，cordis 抛 `service ... has been registered`，整条 install 卡死）。
     *
     * 好在写盘那半是**同步**发生的：`create` 的函数体在第一个 await 之前就把 options
     * 塞进了 group、排好了写回。所以不 await 也不影响条目落盘。
     *
     * 挂没挂上是另一件事，看 `list()` 的 `active`；挂不上的原因在日志里。
     */
    void this.tree.create(options, null).catch((err: unknown) => {
      this.warn(`条目 ${final}（${pkg}）加进 cordis.yml 了，但没挂起来：${String(err)}`)
    })
    return this.fullId(final)
  }

  /**
   * 裸 id → 完整 entryId。
   *
   * 以前这个值是 `tree.create` 回的（`Entry.id` 的 getter 拼好的），现在不 await 它了，
   * 就得自己拼。前缀是**本件那条条目的前缀**——同一棵树上的条目共用它。
   */
  private fullId(bare: string): string {
    const own = ownEntryId(this.own)
    const cut = own.lastIndexOf(':')
    return cut === -1 ? bare : `${own.slice(0, cut + 1)}${bare}`
  }

  private queue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task)
    // 前一趟失败不该把后面排队的一起带倒
    this.chain = next.catch(() => undefined)
    return next
  }
}

/**
 * 停用 → 等旧 fiber 拆完 → 启用（`_init` 重新 `tree.import`，拿到新版本）→ 等新 fiber 起完，
 * 回它的状态。**等旧的拆完再启用**：loader 的 `update({ disabled: true })` 调 `fiber.dispose()`
 * 不等它，而 Service 件的 provide 是在卸载那趟里撤的——不等就启用，新 fiber 起来时旧服务
 * 可能还没撤，cordis 会报「service has been registered」
 */
async function remountEntry(tree: EntryTreeLike, id: string): Promise<string> {
  const old = fiberOf(tree.store[id])
  await tree.update(id, { disabled: true })
  await settleFiber(old, SETTLE_MS)
  await tree.update(id, { disabled: null })
  const entry = tree.store[id]
  await settleFiber(fiberOf(entry), SETTLE_MS)
  return fiberStateOf(entry)
}

function fiberOf(entry: unknown): unknown {
  return isRecord(entry) ? entry['fiber'] : undefined
}

function hasCommand(cli: GwbCommands | undefined, name: string): boolean {
  return cli !== undefined && cli.list().some((command) => command.name === name)
}

/** 经命令总线跑 `shell.reload`。没有总线、表里没这条、跑了没成，都收成「界面要手动刷新」 */
async function reloadVia(cli: GwbCommands | undefined): Promise<{ reload: 'done' | 'unavailable'; note?: string }> {
  if (!hasCommand(cli, SHELL_RELOAD_COMMAND) || cli === undefined) {
    return { reload: 'unavailable', note: `命令表里没有 ${SHELL_RELOAD_COMMAND}（外壳没装或版本太旧），界面要手动刷新` }
  }
  const result = await cli.run(SHELL_RELOAD_COMMAND)
  if (result.ok) return { reload: 'done' }
  return { reload: 'unavailable', note: `${SHELL_RELOAD_COMMAND} 没成（${result.error ?? '没说原因'}），界面要手动刷新` }
}

/** 回执里 `note` 那一格：没话说就没有这一格 */
function noteOf(notes: readonly string[]): { note?: string } {
  return notes.length === 0 ? {} : { note: notes.join('；') }
}

/** `plugin-manager.update-all` 的参数：不传、传空对象都是「全升」；给了 only 就得是非空字符串数组 */
function onlyList(args: unknown): string[] | undefined {
  if (args === undefined || args === null) return undefined
  const only = asRecord(args)['only']
  if (only === undefined || only === null) return undefined
  if (!Array.isArray(only) || only.some((item) => typeof item !== 'string' || item === '')) {
    throw new Error('only 给了就要是个非空字符串数组，比如 { "only": ["@godcreator02/gwb-hello"] }')
  }
  return only as string[]
}

/** 命令按参数对象调，不经身份——界面不是一个件，没有身份可绑 */
function asRecord(args: unknown): Record<string, unknown> {
  if (!isRecord(args)) throw new Error('参数要是一个对象，比如 { "entryId": "commands" }')
  return args
}

function text(raw: Record<string, unknown>, key: string): string {
  const value = raw[key]
  if (typeof value !== 'string' || value === '') throw new Error(`${key} 要是个非空字符串`)
  return value
}

function optional(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value === '') throw new Error(`${key} 给了就要是个非空字符串`)
  return value
}

/** 显示名单独一条：**空串是合法的**，它的意思是「抹掉这个名字」 */
function label(raw: Record<string, unknown>): string {
  const value = raw['label']
  if (typeof value !== 'string') throw new Error('label 要是个字符串（空串就是抹掉）')
  return value
}

declare module 'cordis' {
  interface Context {
    gwbPluginManager: GwbPluginManagerApi
  }
}

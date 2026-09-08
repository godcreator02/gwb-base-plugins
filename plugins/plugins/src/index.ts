import { Service } from 'cordis'
import { isRecord, requireKernel, type GwbContext, type GwbResult } from '@godcreator02/gwb-plugin-api'
// 四条空 import 只为激活对方的 `declare module 'cordis'`——它们给 ctx 加上那四个名字。
// 四个件在这儿**都是可选的**，所以都走嵌套注入、都写 dev
import type {} from '@godcreator02/gwb-commands'
import type {} from '@godcreator02/gwb-data'
import type {} from '@godcreator02/gwb-settings'
import type {} from '@godcreator02/gwb-shell'
import type {} from '@godcreator02/gwb-skills'
import { readHomeDependencies } from './home.js'
import { assertId, assertPkgName, bareId, defaultIdFor, installSpec, uniqueId } from './ids.js'
import { readEntries, reconcile, toLabels, type PluginPackageView } from './inventory.js'
import { locatePnpm, runPnpm, runPnpmCapture } from './pnpm.js'
import { parseOutdated, type UpdateInfo } from './outdated.js'
import { isGwbLine, parseSearch, type SearchRow } from './search.js'
import { entriesForPackage } from './uninstall.js'
import { ownEntryId, treeOf, type EntryTreeLike } from './tree.js'

export type { EntrySnapshot, PluginEntryView, PluginPackageView } from './inventory.js'

/**
 * 管 home 里的**包**和 `cordis.yml` 里的**条目**。
 *
 * 两样东西是两回事，这个件的全部工作就是把它们对起来：包由 pnpm 装进 home，条目由
 * loader 写进 `cordis.yml`——**装了包不加条目等于什么都没发生**，而 home 里还躺着一批
 * 永远不该有条目的共享包。
 *
 * **卸载（`uninstall`）= 条目与包一起走人**，设置与数据留盘。第一版刻意不做卸载
 * （「删包比留着危险」），2026-09-08 推翻——装卸检升都齐了、独缺「拿掉」，而危险那半
 * 有解：先摘条目后卸包，pnpm 失败报一句不回滚（改判记在件仓文档站 decisions）。只摘
 * 一条条目、包留着，走 `removeEntry`——两个动作分工，不是同一个的两种写法。
 *
 * 界面那半是一格窗格（`installed`，见 `src/client/`），**「已装」与「可装」两段**：
 * 已装是包 → 条目两层，操作全在条目那一层；可装是 **registry 检索**（`search`，npm 标准
 * 协议、基址从 pnpm 配置来——装从哪来搜就到哪去；原先是一份手工白名单，2026-09-08 一天
 * 内两改：先随市场件并入，同日白名单也退了场），「装」这个动作也归这个件（`install`）。
 * 外加查新版本（`outdated`）与升到最新（`update`，**不建条目**——条目引的是包名，包换
 * 版本条目原样有效）。
 */

const NAME = 'gwb-plugins'

/** 窗格 id。跟 `src/client/index.tsx` 里那个常量对着，认不出的 id 那半会画一句错 */
const PANE_ID = 'installed'

/** 窗格与自述共用一份显示名与图标（lucide 的名字，kebab-case） */
const FACE = { title: '插件', icon: 'puzzle' }

/** 显示名落在本件自己的数据里，一份 裸 id → label 的文档 */
const LABELS_DOC = 'labels'

/**
 * pnpm 装在哪。**home 级**——设置没有机器级，home 自持全部配置；换个 home 重填一次，
 * 或者把旧 home 的 settings.json 里那一行抄过去。
 */
const PNPM_PATH_KEY = 'pnpm-path'

export const LIST_COMMAND = 'plugins.list'
export const INSTALL_COMMAND = 'plugins.install'
export const ADD_ENTRY_COMMAND = 'plugins.add-entry'
export const REMOVE_ENTRY_COMMAND = 'plugins.remove-entry'
export const ENABLE_COMMAND = 'plugins.enable'
export const DISABLE_COMMAND = 'plugins.disable'
export const SET_LABEL_COMMAND = 'plugins.set-label'
export const OUTDATED_COMMAND = 'plugins.outdated'
export const UPDATE_COMMAND = 'plugins.update'
export const SEARCH_COMMAND = 'plugins.search'
export const UNINSTALL_COMMAND = 'plugins.uninstall'

/** 装机的回执 */
export interface InstallResult {
  ok: boolean
  pkg: string
  /** 装成了才有：新加的那条条目的完整 entryId */
  entryId?: string
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

/** 消费方拿到的那一格。写 `inject: ['gwbPlugins']` 才有 */
export interface GwbPluginsApi {
  /** 已装的包 → 它们各自的条目。两边都不丢，判据见 `reconcile` */
  list(): Promise<PluginPackageView[]>
  /**
   * `pnpm add` 进 home，成了再自动加一条条目（**默认启用**）。
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

export default class GwbPlugins extends Service implements GwbPluginsApi {
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

  /** 数据件在才有。不在就退化成「只显示 id」，`setLabel` 回一句「没装数据件」 */
  private labelStore: LabelStore | undefined
  /** 设置件在才有。不在就跳过设置那一路，pnpm 只走自动查找 */
  private settings: SettingsSlot | undefined
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
    super(ctx, 'gwbPlugins')
    this.own = ctx
    this.home = requireKernel(ctx).dataDir
    this.tree = treeOf(ctx)
    // 构造时 this.ctx 还是**提供方**自己的，logger 绑的是本件
    this.warn = (message: string): void => ctx.logger(NAME).warn(message)
    this.info = (message: string): void => ctx.logger(NAME).info(message)
  }

  [Service.init](): void {
    this.wireData()
    this.wireSettings()
    this.wireCommands()
    this.wireShell()
    this.wireSkills()
    this.info(`件管理就绪（ctx.gwbPlugins），自己那条条目是 ${ownEntryId(this.own)}，看表走 ${LIST_COMMAND}`)
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
      const on = (name: string, description: string, handler: (args?: unknown) => unknown): void => {
        ctx.effect(() => cli.register({ name, description, plugin: NAME }, handler))
      }

      on(LIST_COMMAND, 'home 里装了哪些包，各自在 cordis.yml 里有哪些条目', () => this.list())

      on(INSTALL_COMMAND, 'pnpm add 一个包进 home，再自动加一条条目', async (args) => {
        const raw = asRecord(args)
        const result = await this.install(text(raw, 'pkg'), optional(raw, 'spec'))
        if (result.ok) return { ok: true, data: result }
        // 尾巴既拼进 error 那句话（人看的），也原样留在 data 里（界面要单独排版时用）
        const tail = result.tail === undefined ? '' : `\n${result.tail}`
        return { ok: false, error: `${result.error ?? '没说原因'}${tail}`, data: result }
      })

      on(ADD_ENTRY_COMMAND, '给已装的包再加一条条目', async (args) => {
        const raw = asRecord(args)
        const entryId = await this.addEntry(text(raw, 'pkg'), optional(raw, 'id'), raw['config'])
        return { ok: true, data: { entryId } }
      })

      on(REMOVE_ENTRY_COMMAND, '删一条条目（不删包）', (args) => {
        this.removeEntry(text(asRecord(args), 'entryId'))
        return { ok: true }
      })

      on(ENABLE_COMMAND, '启用一条条目', async (args) => {
        await this.enable(text(asRecord(args), 'entryId'))
        return { ok: true }
      })

      on(DISABLE_COMMAND, '停用一条条目', async (args) => {
        await this.disable(text(asRecord(args), 'entryId'))
        return { ok: true }
      })

      on(SET_LABEL_COMMAND, '改一条条目的显示名（给空串就是抹掉）', async (args) => {
        const raw = asRecord(args)
        return this.setLabel(text(raw, 'entryId'), label(raw))
      })

      on(OUTDATED_COMMAND, '查已装的包哪些有新版本（pnpm outdated，不联网到公网）', async () => {
        const result = await this.outdated()
        if (result.ok) return { ok: true, data: result }
        return { ok: false, error: result.error ?? '没说原因' }
      })

      on(UPDATE_COMMAND, '把一个已装的包升到最新（不建条目；跑着的件重启内核后才换新）', async (args) => {
        const result = await this.update(text(asRecord(args), 'pkg'))
        if (result.ok) return { ok: true, data: result }
        const tail = result.tail === undefined ? '' : `\n${result.tail}`
        return { ok: false, error: `${result.error ?? '没说原因'}${tail}`, data: result }
      })

      on(SEARCH_COMMAND, '列 registry 上 @godcreator02/gwb-* 的全部（装从哪条源来，搜就到哪去）', async () => {
        const result = await this.search()
        if (result.ok) return { ok: true, data: result }
        return { ok: false, error: result.error ?? '没说原因' }
      })

      on(UNINSTALL_COMMAND, '卸载一个包：它的全部条目与包一起拿掉，设置与数据留盘（只删一条条目走 plugins.remove-entry）', async (args) => {
        const result = await this.uninstall(text(asRecord(args), 'pkg'))
        if (result.ok) return { ok: true, data: result }
        const tail = result.tail === undefined ? '' : `\n${result.tail}`
        return { ok: false, error: `${result.error ?? '没说原因'}${tail}`, data: result }
      })
    })
  }

  /**
   * 外壳也是可选的：**没装外壳就没有窗格，服务面与命令面照常在**。
   *
   * 这个件跟 logger 反过来——那个件没有外壳就该整个挂不上（一格窗格是它的全部），
   * 这儿窗格只是可选的那一层。
   */
  private wireShell(): void {
    this.own.inject(['gwbShell'], (ctx) => {
      // 两条都不用自己包 ctx.effect：件卸载时表上那两条自动摘掉
      ctx.gwbShell.registerPane({ id: PANE_ID, ...FACE })
      ctx.gwbShell.describeSelf(FACE)
    })
  }

  async list(): Promise<PluginPackageView[]> {
    const deps = await readHomeDependencies(this.home)
    return reconcile(deps, readEntries(this.tree.store), this.labels)
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

    try {
      // 直接建条目、不再回头查一遍清单：pnpm 刚说过它成了，再问一次只是多一条失败路径
      const entryId = await this.createEntry(pkg)
      // 说「加上了」不说「挂上了」——挂载不等它，挂没挂上看 list() 的 active
      this.info(`${target} 装上了，条目 ${entryId} 已加进 cordis.yml`)
      return { ok: true, pkg, entryId }
    } catch (err: unknown) {
      // **不回滚删包**：留着的包会出现在 list() 的「一条条目都没有」那一档里，有落点；
      // 删包比留着危险，而且删的时候未必只删掉这一个
      const error = `${target} 装上了，但条目加不进 cordis.yml：${String(err)}。包留在 home 里，看表走 ${LIST_COMMAND}`
      this.warn(error)
      return { ok: false, pkg, error }
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
    this.info(`${pkg} 升到最新了。跑着的件还持旧代码，重启内核后才换成新的`)
    return { ok: true, pkg }
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
    gwbPlugins: GwbPluginsApi
  }
}

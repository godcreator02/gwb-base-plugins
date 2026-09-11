import { PLUGIN_COMPONENT, pluginParamsIn, shellParamKeysIn } from './panels.js'
import type { RegisteredPane } from './pane-registry.js'

/**
 * 「可以打开的窗格」那张表：注册表的一份快照摊成井里能开的那几格。默认布局、状态栏的
 * ＋列表、导航行项吃的是同一份。
 *
 * **两个概念要分清**：
 *
 * | | 是什么 | 谁产出 |
 * | --- | --- | --- |
 * | 窗格**定义** | 注册表里一条，件说「我有这么一格」 | `pane-registry` |
 * | 窗格**实例** | dockview 里一个 panel，装着不同内容的可以有好几份 | `uniquePanelId` |
 *
 * 这个文件里 `specForPane` / `listOpenable` / `specForOwnPane` 管的都是**定义**，
 * 只有 `uniquePanelId` 管实例。
 *
 * 窗格 id 是 `plugin:<条目 id>:<窗格 id>`——两段都要：同一个包挂两条条目时条目 id
 * 分得开它们，同一条条目注册几格时窗格 id 分得开那几格。
 *
 * **母仓那份是「条目表 × 包声明的 panes」，这份不是**。运行时注册下表里的每一条本身
 * 就带着身份，用不着再跟条目表对：
 *
 * - 没有 join——`pkg` 与 `entryId` 注册时就填好了
 * - 没有过滤——禁用的件根本没跑 `apply`，注册不进来；卸掉的件 effect 收尾时自己摘掉。
 *   「在表里」就等于「该开得出来」，`!disabled && !shell` 那两条判断连同它们会出的错
 *   一起消失了
 * - 没有 `canonicalPanelId`——母仓那个函数整个是老布局兼容（盘上的格 id 少一段），
 *   这条线没有那份历史，盘上的 id 跟表里的算法是同一处拼出来的
 *
 * 零 DOM、零 react，测试在 node 里直接跑。
 */

/** 导航自己也是井里一格，它的 id 与 component 名 */
export const NAV_ID = 'nav'
export const NAV_COMPONENT = 'nav'

/**
 * 落进 dockview 面板的那份 `params`：外壳的识别三件套，加上件开这一份时传的那些键。
 * 两半并排住在一份里，保留键归外壳（名单在 `panels.ts`）。
 */
export interface PanelParams {
  pluginKey: string
  entryId: string
  paneId: string
  /**
   * 这一份**装的是什么**：件开格时给的那个不透明字符串，外壳只拿它找同一格的几份、
   * 不解释内容。件不给等于空串——「没给 key」不是特例。
   */
  key?: string
  /**
   * 这一份是不是**预览格**。只写 `true`，**转正就是把这个键删掉**，不写成 false
   * ——「有没有这个键」与「它是不是 true」两种判法并存的话，迟早有一处只判了其中一种。
   */
  preview?: boolean
  /** 件传的那半。键名由件定，撞上保留键的在入口就摘掉了 */
  [key: string]: unknown
}

/**
 * 件调 `openPane` 时给的那几样。
 *
 * **`params` 必须可 JSON 序列化**：它跟着面板进 `api.toJSON()`、再整档写进 gwbData 的
 * `layout`，重启后原样喂给这一份的 `mountPane`。活对象（函数、DOM 节点、类实例）在那趟
 * 往返里会丢或者写坏，而且是重启之后才现形。
 */
export interface OpenPaneOptions {
  /**
   * 这一份装的是什么。**一格的身份是它装的内容**——外壳拿这个字符串去同一格已开的
   * 几份里找，找得到就聚焦那一份。不透明：外壳一个字都不解释。不给等于空串。
   */
  key?: string
  /** 交给这一份的参数。走到聚焦时不作数、走到软换时原样换上（见 `planOpen`） */
  params?: Record<string, unknown>
  /**
   * 找不到时把内容放进**预览格**：已经有一份预览格就原地换掉它的内容（格数不变），
   * 没有就新开一份并标成预览格。同一格的预览格**至多一份**。
   */
  preview?: boolean
}

/** 一格「可以打开的窗格」。`params` 是要落进 dockview 面板的那份 */
export interface OpenableSpec {
  /** 这是**基名**，不是某一份实例的 id。实例 id 由 `uniquePanelId` 算 */
  id: string
  component: string
  title: string
  icon?: string
  params?: PanelParams
}

/**
 * 这一格**此刻开着的几份**：`planOpen` 认身份、挑预览格、查重都吃这一张表。
 *
 * 由调用方从 dockview 现摘（按 `entryId` + `paneId` 滤），所以这个判断在 node 里直接
 * 测得了。**只装同一格的那几份**：`key` 与 `preview` 都是「这一格之内」的概念，掺进
 * 别的格会让查重把别人的 id 也算上。
 */
export interface OpenPane {
  /** 这一份的 panel id */
  id: string
  /** 这一份装着什么（没给过就是空串） */
  key: string
  /** 这一份是不是预览格 */
  preview: boolean
}

/**
 * 窗格 id 的拼法：两段都进去。只有这一处这么拼，落盘的与表里的因此不会漂。
 *
 * 拼出来的是**基名**——一格只开一份时它就是那份的 id，开第二份时由 `uniquePanelId`
 * 在它后面接。
 *
 * **拼出来的是个不透明的键**，别回头拆它。`entryId` 是 loader 给的条目全路径，件的
 * 条目挂在 include 那条下面、自带 `home:` 前缀（实机是 `home:hello`），所以真实的
 * 窗格 id 长这样：`plugin:home:hello:main`——四段，不是三段。
 *
 * 那个前缀不能去掉：`entryId` 得跟条目视图的 `id` 一字不差，`liveness` 拿它去表里
 * 认这一格背后的件还在不在。改短了就认不出，而认不出会静默地变成错格匹配。
 *
 * 要 entryId 或 paneId 就从面板的 `params` 里取——那儿本来就分开存着，从来不必反解。
 */
export function panelIdOf(entryId: string, paneId: string): string {
  return `plugin:${entryId}:${paneId}`
}

/**
 * 基名 → 这一份实例的 id 与序号。`taken` 由调用方给（浏览器半问 dockview
 * 「这个 id 已经有格了吗」），所以这个函数在 node 里直接测得了。
 *
 * **第一份的 id 就是基名**，跟只能开一份的那些格长得一模一样——落盘的东西因此不受
 * 影响，人读起来也还是那个样子。第二份起在后面接 `:2` / `:3`。
 *
 * **分隔用 `:` 不用 `#`**：`#` 在 CSS 里是 id 选择器，而 panel id 会不会被 dockview
 * 拿去 `querySelector` 我们说不准。全用 `:` 与件自己给的字母数字，哪儿都安全。
 *
 * **序号一并回，不让调用方从 id 里拆**：标题要追的「(2)」得有个正当来源，而反解 id
 * 正是这一族函数的头注反复禁的事。
 */
export function uniquePanelId(base: string, taken: (id: string) => boolean): { id: string; ordinal: number } {
  let ordinal = 1
  let id = base
  while (taken(id)) {
    ordinal += 1
    // 封顶：这个循环跑在 UI 线程上，`taken` 要是坏了恒回 true，窗口就整个冻住——
    // 而「冻住」是所有现象里最难往回查的一种。撞到这儿说明外壳自己坏了，抛出来
    if (ordinal > MAX_INSTANCES) throw new Error(`${base} 开到第 ${String(ordinal)} 份还在撞——查重坏了`)
    id = `${base}:${ordinal}`
  }
  return { id, ordinal }
}

/** 同一格最多开几份。数字本身不重要，它只是「查重坏了」的判据 */
const MAX_INSTANCES = 99

/** 第二份起标题带个序号——两份标题一模一样的话，人在标签条上分不出哪个是哪个 */
export function titleForOrdinal(title: string, ordinal: number): string {
  return ordinal <= 1 ? title : `${title} (${ordinal})`
}

/** 「件说打开某一格」之后该干什么。副作用留给调用方，这儿只出判断 */
export type OpenPlan =
  | { kind: 'focus'; id: string; notice?: string }
  /** 软换：这一格还是这一格，换掉它 params 里装的内容。`params` 是**整份**新的面板 params */
  | { kind: 'retarget'; id: string; params: PanelParams; notice?: string }
  | { kind: 'open'; id: string; title: string; spec: OpenableSpec; notice?: string }
  | { kind: 'none'; notice: string }

/**
 * 件传的那份参数并进面板 params，顺带按上这一份的身份（`key`，预览格再按一个 `preview`）。
 *
 * **外壳的三件套压在最上面**：保留键在这一步之前已由 `pluginParamsIn` 摘掉，这个展开
 * 顺序是第二道锁——件永远改不动这一格的身份。
 *
 * 没有 `params` 的 spec（导航那格）不接参数：它不是插件窗格，件也报不出它。
 */
function withOpenParams(
  spec: OpenableSpec,
  params: Record<string, unknown> | undefined,
  key: string,
  preview: boolean,
): OpenableSpec {
  if (spec.params === undefined) return spec
  const mine = pluginParamsIn(params)
  return { ...spec, params: { ...mine, ...spec.params, key, ...(preview ? { preview: true } : {}) } }
}

/**
 * 落进 dockview 面板的那份 `params`：`spec` 那半，加上标签借道的 `icon`。
 *
 * **开格与软换同吃这一处**：两处各拼一份的话，软换那条会把 `icon` 拼漏——现象是换完
 * 内容标签上的图标变成了兜底那枚，而谁都不会想到是这儿。
 *
 * 没有 `params` 的 spec（导航那格）回 undefined：那格不是插件窗格，它没有身份三件套。
 */
export function panelParamsOf(spec: OpenableSpec): PanelParams | undefined {
  if (spec.params === undefined) return undefined
  return { ...spec.params, ...(spec.icon === undefined ? {} : { icon: spec.icon }) }
}

/** 这一格已开的那几份里，某个 id 占着没有。`uniquePanelId` 要的那个形状 */
function takenIn(open: readonly OpenPane[]): (id: string) => boolean {
  return (id) => open.some((p) => p.id === id)
}

/**
 * 开格的**决策**：这一格的几份里有没有装着这份内容的、该聚焦还是软换还是新开一份、
 * 参数怎么落、要不要顺带说句话。
 *
 * **一格的身份是它装的内容**（`options.key`）。所以这个函数吃的不是「这个 id 占着没有」，
 * 而是**这一格此刻开着的几份**：认身份、挑预览格、查重三件事都要读它。
 *
 * ```
 * want = options.key ?? ''
 * 1. 表里有 p.key === want            → focus 那一份
 * 2. 没有，且没要 preview              → open 一份新的（params 带 key，不带 preview）
 * 3. 没有，且要了 preview
 *    3a. 表里有预览格                  → retarget 它（params 带 key 与 preview: true）
 *    3b. 没有                         → open 一份新的并标成预览格
 * 4. spec 认不出                       → none
 * ```
 *
 * 抽成纯函数是因为这几条分支里有一条**实机点不出来**——「件传的参数踩了保留键」得专门
 * 写一个错的件才走得到。副作用（`setActive` / `updateParameters` / `addPanel` /
 * `console`）全留在接线那一侧，那边就只剩「按 kind 分派」几行。
 *
 * **参数不作用于聚焦**：走到聚焦时那一格装的本来就是这份内容（key 对上了），它早挂好、
 * 件的 `mountPane` 已经拿过一次参数。悄悄换掉面板 params 只会让盘上的档跟界面上活着的
 * 那份对不上——要换内容走的是 preview 那条（软换），那条会连着通知件。
 */
export function planOpen(
  spec: OpenableSpec | undefined,
  options: OpenPaneOptions | undefined,
  open: readonly OpenPane[],
  who: { entryId: string; paneId: string },
): OpenPlan {
  if (spec === undefined) {
    return { kind: 'none', notice: `条目 ${who.entryId} 要开的窗格 ${who.paneId} 不在注册表里` }
  }
  const want = options?.key ?? ''
  const already = open.find((p) => p.key === want)
  // 装着这份内容的那一格已经开着——预览格也好正式格也好，都是它
  if (already !== undefined) return { kind: 'focus', id: already.id }
  const reserved = shellParamKeysIn(options?.params)
  const notice =
    reserved.length === 0 ? undefined : `窗格 ${who.paneId} 传的 params 里 ${reserved.join('、')} 是外壳的保留键，已摘掉`
  const preview = options?.preview === true
  const next = withOpenParams(spec, options?.params, want, preview)
  const nextParams = panelParamsOf(next)
  const slot = preview ? open.find((p) => p.preview) : undefined
  // 预览格至多一份：有一份活着就原地换掉它装的东西，格数不变
  if (slot !== undefined && nextParams !== undefined) {
    return { kind: 'retarget', id: slot.id, params: nextParams, ...(notice === undefined ? {} : { notice }) }
  }
  const { id, ordinal } = uniquePanelId(spec.id, takenIn(open))
  return {
    kind: 'open',
    id,
    title: titleForOrdinal(spec.title, ordinal),
    spec: next,
    ...(notice === undefined ? {} : { notice }),
  }
}

/** 表里一条 → 井里那一格的**定义**。列表与「打开我的某一格」同吃这一处，免得两边拼得不一样 */
export function specForPane(pane: RegisteredPane): OpenableSpec {
  return {
    id: panelIdOf(pane.entryId, pane.id),
    component: PLUGIN_COMPONENT,
    title: pane.title,
    ...(pane.icon === undefined ? {} : { icon: pane.icon }),
    params: { pluginKey: pane.pkg, entryId: pane.entryId, paneId: pane.id },
  }
}

/**
 * 件说「打开我的某一格」时开的是哪一条。**认不出就回 undefined**——调用方什么都不做：
 * 件写错一个字不该在井里凭空多出一格空白。
 *
 * 认的是「这条条目自己的那一格」：`entryId` 由服务那层填，件报不出别人的条目，
 * 也就打不开别人的窗格。
 */
export function specForOwnPane(
  panes: readonly RegisteredPane[],
  entryId: string,
  paneId: string,
): OpenableSpec | undefined {
  const found = panes.find((p) => p.entryId === entryId && p.id === paneId)
  return found === undefined ? undefined : specForPane(found)
}

/** 导航永远排第一——它自己也是可开可关的一格 */
export function listOpenable(panes: readonly RegisteredPane[]): OpenableSpec[] {
  return [
    { id: NAV_ID, component: NAV_COMPONENT, title: '导航', icon: 'panel-left' },
    ...panes.map((pane) => specForPane(pane)),
  ]
}

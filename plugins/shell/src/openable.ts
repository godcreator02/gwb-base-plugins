import { PLUGIN_COMPONENT } from './panels.js'
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
 * | 窗格**实例** | dockview 里一个 panel，声明了 `duplicable` 就能有好几份 | `uniquePanelId` |
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

/** 一格「可以打开的窗格」。`params` 是要落进 dockview 面板的那份 */
export interface OpenableSpec {
  /** 这是**基名**，不是某一份实例的 id。实例 id 由 `uniquePanelId` 算 */
  id: string
  component: string
  title: string
  icon?: string
  /** 准不准开第二份。从注册记录原样带过来——开格那处判它时不用回头再查一遍注册表 */
  duplicable?: boolean
  params?: { pluginKey: string; entryId: string; paneId: string }
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
  | { kind: 'open'; id: string; title: string; spec: OpenableSpec }
  | { kind: 'none'; notice: string }

/**
 * 开格的**决策**：认不认得这一格、该聚焦还是该开新的一份、要不要顺带说句话。
 *
 * 抽成纯函数是因为这四条分支里有两条**实机点不出来**——「件要多份而那格没声明过」
 * 得专门写一个错的件才走得到。副作用（`setActive` / `addPanel` / `console`）全留在
 * 接线那一侧，那边就只剩「按 kind 分派」两行。
 */
export function planOpen(
  spec: OpenableSpec | undefined,
  options: { duplicate?: boolean } | undefined,
  taken: (id: string) => boolean,
  who: { entryId: string; paneId: string },
): OpenPlan {
  if (spec === undefined) {
    return { kind: 'none', notice: `条目 ${who.entryId} 要开的窗格 ${who.paneId} 不在注册表里` }
  }
  const asked = options?.duplicate === true
  // 要多份，而且那格声明过自己经得起多份
  const wantsNew = asked && spec.duplicable === true
  const notice = asked && !wantsNew ? `窗格 ${who.paneId} 没声明 duplicable，开不了第二份——退回聚焦已开的那份` : undefined
  if (!wantsNew && taken(spec.id)) {
    return notice === undefined ? { kind: 'focus', id: spec.id } : { kind: 'focus', id: spec.id, notice }
  }
  const { id, ordinal } = uniquePanelId(spec.id, taken)
  return { kind: 'open', id, title: titleForOrdinal(spec.title, ordinal), spec }
}

/** 表里一条 → 井里那一格的**定义**。列表与「打开我的某一格」同吃这一处，免得两边拼得不一样 */
export function specForPane(pane: RegisteredPane): OpenableSpec {
  return {
    id: panelIdOf(pane.entryId, pane.id),
    component: PLUGIN_COMPONENT,
    title: pane.title,
    ...(pane.icon === undefined ? {} : { icon: pane.icon }),
    ...(pane.duplicable === true ? { duplicable: true } : {}),
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

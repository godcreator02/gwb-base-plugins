import { PLUGIN_COMPONENT } from './panels.js'
import type { RegisteredPane } from './pane-registry.js'

/**
 * 「可以打开的窗格」那张表：注册表的一份快照摊成井里能开的那几格。默认布局、状态栏的
 * ＋列表、导航行项吃的是同一份。
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
  id: string
  component: string
  title: string
  icon?: string
  params?: { pluginKey: string; entryId: string; paneId: string }
}

/**
 * 窗格 id 的拼法：两段都进去。只有这一处这么拼，落盘的与表里的因此不会漂。
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

/** 表里一条 → 井里那一格。列表与「打开我的某一格」同吃这一处，免得两边拼得不一样 */
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

/**
 * 面板 `params` 的读法：这一格是什么种类、背后挂的是哪个插件、哪条条目，以及这份
 * `params` 里哪一半是件自己传的。
 *
 * dockview 里一格是什么，看的是它的 `view.contentComponent`——那是 `addPanel` 时给的
 * component 名，对应 COMPONENTS 表里的键。**不拿 id 当判据**：id 是调用方起的名字
 * （壳自己开的插件格叫 `plugin:<条目 id>`，调试口 `__gwbDebug.openPanel` 开的格叫
 * 什么全由调用方定），拿前缀判种类会把调试口开出来的插件格漏掉。
 *
 * 一格背后是哪个插件同理，看 `params.pluginKey`（完整包名）：它跟条目视图的 `pkg`
 * 是同一个字符串，也是格与条目之间唯一靠得住的对应。
 *
 * 零 import、不碰 DOM，测试在 node 里直接跑。
 */

/** 插件窗格的 component 名（COMPONENTS 表里的那个键） */
export const PLUGIN_COMPONENT = 'plugin'

/** dockview 面板上本文件要看的那一点形状 */
export interface PanelLike {
  view?: { contentComponent?: unknown }
  params?: Record<string, unknown> | undefined
}

/** 这一格是不是插件窗格 */
export function isPluginPanel(panel: PanelLike | null | undefined): boolean {
  return panel?.view?.contentComponent === PLUGIN_COMPONENT
}

/**
 * 这一格挂的是哪个插件（完整包名）。不是插件格、或者 params 里没有这一项，一律回空串
 * ——调用方拿到空串就跳过，不必自己再判一次种类。
 */
export function pluginKeyOf(panel: PanelLike | null | undefined): string {
  if (!isPluginPanel(panel)) return ''
  const key = panel?.params?.pluginKey
  return typeof key === 'string' ? key : ''
}

/**
 * 这一格属于哪条条目（cordis.yml 里那条的 id）。
 *
 * **认不出就回空串**：非插件格，或者 params 里没有这一项。调用方按空串退回按包找——
 * 认不出条目跟「不属于任何条目」是两回事，别拿包名顶上去。
 *
 * （母仓这条判断是为「老布局落盘时 params 只有 pluginKey」写的兼容，**这条线没有那个
 * 历史包袱**。判断仍旧留着：params 缺这一项在这儿属于 bug，而不判的话它会变成静默的
 * 错格匹配——那种错没有任何现象。）
 */
export function entryIdOf(panel: PanelLike | null | undefined): string {
  if (!isPluginPanel(panel)) return ''
  const id = panel?.params?.entryId
  return typeof id === 'string' ? id : ''
}

/**
 * 外壳自己占着的那几个 `params` 键：识别三件套加标签要的图标名。
 *
 * 件经 `openPane` 传的参数跟它们**并排住在同一份 `params` 里**，所以这张名单是两边的
 * 分界：进面板之前件传的这几个键被摘掉（`pluginParamsIn`），出到件手上时同样摘一遍。
 */
export const SHELL_PARAM_KEYS = ['pluginKey', 'entryId', 'paneId', 'icon'] as const

const SHELL_PARAM_KEY_SET = new Set<string>(SHELL_PARAM_KEYS)

/**
 * 这份参数里踩了保留键的那几个名字，按给的顺序回。
 *
 * **摘掉要出声**：件传了 `entryId` 而它被无声无息地丢掉，现象是「我传的参数没到」，
 * 从那头查不到这儿。
 */
export function shellParamKeysIn(params: Record<string, unknown> | undefined): string[] {
  if (params === undefined) return []
  return Object.keys(params).filter((key) => SHELL_PARAM_KEY_SET.has(key))
}

/**
 * 一份 `params` 里**件自己那半**：把保留键摘干净。
 *
 * **一个键都不剩就回 undefined**，不回空对象——件手上 `pane.params === undefined` 因此
 * 干脆地等于「开这一份时没给参数」，用不着再数一遍键。
 */
export function pluginParamsIn(params: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (params === undefined) return undefined
  const mine = Object.entries(params).filter(([key]) => !SHELL_PARAM_KEY_SET.has(key))
  return mine.length === 0 ? undefined : Object.fromEntries(mine)
}


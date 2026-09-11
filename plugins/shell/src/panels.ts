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

/** 这一格是那个件的哪一格（`registerPane` 给的那个 id）。认不出同样回空串 */
export function paneIdOf(panel: PanelLike | null | undefined): string {
  if (!isPluginPanel(panel)) return ''
  const id = panel?.params?.paneId
  return typeof id === 'string' ? id : ''
}

/**
 * 这一格**装的是什么**：件开格时给的那个不透明字符串。
 *
 * **认不出回空串，而空串是个正当的值**——件不给 `key` 就等于给了空串，所以「没给 key」
 * 不是特例，它跟别的 key 走同一条查找路径。
 */
export function paneKeyOf(panel: PanelLike | null | undefined): string {
  if (!isPluginPanel(panel)) return ''
  const key = panel?.params?.key
  return typeof key === 'string' ? key : ''
}

/**
 * 这一格是不是**预览格**（下一次 preview 打开会顶掉它的那一份）。
 *
 * 判的是 `=== true`：正式格身上**没有这个键**（转正就是把它删掉），不是写成 false。
 */
export function isPreviewPanel(panel: PanelLike | null | undefined): boolean {
  if (!isPluginPanel(panel)) return false
  return panel?.params?.preview === true
}

/**
 * 外壳自己占着的那几个 `params` 键：识别三件套、标签要的图标名，加上内容身份这两样
 * （`key` 装的是什么、`preview` 是不是预览格）。
 *
 * 件经 `openPane` 传的参数跟它们**并排住在同一份 `params` 里**，所以这张名单是两边的
 * 分界：进面板之前件传的这几个键被摘掉（`pluginParamsIn`），出到件手上时同样摘一遍。
 *
 * `key` 与 `preview` 进这张名单是有代价的：**件从此不能拿这两个名字当自己的参数名**。
 * 换来的是它们跟着 panel params 落盘——重载之后外壳照旧认得出哪一格装着什么、
 * 哪一格是预览格，不用另存一份账。
 */
export const SHELL_PARAM_KEYS = ['pluginKey', 'entryId', 'paneId', 'icon', 'key', 'preview'] as const

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

/**
 * 拿 `next` **整份换掉** `prev` 时要交给 `api.updateParameters` 的那份。
 *
 * **dockview 的 `updateParameters` 是并不是换**：面板那头做的是 `{ …旧, …新 }`，
 * 只有值写成 `undefined` 的键才删（`DockviewPanel.update`，8.2.0）。所以换内容时旧那份
 * 里多出来的键得**显式写成 `undefined`**——不然上一份的参数会赖在这一格里，跟着
 * `toJSON()` 一起落盘，而现象只是「件收到了一个它这一轮没传过的参数」。
 */
export function replaceParams(
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): Record<string, unknown> {
  if (prev === undefined) return next
  const dropped = Object.keys(prev).filter((key) => !Object.hasOwn(next, key))
  return { ...Object.fromEntries(dropped.map((key) => [key, undefined])), ...next }
}

/**
 * 一份参数的**稳定序列化**：比对「这一份的参数换了没有」用它，别拿对象引用比。
 *
 * 面板 params 每轮渲染都摘出一个新对象，引用永远是新的；而 params 本来就要求可 JSON
 * 序列化（它跟着布局落盘），所以序列化得出来。**键先排序**——同样的内容因为写的顺序
 * 不同而算出两个键，症状是无谓的重挂/软换，没有任何报错。
 */
export function paramsKeyOf(params: Record<string, unknown> | undefined): string {
  if (params === undefined) return ''
  const sorted = Object.keys(params).sort()
  return JSON.stringify(sorted.map((key) => [key, params[key]]))
}


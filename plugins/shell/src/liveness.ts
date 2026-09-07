import { pluginKeyOf, entryIdOf, type PanelLike } from './panels.js'

/**
 * 一格插件窗格背后的插件此刻是什么局面。判据只有一样：`host.config.list` 的条目视图。
 *
 * 宿主卸载插件时不向渲染层广播「你依赖的那个插件没了」，渲染层手上唯一的信号是条目表
 * 变了（`config-changed` / `gwb-plugins-changed` 之后重取的那一份）。所以这里认的是
 * **表里还有没有这条条目**，而不是任何一条卸载事件。
 *
 * **认条目不认包**：同一个包挂两条条目是两份独立配置的实例，各有各的启停。按包找首条
 * 的话，禁用第二条时它那几格照挂照跑，禁用第一条时两条的格一起假死——两种错都不报错。
 * 只有一格报不出 entryId 时才退回按包找首条——那在这条线上属于 bug（母仓那儿是老布局
 * 兼容，我们没有那个包袱），留着这条降级是为了「认不出」不至于变成「认成别人」。
 *
 * 分三档，因为去向完全不一样：
 *
 * - `gone`——条目视图里根本没有这条条目（`gwb plugin remove` 卸了、或 `gwb entry remove`
 *   把条目摘了）。这一格该关掉：留着只会停在最后一帧，窗格里的轮询继续打到已经注销的
 *   命令上，看起来既不像坏了也不像没了
 * - `idle`——条目还在，只是没生效（禁用着，或者带 `unmet` 没挂上）。**格留着**：一句
 *   `gwb entry enable` 它就回来了，而布局是落盘的，替人关掉等于替人丢掉摆好的位置
 * - `live`——正常挂
 *
 * 零 DOM、零 react，测试在 node 里直接跑。
 */

/** 条目视图上本文件要看的那几项（`GwbEntryView` 的子集，按形状收） */
export interface EntryLike {
  /** 条目 id（cordis.yml 里那条的 id） */
  id: string
  /** 包名，跟窗格 params 里的 pluginKey 是同一个字符串 */
  pkg: string
  disabled: boolean
  /** 没挂上时那句给人读的话 */
  unmet?: string
}

/** 一格报得出的身份：新格两样都有，老格只有 pluginKey */
export interface PaneRef {
  pluginKey: string
  entryId?: string
}

export type PanePluginState =
  | { kind: 'live' }
  | { kind: 'gone'; notice: string }
  | { kind: 'idle'; notice: string }

/**
 * `entries` 为 null 的含义是**条目表还没到手**（首帧，或者那条命令失败了），一律按
 * `live` 走：拿一张空表当「插件全卸了」会在启动的头一帧把所有格关光，而那是落盘的
 * 布局，关掉就没了。
 */
export function panePluginState(entries: readonly EntryLike[] | null, ref: PaneRef): PanePluginState {
  // 这一格压根没说自己是谁：缺 pluginKey 那条错由窗格自己报，别在这儿把它关掉
  if (entries === null || ref.pluginKey === '') return { kind: 'live' }
  const entry =
    ref.entryId === undefined
      ? entries.find((e) => e.pkg === ref.pluginKey)
      : entries.find((e) => e.id === ref.entryId)
  if (entry === undefined) return { kind: 'gone', notice: '插件已卸载' }
  if (entry.disabled) return { kind: 'idle', notice: '插件未启用' }
  // unmet 自带前缀（「挂载失败：…」这类），原样摆出来就是完整的一句
  if (entry.unmet !== undefined && entry.unmet !== '') return { kind: 'idle', notice: entry.unmet }
  return { kind: 'live' }
}

/** 一格报得出的身份（非插件格的 pluginKey 是空串，天然落在 live 一档） */
export function paneRefOf(panel: PanelLike | null | undefined): PaneRef {
  const entryId = entryIdOf(panel)
  return entryId === '' ? { pluginKey: pluginKeyOf(panel) } : { pluginKey: pluginKeyOf(panel), entryId }
}

/** 该关掉的那些格 */
export function deadPluginPanels<T extends PanelLike>(
  panels: readonly T[],
  entries: readonly EntryLike[] | null,
): T[] {
  return panels.filter((p) => panePluginState(entries, paneRefOf(p)).kind === 'gone')
}

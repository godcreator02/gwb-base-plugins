import type { DesktopRow } from './layout.js'

/**
 * 桌面那半的纯判断：命令面（`shell.desktop.*`）转进来的动作怎么落到桌面条目上。
 *
 * node 半与浏览器半各存一份事件记号（`DESKTOP_EVENT`）——两边不 import 对方，跟
 * `shell.panes` 那个字符串同一个规矩。判断住这儿（纯机、无 DOM），两侧共用，测试在
 * node 里直接跑。
 */

/** node → 页面那条桌面动作事件上的记号。载荷形状就是 `DesktopAction` */
export const DESKTOP_EVENT = 'gwb-shell-desktop'

/**
 * 页面上执行得了的两条动作。**井在页面那半**，node 半的命令只是把动作经内核事件口
 * 转进去（`gwbKernel.emit` → 页面 `window.gwb.on`，logger 推日志走的同一条路）；
 * 命令回执只代表「转发了」，不代表「切完了」。
 */
export type DesktopAction =
  | { t: typeof DESKTOP_EVENT; action: 'switch'; id?: string; name?: string }
  | { t: typeof DESKTOP_EVENT; action: 'new'; name?: string }

/** 事件载荷的宽松形状：事件口上什么件的事件都有，认了自己那记号再按这个收窄 */
export interface DesktopActionLike {
  t?: unknown
  action?: unknown
  id?: unknown
  name?: unknown
}

/** 是不是一条桌面动作（记号对得上）。事件监听那侧的第一道过滤 */
export function isDesktopAction(payload: unknown): payload is DesktopActionLike {
  if (payload === null || typeof payload !== 'object') return false
  return (payload as DesktopActionLike).t === DESKTOP_EVENT
}

/**
 * 按 id 或名字找那口桌面。**id 优先**：名字不唯一（id 才是身份），名字撞了取第一口
 * ——「叫这个名的里面随便哪口」就是按名字切的语义，报错反而没道理。
 *
 * id / name 都不是非空字符串 → undefined，调用方什么都不做（agent 手滑不该在井里
 * 留下任何动静）。
 */
export function resolveDesktop(
  desktops: readonly DesktopRow[],
  by: { id?: unknown; name?: unknown },
): DesktopRow | undefined {
  if (typeof by.id === 'string' && by.id !== '') return desktops.find((d) => d.id === by.id)
  if (typeof by.name === 'string' && by.name !== '') return desktops.find((d) => d.name === by.name)
  return undefined
}

/** 新桌面的缺省名：跟 id 的号走（d3 → 「桌面 3」） */
export function defaultDesktopName(id: string): string {
  return `桌面 ${id.replace(/^d/, '')}`
}

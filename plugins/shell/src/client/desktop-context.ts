/**
 * 一片 DOM 怎么认出自己在哪口桌面：往上找 `section[data-gwb-desktop]` 那一节。
 *
 * 不另存「格 → 桌面」的账——那种账得跟着开格/关格/挪格走，漂了没有任何现象；而井里的
 * 格**永远是某口 section 的后代**（井就挂在 section 里），问 DOM 祖先永远是当下真话。
 *
 * `data-gwb-desktop` 与 `gwb-portal-host` 都不是样式类：它们是 DOM 约定的把手（跟容器上
 * 的 `data-gwb-plugin` 同性质），不进任何样式表，所以不带 `shell:` 前缀——前缀是给
 * Tailwind 编出来的规则用的，这儿没有规则。
 */

/** 桌面那一节的标记。值就是桌面 id（d1、d2…） */
export const DESKTOP_ATTR = 'data-gwb-desktop'

/** 每口桌面里浮层的户口节点（井的兄弟节点）。件里 radix Portal 的 container 指到它 */
export const PORTAL_HOST_CLASS = 'gwb-portal-host'

/** 这一片 DOM 属于哪口桌面。认不出回空串——空串上没有可见性通知，等价于「永远可见」 */
export function desktopIdOf(el: Element | null): string {
  return el?.closest(`[${DESKTOP_ATTR}]`)?.getAttribute(DESKTOP_ATTR) ?? ''
}

/**
 * 这一片 DOM 所在桌面的浮层户口。**认不出（外壳没按多桌面铺、或这格不在井里）回
 * `document.body`**——那正是 radix Portal 的缺省，等价于「没这个机制」，件不用判空。
 */
export function portalHostOf(el: Element | null): HTMLElement {
  const section = el?.closest(`[${DESKTOP_ATTR}]`)
  const host = section?.querySelector(`:scope > .${PORTAL_HOST_CLASS}`)
  return host instanceof HTMLElement ? host : document.body
}

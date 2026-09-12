/**
 * 桌面可见性的小枢纽（纯机、无 DOM，node 里直接测）。
 *
 * 保活语义下窗格常驻：切走桌面时它的 DOM、定时器、订阅全活着，只是不显示。**页面级的
 * 免费节流帮不上忙**——浏览器那套（rAF 暂停、后台定时器限流）只作用于「整页不可见」，
 * 不作用于同一页里被 CSS 藏掉的一片。所以给件一条协作式的通知：`shell.onVisibility`，
 * 件拿到了自己停订阅、停渲染、停媒体。**外壳只通知、不强制**：同页里没有「暂停某棵
 * 子树的 JS」这个机制，强制只有销毁重建一条路——那是另一条语义。
 *
 * 通知按桌面 id 分发；格怎么认出自己在哪口桌面（DOM 祖先）归 client 侧的
 * desktop-context，不在这儿存「格 → 桌面」的账——那种账得跟着开格/关格/挪格走，
 * 漂了没有任何现象。
 */

export type VisibilityListener = (visible: boolean) => void

const listeners = new Map<string, Set<VisibilityListener>>()
/** 每口桌面最近一次通知的值。注册时先回一次当下值，件就不用自己猜「我现在可见吗」 */
const last = new Map<string, boolean>()

/**
 * 挂一个听众，**注册即回一次当下值**，之后每次切换再回。回注销函数（摘两遍不炸）。
 *
 * 还没通知过的桌面按「可见」起——井只在切到时才挂（首切冷挂），挂上的那一刻它必然可见。
 */
export function subscribeDesktopVisibility(id: string, listener: VisibilityListener): () => void {
  let set = listeners.get(id)
  if (set === undefined) {
    set = new Set()
    listeners.set(id, set)
  }
  set.add(listener)
  // 注册即回一次当下值：件不用自己猜「我现在可见吗」。这一下同样按听众隔离——
  // 听众在注册回调里就退订（off 还没绑上）是正当写法，炸出去就把件挂瘫了
  try {
    listener(last.get(id) ?? true)
  } catch (err) {
    console.error(`[shell] 桌面 ${id} 的可见性听众抛了：`, err)
  }
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(id)
  }
}

/**
 * 通知某口桌面可见与否。听众抛异常按听众隔离（一格写坏了不能把兄弟格带走），
 * 与格间总线同一条规矩。
 */
export function notifyDesktopVisibility(id: string, visible: boolean): void {
  last.set(id, visible)
  const set = listeners.get(id)
  if (set === undefined) return
  // 先抄一份再发：听众里摘自己（收到一次就退订）是正当用法，直接遍历活集合会漏
  // oxlint-disable-next-line unicorn/no-useless-spread
  for (const fn of [...set]) {
    try {
      fn(visible)
    } catch (err) {
      console.error(`[shell] 桌面 ${id} 的可见性听众抛了：`, err)
    }
  }
}

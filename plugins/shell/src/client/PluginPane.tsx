import { useEffect, useRef, useState, type ReactElement } from 'react'
import { loadStyle } from './asset.js'
import { fetchPanes } from './panes.js'
import { desktopIdOf, portalHostOf } from './desktop-context.js'
import { describeHandle, pickDispose, pickMountPane, pickRetarget } from '../mount-handle.js'
import { paramsKeyOf } from '../panels.js'
import { createBusRegistry } from '../bus.js'
import { subscribeDesktopVisibility } from '../visibility.js'
import type { HostBridge, ShellBridge } from './types.js'

/**
 * 一格插件窗格：`mountPane` 契约的外壳这一侧。
 *
 * 契约是 `mountPane({ host, shell, pane }, container) => { dispose() }`。件的 `client.js`
 * 按注册表里那条 `file://` 地址动态 import（件注册时自报的），件源码里的 react 裸名由内核注的 importmap 解析到共享包——
 * 所以件之间拿到的是同一份 React 实例。
 *
 * **样式与模块在同一个 effect 里**：件的表要先注、而且要**等它真到位**再 import，
 * 这两件事是一条时序上的承诺。拆成两个 effect 就只剩「谁先跑」这种靠排列顺序的默契。
 * 格间总线的句柄也在这条 effect 里取、清理时松手——件挂的听众随它一起走。
 *
 * **拿不到 `dispose` 时报契约不符，不装作成功**：那条路上关格时清不掉，让写件的人
 * 当场看见。报错一渲染，容器那个 div 被 React 拆走，而件自己的根（React 根、定时器）
 * 仍挂在那个游离节点上——泄漏从看不见变成看得见，但仍在泄漏。止得住它的只有件按契约
 * 回句柄。
 *
 * **换内容分软硬两条**（外壳把这一格的 params 换掉之后）：件给了 `retarget` 就调它
 * （**软换**，件自己保住该保的状态），没给就**拆了重挂**（硬换）。判的是句柄上有没有
 * 那支函数，不是件说了什么。
 */

/**
 * 格间总线的桶。**一份全局的**：桶按条目共享，得活在组件实例之上——同一条条目的几格
 * （含同一格的两份）各自 acquire 一次，引用计数管着桶什么时候拆。
 */
const busRegistry = createBusRegistry()

export function PluginPane({
  pluginKey,
  entryId,
  paneId,
  panelId,
  paneParams,
  host,
  openPane,
  setTitle,
  keepPane,
}: {
  /** 完整包名 */
  pluginKey: string
  /** 这一格属于哪条条目。总线的桶按它分，`openPane` 的安全边界也靠它 */
  entryId: string
  /** 这一格是这个件的哪一格，交给件自己分派 */
  paneId: string
  /** 这**一份**的唯一键（dockview 的 panel id）。开两份时两份的这个值不一样 */
  panelId: string
  /** 这一份此刻装着什么（件传的那份参数，保留键已摘）。同一格开出的几份靠它彼此不同 */
  paneParams: Record<string, unknown> | undefined
  host: HostBridge
  /** 开本件另一格。entryId 已经由上层绑好，件报不出别人的 */
  openPane: ShellBridge['openPane']
  /** 改这一格标签上的标题。绑的是这一份自己的 panel api，件改不到别人 */
  setTitle: ShellBridge['setPaneTitle']
  /** 把这一格留住（不再是预览格）。同样绑这一份自己的 panel api */
  keepPane: ShellBridge['keepPane']
}): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  // **经 ref 转一道，不进依赖数组**：这几个函数在面板组件里每轮渲染都是个新闭包，
  // 直接进依赖会让整个件被反复拆了重挂。件手上那个 shell 是挂载时给的一份
  const openPaneRef = useRef(openPane)
  openPaneRef.current = openPane
  const setTitleRef = useRef(setTitle)
  setTitleRef.current = setTitle
  const keepPaneRef = useRef(keepPane)
  keepPaneRef.current = keepPane
  // **同样经 ref、不进依赖数组**：这是从面板 params 摘出来的新对象，每轮渲染都换引用。
  // 挂载时读一次（读到的一定是最新那份），之后由下面那条 effect 按**稳定序列化**比对着换
  const paneParamsRef = useRef(paneParams)
  paneParamsRef.current = paneParams
  /** 件给的那支软换。挂上了才有，硬换那条永远是 undefined */
  const retargetRef = useRef<((params: Record<string, unknown>) => void) | undefined>(undefined)
  /** 件真挂上了没有。没挂上时换 params 什么都不用做——挂的时候读的就是最新那份 */
  const mountedRef = useRef(false)
  /** 硬换的扳手：加一下，下面那条挂载 effect 就重跑一遍（拆了重挂） */
  const [remounts, setRemounts] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const container = hostRef.current
    if (container === null) return
    let disposed = false
    let dispose: (() => void) | undefined
    // 桶按条目取。这一格松手时引用计数减一，最后一格走了整个桶才拆
    const bus = busRegistry.acquire(entryId)
    // 桌面那两样**现查现给，不拍快照**：挂载那一刻 dockview 的面板 DOM 可能还没接进
    // 桌面那一节，`closest` 找不到就兜底 body，而快照永不刷新——浮层从此一直挂 body、
    // 桌面切走藏不掉（实机撞过：带着开着的菜单切桌面，菜单漏到别人的桌面上）。getter
    // 在件真用它的那一刻解析（开菜单的 render、订可见性的调用），那时 DOM 早已就位
    const shell: ShellBridge = {
      openPane: (target, options) => openPaneRef.current(target, options),
      setPaneTitle: (title) => setTitleRef.current(title),
      keepPane: () => keepPaneRef.current(),
      bus: { emit: (type, detail) => bus.emit(type, detail), on: (type, fn) => bus.on(type, fn) },
      get portal() {
        return portalHostOf(container)
      },
      onVisibility: (listener) => subscribeDesktopVisibility(desktopIdOf(container), listener),
    }
    setError(null)
    setReady(false)

    void (async () => {
      try {
        // 地址在注册表里，件注册时从自己的 import.meta.url 算好报上来的。每次开格现取：表是会变的
        const row = (await fetchPanes(host)).find((r) => r.entryId === entryId && r.id === paneId)
        if (row === undefined) throw new Error(`注册表里没有条目 ${entryId} 的窗格 ${paneId}——件卸了？`)
        if (row.client === undefined) throw new Error(`${pluginKey} 注册窗格 ${paneId} 时没报浏览器半的地址（client）`)
        // 表取不到不是错——件可以没有样式表。取到了才等它到位
        if (row.style !== undefined) await loadStyle(row.style)
        if (disposed) return
        // 动态 import 回来的是 any，先落成 unknown 再按契约取
        const mod: unknown = await import(/* @vite-ignore */ row.client)
        if (disposed) return
        const mountPane = pickMountPane(mod)
        if (mountPane === undefined) {
          throw new Error(`${pluginKey} 的 client.js 没有 mountPane 导出——那是窗格件的入口名`)
        }
        // 没传参数就不给这一项：件那头 `pane.params === undefined` 干脆地等于「没给」
        const openParams = paneParamsRef.current
        const pane = { id: paneId, instance: panelId, ...(openParams === undefined ? {} : { params: openParams }) }
        const handle = mountPane({ host, shell, pane }, container)
        dispose = pickDispose(handle)
        // 软换那支是可选的：挑不到就是这个件走硬换，不是契约不符
        retargetRef.current = pickRetarget(handle)
        mountedRef.current = true
        if (dispose === undefined) {
          setError(
            `${pluginKey} 的 mountPane 没按契约回 { dispose() }，回的是${describeHandle(handle)}——关掉窗格时清理不了`,
          )
          return
        }
        if (!disposed) setReady(true)
      } catch (err) {
        if (!disposed) setError(String(err))
      }
    })()

    return () => {
      disposed = true
      mountedRef.current = false
      retargetRef.current = undefined
      try {
        dispose?.()
      } catch (err) {
        // 卸载路径上的异常没有别的出口，吞掉就等于件的清理从来没跑过而谁也不知道
        console.error(`[shell] ${pluginKey} 的 dispose 抛了：`, err)
      }
      bus.release()
    }
    // **`paneParams` 故意不在这张表里**：它每轮渲染都是个新对象，进来就是反复拆了重挂。
    // 换内容走下面那条 effect，比的是它的稳定序列化；硬换要重挂时扳 `remounts`
  }, [pluginKey, entryId, paneId, panelId, host, remounts])

  /**
   * 这一格装的东西换了（外壳软换了面板 params）。**软换优先**：件给了 `retarget` 就调它，
   * 那一格的 React 树、滚动位置、正在打的字全留着；没给才扳 `remounts` 拆了重挂。
   *
   * 比的是 `paramsKeyOf` 算出来的**稳定序列化**，不是对象引用——面板 params 每轮渲染都
   * 摘出一个新对象，按引用比等于每轮都算「换了」。
   *
   * **件还没挂上时什么都不做**：挂载那条链读的是 `paneParamsRef.current`，读到的一定是
   * 最新那份。这时候扳重挂只会把正在挂的那一次白白掐掉。
   */
  const paramsKey = paramsKeyOf(paneParams)
  useEffect(() => {
    if (!mountedRef.current) return
    const retarget = retargetRef.current
    if (retarget === undefined) {
      setRemounts((n) => n + 1)
      return
    }
    try {
      retarget(paneParamsRef.current ?? {})
    } catch (err) {
      // 件的 retarget 抛了：这一格现在显示的是上一份内容，而人刚点的那下看着像没反应
      console.error(`[shell] ${pluginKey} 的 retarget 抛了：`, err)
    }
    // 只认 paramsKey（`pluginKey` 只是那句错话里的名字）：别的都经 ref 现读，
    // 进来就是无谓的软换
  }, [paramsKey, pluginKey])

  if (error !== null) {
    return <p className="shell:text-destructive shell:m-0 shell:p-3 shell:text-sm">加载失败：{error}</p>
  }

  return (
    <div className="shell:relative shell:h-full">
      {/*
        `@container` 让这一格成为容器查询的根：**窗格不是视口**，件里写的 `@sm:` / `@md:`
        这类变体按这一格现在有多宽来判，跟整窗大小无关——同一个件在窄格里竖排、在宽格里
        横排，拖动分隔条当场变。类名带 `shell:` 是因为这条规则出自**外壳自己那张表**
        （容器是外壳画的），件那边写的 `@md:` 用的是件自己的前缀，两者互不相干。

        **`data-gwb-plugin` 只是身份标记**：围栏是类名前缀——每个件的类名从源头就带自己
        那一份（`hello:flex` / `shell:flex`），规则全页有效但只匹配得上本件的元素，跟
        DOM 祖先关系无关。挂这个属性是为了让人在 devtools 里一眼看出这一格是谁的，
        以及给外部（探针、样式调试）一个认件的把手。
      */}
      <div ref={hostRef} data-gwb-plugin={pluginKey} className="shell:@container shell:h-full shell:overflow-auto" />
      {!ready && (
        <p className="shell:text-muted-foreground shell:pointer-events-none shell:absolute shell:inset-x-0 shell:top-2 shell:m-0 shell:text-center shell:text-sm">
          加载中…
        </p>
      )}
    </div>
  )
}

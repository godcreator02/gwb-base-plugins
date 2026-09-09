import { useEffect, useRef, useState, type ReactElement } from 'react'
import { loadStyle } from './asset.js'
import { fetchPanes } from './panes.js'
import { describeHandle, pickDispose, pickMountPane } from '../mount-handle.js'
import { createBusRegistry } from '../bus.js'
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
  host,
  openPane,
  setTitle,
}: {
  /** 完整包名 */
  pluginKey: string
  /** 这一格属于哪条条目。总线的桶按它分，`openPane` 的安全边界也靠它 */
  entryId: string
  /** 这一格是这个件的哪一格，交给件自己分派 */
  paneId: string
  /** 这**一份**的唯一键（dockview 的 panel id）。开两份时两份的这个值不一样 */
  panelId: string
  host: HostBridge
  /** 开本件另一格。entryId 已经由上层绑好，件报不出别人的 */
  openPane: ShellBridge['openPane']
  /** 改这一格标签上的标题。绑的是这一份自己的 panel api，件改不到别人 */
  setTitle: ShellBridge['setPaneTitle']
}): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  // **经 ref 转一道，不进依赖数组**：这个函数在面板组件里每轮渲染都是个新闭包，
  // 直接进依赖会让整个件被反复拆了重挂。件手上那个 shell 是挂载时给的一份
  const openPaneRef = useRef(openPane)
  openPaneRef.current = openPane
  const setTitleRef = useRef(setTitle)
  setTitleRef.current = setTitle
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const container = hostRef.current
    if (container === null) return
    let disposed = false
    let dispose: (() => void) | undefined
    // 桶按条目取。这一格松手时引用计数减一，最后一格走了整个桶才拆
    const bus = busRegistry.acquire(entryId)
    const shell: ShellBridge = {
      openPane: (target, options) => openPaneRef.current(target, options),
      setPaneTitle: (title) => setTitleRef.current(title),
      bus: { emit: (type, detail) => bus.emit(type, detail), on: (type, fn) => bus.on(type, fn) },
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
        const handle = mountPane({ host, shell, pane: { id: paneId, instance: panelId } }, container)
        dispose = pickDispose(handle)
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
      try {
        dispose?.()
      } catch (err) {
        // 卸载路径上的异常没有别的出口，吞掉就等于件的清理从来没跑过而谁也不知道
        console.error(`[shell] ${pluginKey} 的 dispose 抛了：`, err)
      }
      bus.release()
    }
  }, [pluginKey, entryId, paneId, panelId, host])

  if (error !== null) {
    return <p className="text-destructive m-0 p-3 text-sm">加载失败：{error}</p>
  }

  return (
    <div className="relative h-full">
      {/*
        `@container` 让这一格成为容器查询的根：**窗格不是视口**，件里写的 `@sm:` / `@md:`
        这类变体按这一格现在有多宽来判，跟整窗大小无关——同一个件在窄格里竖排、在宽格里
        横排，拖动分隔条当场变。

        `data-gwb-plugin` 对两代件意义不同：选择器 scope 那套方案的件（表整张包在
        `:where([data-gwb-plugin="…"])` 之下）仍靠它围栏，容器上不挂它，那些件的类名
        一个都不生效；Tailwind 前缀方案的件（类名自带 `hello:` 这种前缀）不靠它，
        对它们这个属性只是身份标记。
      */}
      <div ref={hostRef} data-gwb-plugin={pluginKey} className="@container h-full overflow-auto" />
      {!ready && (
        <p className="text-muted-foreground pointer-events-none absolute inset-x-0 top-2 m-0 text-center text-sm">
          加载中…
        </p>
      )}
    </div>
  )
}

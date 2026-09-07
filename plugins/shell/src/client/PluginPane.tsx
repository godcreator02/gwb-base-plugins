import { useEffect, useRef, useState, type ReactElement } from 'react'
import { assetUrl, clientUrl, loadStyle } from './asset.js'
import { describeHandle, pickDispose, pickMountPane } from '../mount-handle.js'
import type { HostBridge } from './types.js'

/**
 * 一格插件窗格：`mountPane` 契约的外壳这一侧。
 *
 * 契约是 `mountPane({ host, pane }, container) => { dispose() }`。件的 `client.js`
 * 经 `gwb://` 动态 import，件源码里的 react 裸名由页面 importmap 解析到共享包——
 * 所以件之间拿到的是同一份 React 实例。
 *
 * **样式与模块在同一个 effect 里**：件的表要先注、而且要**等它真到位**再 import，
 * 这两件事是一条时序上的承诺。拆成两个 effect 就只剩「谁先跑」这种靠排列顺序的默契。
 *
 * **拿不到 `dispose` 时报契约不符，不装作成功**：那条路上关格时清不掉，让写件的人
 * 当场看见。报错一渲染，容器那个 div 被 React 拆走，而件自己的根（React 根、定时器）
 * 仍挂在那个游离节点上——泄漏从看不见变成看得见，但仍在泄漏。止得住它的只有件按契约
 * 回句柄。
 */
export function PluginPane({
  pluginKey,
  paneId,
  host,
}: {
  /** 完整包名 */
  pluginKey: string
  /** 这一格是这个件的哪一格，交给件自己分派 */
  paneId: string
  host: HostBridge
}): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const container = hostRef.current
    if (container === null) return
    let disposed = false
    let dispose: (() => void) | undefined
    setError(null)
    setReady(false)

    void (async () => {
      try {
        // 表取不到不是错——件可以没有样式表。取到了才等它到位
        await loadStyle(assetUrl(pluginKey, 'style.css'))
        if (disposed) return
        // 动态 import 回来的是 any，先落成 unknown 再按契约取
        const mod: unknown = await import(/* @vite-ignore */ clientUrl(pluginKey))
        if (disposed) return
        const mountPane = pickMountPane(mod)
        if (mountPane === undefined) {
          throw new Error(`${pluginKey} 的 client.js 没有 mountPane 导出——那是窗格件的入口名`)
        }
        const handle = mountPane({ host, pane: { id: paneId } }, container)
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
    }
  }, [pluginKey, paneId, host])

  if (error !== null) {
    return <p className="text-destructive m-0 p-3 text-sm">加载失败：{error}</p>
  }

  return (
    <div className="relative h-full">
      {/* 件的表整张 scope 在这个属性之下——容器上不挂它，件的类名一个都不生效 */}
      <div ref={hostRef} data-gwb-plugin={pluginKey} className="h-full overflow-auto" />
      {!ready && (
        <p className="text-muted-foreground pointer-events-none absolute inset-x-0 top-2 m-0 text-center text-sm">
          加载中…
        </p>
      )}
    </div>
  )
}

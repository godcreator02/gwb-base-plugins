import { mountPane as mountLoggerPane } from './panes/logger/index'
import { mountPane as mountPluginManagerPane } from './panes/plugin-manager/index'

/**
 * 浏览器半入口：外壳开格时 import 本文件（dist/client.js），挑 `mountPane` 导出调进来。
 *
 * 本件是多窗格件——node 半注册了几格，这里就分派几路。两格吃同一份 client.js 与
 * style.css，靠 `pane.id` 认门；认不出的 id 画一句错，跟单格件的兜底一个待遇。
 *
 * 分派的代价要认：**任何一格的代码改动都重发整个 baseui**——这是「聚合的是发布，
 * 不是开发」的另一半，窗格之间零 import 的规矩（见 src/index.ts 头注）就是为把这笔
 * 代价摁在最低：一格改动不会牵连另一格的行为，只有发版那一脚是绑在一起的。
 */

/** 外壳调 `mountPane` 时给的那几样。按形状收，取两窗格的并集（正本在 shell 件的 client/types.ts） */
interface PaneArgs {
  host: { call: (command: string, args?: unknown) => Promise<unknown> }
  shell: {
    openPane: (paneId: string, options?: { key?: string; params?: Record<string, unknown>; preview?: boolean }) => void
    portal: HTMLElement
    onVisibility: (listener: (visible: boolean) => void) => () => void
    bus: {
      emit: (type: string, detail?: unknown) => void
      on: (type: string, listener: (detail: unknown) => void) => () => void
    }
  }
  pane: { id: string; instance: string }
}

/** 分派表。id 与 node 半 registerPane 报的对得上——两处各存一份，像命令名一样 */
export function mountPane(args: PaneArgs, container: HTMLElement): { dispose(): void } {
  switch (args.pane.id) {
    case 'logger':
      return mountLoggerPane(args, container)
    case 'plugin-manager':
      return mountPluginManagerPane(args, container)
    default:
      container.textContent = `基础界面没有叫 ${args.pane.id} 的窗格`
      return {
        dispose() {
          container.textContent = ''
        },
      }
  }
}

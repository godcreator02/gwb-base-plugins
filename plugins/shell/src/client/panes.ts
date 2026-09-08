import type { HostBridge, PaneRow } from './types.js'

/** 取表那条命令。跟 node 半的 PANES_COMMAND 是同一个字符串，各存一份（浏览器半不 import node 半） */
const PANES_COMMAND = 'shell.panes'

/**
 * 取一次注册表。**取不到回空表并记一条错**：外壳照样画出空井，因为「一个件都没注册」
 * 本来就是合法状态，而井在不在跟表取没取到是两回事。
 *
 * 井与每一格开格时都现取，不存快照：件是热挂载的，表是会变的。
 */
export async function fetchPanes(host: HostBridge): Promise<PaneRow[]> {
  try {
    const reply = (await host.call(PANES_COMMAND)) as { ok?: boolean; data?: unknown; error?: string }
    if (reply.ok !== true || !Array.isArray(reply.data)) {
      console.error(`[shell] ${PANES_COMMAND} 没回一张表：${reply.error ?? JSON.stringify(reply)}`)
      return []
    }
    return reply.data as PaneRow[]
  } catch (err) {
    console.error(`[shell] ${PANES_COMMAND} 调不通：${String(err)}`)
    return []
  }
}

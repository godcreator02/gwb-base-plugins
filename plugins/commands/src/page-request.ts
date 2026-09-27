import type { CommandTable } from './registry.js'
import type { GwbResult } from './result.js'

/** 页面不能通过载荷指定来源；来源由这个接入点决定。 */
export function runPageCommand(table: CommandTable, payload: unknown): Promise<GwbResult> {
  if (payload === null || typeof payload !== 'object' || !('name' in payload) || typeof payload.name !== 'string') {
    return Promise.resolve({ ok: false, error: '命令名要是字符串' })
  }
  return table.run(payload.name, 'args' in payload ? payload.args : undefined, { via: 'ui' })
}

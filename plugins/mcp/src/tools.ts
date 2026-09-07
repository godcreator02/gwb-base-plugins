import type { GwbResult } from '@godcreator02/gwb-plugin-api'

/**
 * 命令回执 → MCP 工具回执的翻译。纯函数，从接线里抽出来于是可测。
 */

/**
 * SDK 的 CallToolResult 里用得到的那个子集：只有文本一种内容。
 * 索引签名不能省——SDK 那个类型带 `[x: string]: unknown`（`_meta` 之类的扩展位），
 * 少了它这份就赋不过去。
 */
export interface ToolResult {
  [key: string]: unknown
  content: { type: 'text'; text: string }[]
  isError?: true
}

/** 把任意值包成一条文本回执 */
export function textResult(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

/**
 * `GwbResult` 信封摊成 MCP 回执。
 *
 * **业务失败不是协议错误**：命令不存在、参数不对这些回 `isError` 的文本，让 agent
 * 自己读原因接着往下走，连接不断。抛出去只会让对面看见一条 JSON-RPC 错误、不知道
 * 是自己叫错了还是这台工作台坏了。
 */
export function toolResult(value: GwbResult): ToolResult {
  if (value.ok) return textResult({ ok: true, data: value.data ?? null })
  return { content: [{ type: 'text', text: `执行失败：${value.error ?? '未知错误'}` }], isError: true }
}

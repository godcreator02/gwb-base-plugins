import type { GwbResult } from '@godcreator/gwb-kernel-desktop'

// 命令回执 → MCP 工具结果

/** SDK 的 CallToolResult 里用得到的子集：只有文本。索引签名不能省，SDK 那个类型带 `[x: string]: unknown` */
export interface ToolResult {
  [key: string]: unknown
  content: { type: 'text'; text: string }[]
  isError?: true
}

export function textResult(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

/** 有的客户端把对象参数序列化成 JSON 字符串再发：字符串先试着解析，解析不了原样交给命令自己校验 */
export function coerceArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

/** 标准回执只有 `ok` / `data` / `error` 三个键；多一个键就是处理函数原样返回的对象，不能当标准回执拆 */
function isHandlerOwnObject(value: object): boolean {
  return Object.keys(value).some((k) => k !== 'ok' && k !== 'data' && k !== 'error')
}

/** 命令失败不是协议错误：回带 `isError` 的文本，agent 读了原因接着往下走，连接不断 */
export function toolResult(value: GwbResult): ToolResult {
  if (typeof value === 'object' && value !== null && isHandlerOwnObject(value)) return textResult(value)
  if (value.ok) return textResult({ ok: true, data: value.data ?? null })
  return { content: [{ type: 'text', text: `执行失败：${value.error ?? '未知错误'}` }], isError: true }
}

/** 命令行运行插件回执里本插件用到的字段，本地声明，不依赖那两个插件 */
export interface CliRunResultView {
  ok: boolean
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  timeoutMs: number
  stdout: { text: string; truncated: boolean; spillPath?: string }
  stderr: { text: string; truncated: boolean; spillPath?: string }
  durationMs: number
}

/** 命令行运行插件的回执自带 `ok`，由命令总线原样交回；`stdout`、`exitCode` 在最外层 */
export function isCliRunResult(value: GwbResult): value is GwbResult & CliRunResultView {
  return typeof value === 'object' && value !== null && 'stdout' in value && 'exitCode' in value
}

/** 进程回执原样给 agent；失败也不是协议错误，退出码与 stderr 由 agent 自己读 */
export function cliRunResult(result: CliRunResultView): ToolResult {
  return textResult({
    ok: result.ok,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
  })
}

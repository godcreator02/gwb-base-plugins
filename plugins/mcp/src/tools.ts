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
 * args 的宽容收口。`args` 的 schema 是 `z.unknown()`，任何形状都在协议层放行——而有的
 * 客户端把嵌套对象参数**序列化成 JSON 字符串**才发（实测 2026-09-13：经 ZCode 调
 * `settings.get`，`args` 到达命令端时已是字符串，`isRecord` 一律拒收；同一个调用换
 * curl 直发对象就成。带字符串值的命令因此全军覆没，无参命令幸存）。
 *
 * 所以字符串先 `JSON.parse` 一把：解析成了用解析的；解析不了原样往下送，让命令自己
 * 的校验说话。JSON 字面量（`"123"`、`"true"`）解析后是无损 round-trip，不伤合法调用。
 */
export function coerceArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

/**
 * 总线的规矩是「handler 回值自带 `ok` 就原样透传」——那类回执（比如 glm-quota 的快照，
 * `ok` 之外还有 `at` / `view` 一堆自己的字段）**不是信封**，摊平只会把字段全丢成
 * `data: null`。信封的形状是只有 `ok` / `data` / `error` 三个键；多一个键就是原话。
 */
function isPassthrough(value: object): boolean {
  return Object.keys(value).some((k) => k !== 'ok' && k !== 'data' && k !== 'error')
}

/**
 * `GwbResult` 信封摊成 MCP 回执。
 *
 * **业务失败不是协议错误**：命令不存在、参数不对这些回 `isError` 的文本，让 agent
 * 自己读原因接着往下走，连接不断。抛出去只会让对面看见一条 JSON-RPC 错误、不知道
 * 是自己叫错了还是这台工作台坏了。
 */
export function toolResult(value: GwbResult): ToolResult {
  if (typeof value === 'object' && value !== null && isPassthrough(value)) return textResult(value)
  if (value.ok) return textResult({ ok: true, data: value.data ?? null })
  return { content: [{ type: 'text', text: `执行失败：${value.error ?? '未知错误'}` }], isError: true }
}

/**
 * CLI 运行器回执的形状。node-cli 与 py-cli 的 run.ts 是同一份的两处拷贝，回执形状
 * 一字不差；这儿只收 MCP 用得着的面，本地收窄声明——不欠两个运行器一个依赖。
 */
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

/**
 * 把 CLI 运行器透传的那份认出来。
 *
 * 运行器回执**自带 `ok`**（进程成败），总线「带 ok 就透传」的规矩让它原样冒充回执
 * 本体——`stdout`/`exitCode` 全在信封外面，照普通回执拆只会拆出 `data:null`。
 */
export function isCliRunResult(value: GwbResult): value is GwbResult & CliRunResultView {
  return typeof value === 'object' && value !== null && 'stdout' in value && 'exitCode' in value
}

/** CLI 回执摊平：进程回执原样给 agent。失败也不是协议错误——退出码与 stderr 自己读 */
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

/**
 * 命令名 → 工具名：`.` 与 `-` 一律压成 `_`（`skill.list`→`skill_list`、
 * `node-cli.list`→`node_cli_list`）。压平后撞名的按序号让路——注册表两段名不同、
 * 压平后同节的场合。
 */
export function toolNameOf(command: string, taken: ReadonlySet<string>): string {
  const base = command.replaceAll(/[.-]/g, '_')
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`
  return name
}

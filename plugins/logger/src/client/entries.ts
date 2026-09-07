/**
 * 条目本身：形状、判形、两段归并。
 *
 * **不引内核的类型包**：条目跨 IPC 过来，本来就得当 `unknown` 收窄一次；正本钉在内核仓的
 * 契约页上，这儿按形状收。跟 hello 的 client 同一个规矩——浏览器半不牵 node 那边的包。
 */

export const SOURCES = ['plugin', 'host', 'main', 'renderer'] as const
export type LogSource = (typeof SOURCES)[number]

/** 从严重到不严重。门限筛选靠这个顺序 */
export const LEVELS = ['error', 'warn', 'info', 'debug'] as const
export type LogLevel = (typeof LEVELS)[number]

export interface LogEntry {
  /** 主进程发的号，**唯一键**。去重与排序都用它 */
  seq: number
  ts: number
  source: LogSource
  level: LogLevel
  name: string
  msg: string
}

const SOURCE_SET: ReadonlySet<string> = new Set(SOURCES)
const LEVEL_SET: ReadonlySet<string> = new Set(LEVELS)

/**
 * 判形。**认不出的丢掉、不崩**——内核改了形状而这个件没跟上时，宁可少几行日志，
 * 也不要整格窗格白屏。
 */
export function isLogEntry(value: unknown): value is LogEntry {
  if (value === null || typeof value !== 'object') return false
  const { seq, ts, source, level, name, msg } = value as Record<string, unknown>
  return (
    typeof seq === 'number' &&
    Number.isFinite(seq) &&
    typeof ts === 'number' &&
    typeof source === 'string' &&
    SOURCE_SET.has(source) &&
    typeof level === 'string' &&
    LEVEL_SET.has(level) &&
    typeof name === 'string' &&
    typeof msg === 'string'
  )
}

/** 一批里挑出认得出的那些 */
export function acceptEntries(batch: unknown): LogEntry[] {
  if (!Array.isArray(batch)) return []
  return batch.filter(isLogEntry)
}

/**
 * 把新来的接到已有的后面。
 *
 * **去重靠 `seq`，不靠内容**：历史段与实时那两段必然交叠一小截（先订阅、后取 backlog），
 * 而同一毫秒里两句一模一样的话是常事——拿 `ts|name|msg` 拼字符串当键会静默吃掉第二句。
 *
 * 超过 `cap` 从头切。这个上限是**渲染成本**定的（一行一个 div，没有虚拟滚动），
 * 不是缓冲大小：内核那圈缓冲比它大，翻更早的去日志文件。
 */
export function mergeEntries(prev: readonly LogEntry[], incoming: readonly LogEntry[], cap: number): LogEntry[] {
  if (incoming.length === 0) return prev as LogEntry[]
  const seen = new Set(prev.map((e) => e.seq))
  const fresh = incoming.filter((e) => !seen.has(e.seq))
  if (fresh.length === 0) return prev as LogEntry[]
  const merged = [...prev, ...fresh].sort((a, b) => a.seq - b.seq)
  return merged.length > cap ? merged.slice(merged.length - cap) : merged
}

/** `HH:mm:ss.SSS`。四路合流之后「谁先谁后」是最常问的，秒级分不开 */
export function clockOf(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

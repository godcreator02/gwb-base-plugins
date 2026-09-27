import { isRecord } from './vocab.js'

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'
export type LogSource = 'kernel' | 'plugin' | 'renderer'

/** `gwb.log` 里的一行：键与顺序由内核定（日志接缝的契约） */
export interface LogEntry {
  ts: string
  level: LogLevel
  source: LogSource
  name: string
  msg: string
}

export const LEVELS_FROM_LOWEST: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']
const SOURCES: readonly LogSource[] = ['kernel', 'plugin', 'renderer']
const KEYS_IN_ORDER = 'ts,level,source,name,msg'
const LINE_PREFIX_CHARS = 60

export function linePrefix(line: string): string {
  return line.length > LINE_PREFIX_CHARS ? `${line.slice(0, LINE_PREFIX_CHARS)}…` : line
}

function isLogEntry(value: unknown): value is LogEntry {
  return (
    isRecord(value) &&
    Object.keys(value).join(',') === KEYS_IN_ORDER &&
    typeof value['ts'] === 'string' &&
    LEVELS_FROM_LOWEST.includes(value['level'] as LogLevel) &&
    SOURCES.includes(value['source'] as LogSource) &&
    typeof value['name'] === 'string' &&
    typeof value['msg'] === 'string'
  )
}

/** 日志文件是外部输入：不是 JSON、键或类型对不上都直接报错，写明文件与行首 */
export function entryFromLine(line: string, file: string): LogEntry {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch (err) {
    throw new Error(`${file} 里有一行不是 JSON：${linePrefix(line)}`, { cause: err })
  }
  if (!isLogEntry(parsed)) {
    throw new Error(`${file} 里有一行不是 { ts, level, source, name, msg }（键的顺序、值的类型要与内核写的一致）：${linePrefix(line)}`)
  }
  return parsed
}

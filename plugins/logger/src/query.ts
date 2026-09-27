import fs from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { LEVELS_FROM_LOWEST, entryFromLine } from './log-entry.js'
import type { LogEntry, LogLevel } from './log-entry.js'
import { endOfLastCompleteLine, linesNewestFirst } from './log-file-reader.js'
import type { ByteRange } from './log-file-reader.js'
import { isRecord } from './vocab.js'

export const QUERY_COMMAND = 'logger.query'

const DEFAULT_LIMIT = 2000

export const QUERY_USAGE =
  '参数 { limit?, minLevel?, name?, text?, after? }，都可省：limit 是正整数，只要筛完之后最近的几条，默认 2000；' +
  'minLevel 是 debug / info / warn / error，只要这一级及以上；name 是 logger 名，精确匹配（插件的 logger 名多是 gwb-<短名>）；' +
  'text 是非空字符串，在 name 与 msg 里找子串，不分大小写；after 是上一次回执里的 cursor，只取那之后新写的，不给就从文件末尾往前取。' +
  '回 { file, cursor, entries }：file 是 gwb.log 的绝对路径；cursor 是读完时 gwb.log 里最后一个完整行末尾的字节位置（末尾内核还没写完的半行不返回，下一次再读），下一次作 after 传回来；' +
  'entries 是 [{ ts, level, source, name, msg }]，从旧到新，跨过轮转出的 gwb.log.1。agent 调时带上 limit'

export interface LogQuery {
  limit: number
  minLevel?: LogLevel
  name?: string
  text?: string
  after?: number
}

export interface LogQueryResult {
  file: string
  cursor: number
  entries: LogEntry[]
}

const QUERY_KEYS = ['limit', 'minLevel', 'name', 'text', 'after']

function nonEmptyStringOrThrow(value: unknown, key: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`${QUERY_COMMAND} 的 ${key} 要是非空字符串，拿到 ${JSON.stringify(value)}`)
  return value
}

/** 参数是外部输入：认不出的键、类型不对都直接报错，不猜调用方的意思 */
export function logQueryFrom(args: unknown): LogQuery {
  if (args === undefined || args === null) return { limit: DEFAULT_LIMIT }
  if (!isRecord(args)) throw new Error(`${QUERY_COMMAND} 的参数要是对象：${QUERY_USAGE}`)
  const unknownKeys = Object.keys(args).filter((key) => !QUERY_KEYS.includes(key))
  if (unknownKeys.length > 0) throw new Error(`${QUERY_COMMAND} 不认识参数 ${unknownKeys.join('、')}：${QUERY_USAGE}`)
  const { limit, minLevel, name, text, after } = args
  const query: LogQuery = { limit: DEFAULT_LIMIT }
  if (limit !== undefined) {
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit <= 0) {
      throw new Error(`${QUERY_COMMAND} 的 limit 要是正整数，拿到 ${JSON.stringify(limit)}`)
    }
    query.limit = limit
  }
  if (minLevel !== undefined) {
    if (!LEVELS_FROM_LOWEST.includes(minLevel as LogLevel)) {
      throw new Error(`${QUERY_COMMAND} 的 minLevel 只能是 ${LEVELS_FROM_LOWEST.join(' / ')}，拿到 ${JSON.stringify(minLevel)}`)
    }
    query.minLevel = minLevel as LogLevel
  }
  if (name !== undefined) query.name = nonEmptyStringOrThrow(name, 'name')
  if (text !== undefined) query.text = nonEmptyStringOrThrow(text, 'text')
  if (after !== undefined) {
    if (typeof after !== 'number' || !Number.isInteger(after) || after < 0) {
      throw new Error(`${QUERY_COMMAND} 的 after 要是非负整数（上一次回执里的 cursor），拿到 ${JSON.stringify(after)}`)
    }
    query.after = after
  }
  return query
}

function entryMatcher(query: LogQuery): (entry: LogEntry) => boolean {
  const lowestLevelIndex = query.minLevel === undefined ? 0 : LEVELS_FROM_LOWEST.indexOf(query.minLevel)
  const lowerCaseText = query.text?.toLowerCase()
  return (entry) =>
    LEVELS_FROM_LOWEST.indexOf(entry.level) >= lowestLevelIndex &&
    (query.name === undefined || entry.name === query.name) &&
    (lowerCaseText === undefined || entry.name.toLowerCase().includes(lowerCaseText) || entry.msg.toLowerCase().includes(lowerCaseText))
}

type OpenForReading = (file: string) => Promise<FileHandle>

async function sizeOf(handle: FileHandle): Promise<number> {
  return (await handle.stat()).size
}

/** 还没轮转过就没有 `.1`，这是正常情况，回空数组 */
async function wholeRotatedFileIfExists(rotatedFile: string, open: OpenForReading): Promise<ByteRange[]> {
  let rotated: FileHandle
  try {
    rotated = await open(rotatedFile)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  return [{ file: rotatedFile, handle: rotated, start: 0, end: await sizeOf(rotated) }]
}

async function rotatedRangeAfterCursor(logFile: string, cursor: number, after: number, open: OpenForReading): Promise<ByteRange> {
  const rotatedFile = `${logFile}.1`
  let rotated: FileHandle
  try {
    rotated = await open(rotatedFile)
  } catch (err) {
    throw new Error(`${logFile} 的完整行只到第 ${cursor} 字节、比 after=${after} 小，说明轮转过，但 ${rotatedFile} 打不开`, { cause: err })
  }
  const rotatedSize = await sizeOf(rotated)
  if (after > rotatedSize) {
    throw new Error(`after=${after} 比 ${logFile}（完整行到第 ${cursor} 字节）与 ${rotatedFile}（${rotatedSize} 字节）都大，不是这两份日志文件里的位置`)
  }
  return { file: rotatedFile, handle: rotated, start: after, end: rotatedSize }
}

/** 按时间顺序要读的几段：先 `gwb.log.1` 再 `gwb.log` */
async function rangesOldestFirst(logFile: string, current: FileHandle, cursor: number, after: number | undefined, open: OpenForReading): Promise<ByteRange[]> {
  const wholeCurrentFile: ByteRange = { file: logFile, handle: current, start: 0, end: cursor }
  if (after === undefined) return [...(await wholeRotatedFileIfExists(`${logFile}.1`, open)), wholeCurrentFile]
  if (after <= cursor) return [{ file: logFile, handle: current, start: after, end: cursor }]
  return [await rotatedRangeAfterCursor(logFile, cursor, after, open), wholeCurrentFile]
}

/** 从最新的一段往前读，凑够 limit 条就停，不把整份文件读进内存 */
async function newestMatchingEntries(ranges: readonly ByteRange[], query: LogQuery): Promise<LogEntry[]> {
  const matches = entryMatcher(query)
  const newestFirst: LogEntry[] = []
  for (const range of [...ranges].reverse()) {
    for await (const line of linesNewestFirst(range)) {
      const entry = entryFromLine(line, range.file)
      if (!matches(entry)) continue
      newestFirst.push(entry)
      if (newestFirst.length === query.limit) return newestFirst.reverse()
    }
  }
  return newestFirst.reverse()
}

export async function queryLogFile(logFile: string, query: LogQuery): Promise<LogQueryResult> {
  const openedHandles: FileHandle[] = []
  const open: OpenForReading = async (file) => {
    const handle = await fs.open(file, 'r')
    openedHandles.push(handle)
    return handle
  }
  try {
    const current = await open(logFile)
    const cursor = await endOfLastCompleteLine({ file: logFile, handle: current, start: 0, end: await sizeOf(current) })
    const ranges = await rangesOldestFirst(logFile, current, cursor, query.after, open)
    return { file: logFile, cursor, entries: await newestMatchingEntries(ranges, query) }
  } finally {
    await Promise.all(openedHandles.map((handle) => handle.close()))
  }
}

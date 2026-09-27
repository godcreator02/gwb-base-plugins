import type { FileHandle } from 'node:fs/promises'
import { linePrefix } from './log-entry.js'

const CHUNK_BYTES = 64 * 1024
const NEWLINE = 0x0a

/** 一份文件里要读的字节 `[start, end)`；`end` 处必须是一行的结尾 */
export interface ByteRange {
  file: string
  handle: FileHandle
  start: number
  end: number
}

async function readBytes(range: ByteRange, start: number, end: number): Promise<Buffer> {
  const buffer = Buffer.alloc(end - start)
  let filled = 0
  while (filled < buffer.length) {
    const { bytesRead } = await range.handle.read(buffer, filled, buffer.length - filled, start + filled)
    if (bytesRead === 0) throw new Error(`${range.file} 读到第 ${start + filled} 字节就到头了，读的时候文件变短了`)
    filled += bytesRead
  }
  return buffer
}

function lastNewlineBefore(buffer: Buffer, end: number): number {
  return end === 0 ? -1 : buffer.lastIndexOf(NEWLINE, end - 1)
}

/**
 * 正在追加的文件末尾可能是内核还没写完的一行（内核一行只用一次 writeSync，下一次读时就完整了）：
 * 回 `range` 里最后一个换行之后的位置，一个换行都没有就是 `range.start`
 */
export async function endOfLastCompleteLine(range: ByteRange): Promise<number> {
  let unreadEnd = range.end
  while (unreadEnd > range.start) {
    const readStart = Math.max(range.start, unreadEnd - CHUNK_BYTES)
    const lastNewline = (await readBytes(range, readStart, unreadEnd)).lastIndexOf(NEWLINE)
    if (lastNewline !== -1) return readStart + lastNewline + 1
    unreadEnd = readStart
  }
  return range.start
}

function rejectUnterminatedLastLine(range: ByteRange, bytesAfterLastNewline: Buffer): void {
  if (bytesAfterLastNewline.length === 0) return
  throw new Error(`${range.file} 的最后一行没有以换行结尾：${linePrefix(bytesAfterLastNewline.toString('utf8'))}`)
}

/**
 * 从 `end` 往 `start` 按块倒着读，逐行交出（不含换行符），最新的一行先出。
 * 按字节找换行再解码：UTF-8 的多字节字符里不会出现 0x0A，块边界切在字符中间也不会解错
 */
export async function* linesNewestFirst(range: ByteRange): AsyncGenerator<string> {
  let unreadEnd = range.end
  let bytesWhoseLineStartIsNotYetRead = Buffer.alloc(0)
  let lastLineChecked = false
  while (unreadEnd > range.start) {
    const readStart = Math.max(range.start, unreadEnd - CHUNK_BYTES)
    const buffer = Buffer.concat([await readBytes(range, readStart, unreadEnd), bytesWhoseLineStartIsNotYetRead])
    unreadEnd = readStart
    let lineEnd = buffer.length
    for (let newline = lastNewlineBefore(buffer, lineEnd); newline !== -1; newline = lastNewlineBefore(buffer, newline)) {
      const line = buffer.subarray(newline + 1, lineEnd)
      lineEnd = newline
      if (lastLineChecked) {
        yield line.toString('utf8')
      } else {
        rejectUnterminatedLastLine(range, line)
        lastLineChecked = true
      }
    }
    bytesWhoseLineStartIsNotYetRead = buffer.subarray(0, lineEnd)
  }
  if (!lastLineChecked) {
    rejectUnterminatedLastLine(range, bytesWhoseLineStartIsNotYetRead)
    return
  }
  yield bytesWhoseLineStartIsNotYetRead.toString('utf8')
}

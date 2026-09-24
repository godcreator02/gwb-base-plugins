import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { docFileIn } from './paths.js'

/** 没有这份文档回 undefined；解析不了也回 undefined，但要 warn——数据坏了悄悄变成默认值最难查 */
export async function readDoc(dir: string, doc: string, warn: (message: string) => void): Promise<unknown> {
  const file = docFileIn(dir, doc)
  let text: string
  try {
    text = await fs.promises.readFile(file, 'utf8')
  } catch {
    return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch (parseError: unknown) {
    warn(`${file} 解析不了，当没有处理：${String(parseError)}`)
    return undefined
  }
}

/** 每个文件排在最后的那次写入，写完（成功或失败）就兑现；只用来排队，失败由那次写入自己的 promise 交给调用方 */
const lastQueuedWriteByFile = new Map<string, Promise<void>>()

/** 同一个文件的写入按发起顺序一次一个：每次都是整份替换，后发起的那次必须最后落盘 */
function writeInCallOrder(file: string, write: () => Promise<void>): Promise<void> {
  const previous = lastQueuedWriteByFile.get(file)
  const current = previous === undefined ? write() : previous.then(write)
  const settled = current.catch(() => undefined)
  lastQueuedWriteByFile.set(file, settled)
  void settled.then(() => {
    if (lastQueuedWriteByFile.get(file) === settled) lastQueuedWriteByFile.delete(file)
  })
  return current
}

/** 随机后缀保证同一毫秒里的两次写入不共用一个临时文件 */
function tempFileNextTo(file: string): string {
  return `${file}.${process.pid}.${randomUUID()}.tmp`
}

/** 先写临时文件再改名覆盖。rename 只在同一分区上原子，所以临时文件必须和目标同目录 */
async function replaceFileAtomically(file: string, text: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  const tmp = tempFileNextTo(file)
  try {
    await fs.promises.writeFile(tmp, text, 'utf8')
    await fs.promises.rename(tmp, file)
  } catch (writeError: unknown) {
    await fs.promises.rm(tmp, { force: true })
    throw writeError
  }
}

/** 整份替换，同一份文档的多次写入按发起顺序落盘 */
export async function writeDoc(dir: string, doc: string, value: unknown): Promise<void> {
  const file = docFileIn(dir, doc)
  // 先序列化：循环引用之类要在建目录之前抛出，别留下空目录；也保证排队期间调用方再改这个对象，这次写的仍是发起时的内容
  const text = `${JSON.stringify(value, null, 2)}\n`
  await writeInCallOrder(file, () => replaceFileAtomically(file, text))
}

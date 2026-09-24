import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { OWNERS_KEY } from './paths.js'
import { toOwners, toSettingsFile, type SettingsFile, type SettingsOwners } from './registry.js'

/** 一份文件拆开的两半：各分区的设置，与顶层 `$owners` 那张归属表 */
export interface StoredHome {
  sections: SettingsFile
  owners: SettingsOwners
}

function emptyHome(): StoredHome {
  return { sections: {}, owners: {} }
}

/**
 * 没有文件、解析不了都回空表，解析不了时写 warn。
 * 必须同步：服务在构造函数里就提供出去了，调用方随即可能同步 `get`，那时表里要已经有值
 */
export function readSettings(file: string, warn: (message: string) => void): StoredHome {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return emptyHome()
  }
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch (parseError: unknown) {
    warn(`${file} 解析不了，当没有处理：${String(parseError)}`)
    return emptyHome()
  }
  return { sections: toSettingsFile(raw, warn, file), owners: toOwners(raw, warn, file) }
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

/** 整份替换，同一个文件的多次写入按发起顺序落盘 */
export async function writeSettings(file: string, home: StoredHome): Promise<void> {
  // 归属表放最前，人打开文件先看到各分区归谁
  const data = { [OWNERS_KEY]: home.owners, ...home.sections }
  // 先序列化：循环引用之类要在建目录之前抛出，别留下空目录；也保证排队期间表再变，这次写的仍是发起时的内容
  const text = `${JSON.stringify(data, null, 2)}\n`
  await writeInCallOrder(file, () => replaceFileAtomically(file, text))
}

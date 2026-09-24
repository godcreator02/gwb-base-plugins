import fs from 'node:fs'
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

/** 整份替换：先写临时文件再改名覆盖。rename 只在同一分区上原子，所以临时文件必须和目标同目录 */
export async function writeDoc(dir: string, doc: string, value: unknown): Promise<void> {
  const file = docFileIn(dir, doc)
  // 先序列化：循环引用之类要在建目录之前抛出，别留下空目录
  const text = `${JSON.stringify(value, null, 2)}\n`
  await fs.promises.mkdir(dir, { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.promises.writeFile(tmp, text, 'utf8')
    await fs.promises.rename(tmp, file)
  } catch (writeError: unknown) {
    await fs.promises.rm(tmp, { force: true })
    throw writeError
  }
}

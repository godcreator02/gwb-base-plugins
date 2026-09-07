import fs from 'node:fs'
import { docFileIn } from './paths.js'

/** 落盘实现。目录是调用方算好的事实，这里只管读写 */

/**
 * 读一份文档。**没有 / 坏了都回 undefined**——第一次跑没文件，调用方直接用默认值。
 * 但坏了要 warn 一声：数据烂掉悄悄变成「用默认值」是最难查的那种。
 */
export async function readDoc(dir: string, doc: string, warn: (message: string) => void): Promise<unknown> {
  const file = docFileIn(dir, doc)
  let text: string
  try {
    text = await fs.promises.readFile(file, 'utf8')
  } catch {
    // 没有这份文档是正当结果，不吭声
    return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch (err: unknown) {
    warn(`${file} 解析不了，当没有处理：${String(err)}`)
    return undefined
  }
}

/**
 * 整份替换，**原子落盘**：先写同目录的临时文件再 rename 覆盖。
 * 直接往目标写的话，写到一半崩了会留下半个文件——那份数据就毁了。
 * rename 只在同一分区上原子，所以临时文件必须跟目标同目录，不能扔 os.tmpdir()。
 */
export async function writeDoc(dir: string, doc: string, value: unknown): Promise<void> {
  const file = docFileIn(dir, doc)
  // 先序列化：循环引用之类要在建目录之前炸，别留下空目录
  const text = `${JSON.stringify(value, null, 2)}\n`
  await fs.promises.mkdir(dir, { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.promises.writeFile(tmp, text, 'utf8')
    await fs.promises.rename(tmp, file)
  } catch (err: unknown) {
    // rename 失败时临时文件会留在盘上，收掉——否则每次失败攒一个
    await fs.promises.rm(tmp, { force: true })
    throw err
  }
}

import fs from 'node:fs'
import path from 'node:path'
import { toSettingsFile, type SettingsFile } from './registry.js'

/** 落盘实现。文件落在哪是调用方算好的事实，这里只管读写 */

/**
 * 读一份。**没有 / 坏了都回空表**——第一次跑没文件，件直接用 default；
 * 坏了要 warn 一声：数据烂掉悄悄变成「用默认值」是最难查的那种。
 *
 * **这里是同步的，是有意的**：`Service` 在构造函数里就把自己 provide 出去了，构造一
 * 返回，消费方就可能挂上并 `get`。异步读的话那一刻表还是空的，而 `get` 是同步的。
 * 见文档站。
 */
export function readSettings(file: string, warn: (message: string) => void): SettingsFile {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    // 没有这份文件是正当结果，不吭声
    return {}
  }
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch (err: unknown) {
    warn(`${file} 解析不了，当没有处理：${String(err)}`)
    return {}
  }
  return toSettingsFile(raw, warn, file)
}

/**
 * 整份替换，**原子落盘**：先写同目录的临时文件再 rename 覆盖。
 * 直接往目标写的话，写到一半崩了会留下半个文件——那份数据就毁了。
 * rename 只在同一分区上原子，所以临时文件必须跟目标同目录，不能扔 os.tmpdir()。
 */
export async function writeSettings(file: string, data: SettingsFile): Promise<void> {
  // 先序列化：循环引用之类要在建目录之前炸，别留下空目录
  const text = `${JSON.stringify(data, null, 2)}\n`
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
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

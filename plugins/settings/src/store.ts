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

/** 整份替换：先写临时文件再改名覆盖。rename 只在同一分区上原子，所以临时文件必须和目标同目录 */
export async function writeSettings(file: string, home: StoredHome): Promise<void> {
  // 归属表放最前，人打开文件先看到各分区归谁
  const data = { [OWNERS_KEY]: home.owners, ...home.sections }
  // 先序列化：循环引用之类要在建目录之前抛出，别留下空目录
  const text = `${JSON.stringify(data, null, 2)}\n`
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.promises.writeFile(tmp, text, 'utf8')
    await fs.promises.rename(tmp, file)
  } catch (writeError: unknown) {
    await fs.promises.rm(tmp, { force: true })
    throw writeError
  }
}

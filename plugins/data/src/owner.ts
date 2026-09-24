import fs from 'node:fs'
import path from 'node:path'
import { isRecord } from './vocab.js'

/** 数据目录的归属文件，内容 `{ "pkg": "<包名>" }`。文件名带点，而文档名是 kebab-case，两者撞不上 */
export const OWNER_FILE = '.owner.json'

function readTextIfPresent(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

function pkgInOwnerText(text: string): unknown {
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch {
    raw = undefined
  }
  return isRecord(raw) ? raw['pkg'] : undefined
}

/** 没有归属文件回 undefined；文件坏了当场抛——坏了当没有，等于谁都能认领 */
export function readOwner(dir: string): string | undefined {
  const file = path.join(dir, OWNER_FILE)
  const text = readTextIfPresent(file)
  if (text === undefined) return undefined
  const pkg = pkgInOwnerText(text)
  if (typeof pkg !== 'string' || pkg === '') {
    throw new Error(`${file} 认不出来（要是 { "pkg": "<包名>" }）。修好它，或删掉让下一个访问这个目录的插件重新记归属`)
  }
  return pkg
}

/** 写归属：目录不在就建出来。已有的归属直接换掉——认不认领的判断在 `claimDir` */
export function stampOwner(dir: string, pkg: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, OWNER_FILE), `${JSON.stringify({ pkg }, null, 2)}\n`, 'utf8')
}

/**
 * `pkg` 要用这个目录：没有归属就记上，归自己放行，归别的包抛错。
 * 同步做：`dir` 是同步的 getter，插件拿到路径就可能自己往里写
 */
export function claimDir(dir: string, pkg: string): void {
  const owner = readOwner(dir)
  if (owner === pkg) return
  if (owner !== undefined) {
    throw new Error(
      `数据目录 ${dir} 归 ${owner}，${pkg} 用不了。多半是两个包名不同的插件算出了同一个条目 id——给这条条目换个 id；确认是同一个插件改了包名，就调 plugin-manager.transfer-owner 改归属`,
    )
  }
  stampOwner(dir, pkg)
}

/** `<home>/data` 底下各目录的归属：目录名 → 包名。没有归属文件、文件坏了的不列 */
export async function listOwners(root: string, warn: (message: string) => void): Promise<Record<string, string>> {
  let dirEntries: fs.Dirent[]
  try {
    dirEntries = await fs.promises.readdir(root, { withFileTypes: true })
  } catch {
    // 还没有任何插件写过数据
    return {}
  }
  const ownerByDirName: Record<string, string> = {}
  for (const dirEntry of dirEntries) {
    if (!dirEntry.isDirectory()) continue
    try {
      const pkg = readOwner(path.join(root, dirEntry.name))
      if (pkg !== undefined) ownerByDirName[dirEntry.name] = pkg
    } catch (unreadableOwner: unknown) {
      warn(String(unreadableOwner))
    }
  }
  return ownerByDirName
}

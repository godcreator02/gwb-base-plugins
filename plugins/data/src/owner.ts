import fs from 'node:fs'
import path from 'node:path'
import { isRecord } from '@godcreator/gwb-plugin-api'

/**
 * 户主章：一个数据目录归哪个包。
 *
 * 目录名是条目 id 的末段，而默认 id 去掉了 scope——`@a/gwb-foo` 与 `@b/foo` 都叫 `foo`。
 * 条目删了数据留盘，id 空出来就会被下一个同名的包拿走，不盖章的话它会把前一个包的数据
 * 当自己的读。章记的是包名，对不上就拒。
 *
 * 文件名带点，文档名是 kebab-case，两者撞不上。
 */
export const OWNER_FILE = '.owner.json'

/** 读一个目录的章。没有章回 undefined；章坏了当场抛——坏章当没章，等于谁都能认领 */
export function readOwner(dir: string): string | undefined {
  const file = path.join(dir, OWNER_FILE)
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch {
    raw = undefined
  }
  const pkg = isRecord(raw) ? raw['pkg'] : undefined
  if (typeof pkg !== 'string' || pkg === '') {
    throw new Error(`${file} 认不出来（要是 { "pkg": "<包名>" }）。修好它，或删掉让下一个访问这个目录的件重新盖章`)
  }
  return pkg
}

/** 盖章：目录不在就建出来。已有的章直接换掉——认不认领的判断在 `claimDir` */
export function stampOwner(dir: string, pkg: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, OWNER_FILE), `${JSON.stringify({ pkg }, null, 2)}\n`, 'utf8')
}

/**
 * `pkg` 要用这个目录：没章就盖上，章是自己的放行，章是别人的抛。
 *
 * 同步做：`dir` 是个同步 getter，件拿到路径就可能自己往里写。
 */
export function claimDir(dir: string, pkg: string): void {
  const owner = readOwner(dir)
  if (owner === pkg) return
  if (owner !== undefined) {
    throw new Error(
      `数据目录 ${dir} 归 ${owner}，${pkg} 用不了。多半是两个包名不同的件算出了同一个条目 id——给这条条目换个 id；确认是同一个件改了包名，走 plugin-manager.transfer-owner 过户`,
    )
  }
  stampOwner(dir, pkg)
}

/** `<home>/data` 底下各目录的户主：目录名 → 包名。没章、章坏了的不列 */
export async function listOwners(root: string, warn: (message: string) => void): Promise<Record<string, string>> {
  let names: fs.Dirent[]
  try {
    names = await fs.promises.readdir(root, { withFileTypes: true })
  } catch {
    // 还没有任何件落过数据
    return {}
  }
  const out: Record<string, string> = {}
  for (const entry of names) {
    if (!entry.isDirectory()) continue
    try {
      const pkg = readOwner(path.join(root, entry.name))
      if (pkg !== undefined) out[entry.name] = pkg
    } catch (err: unknown) {
      warn(String(err))
    }
  }
  return out
}

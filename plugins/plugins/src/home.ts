import fs from 'node:fs'
import path from 'node:path'
import { toDependencies, toShared } from './inventory.js'

/** home 那份 `package.json`。收窄与对账的纯逻辑在 `inventory.ts` */

/** pnpm 维护的那份清单，跟 `cordis.yml` 并排 */
const MANIFEST = 'package.json'

export function manifestFile(homeDir: string): string {
  return path.join(homeDir, MANIFEST)
}

/**
 * home 里装着哪些包：包名 → 版本范围。
 *
 * **读不到就当空表**，不抛：清单是 pnpm 写的，正在装的那一瞬间它可能是半份；而
 * `list()` 因为读不到清单整个失败，比少报几行难查得多。条目那一侧照样报得出来。
 */
export async function readHomeDependencies(homeDir: string): Promise<Record<string, string>> {
  let text: string
  try {
    text = await fs.promises.readFile(manifestFile(homeDir), 'utf8')
  } catch {
    return {}
  }
  try {
    return toDependencies(JSON.parse(text))
  } catch {
    return {}
  }
}

/**
 * home 里哪些包是**共享包**，各自提供哪些裸名。
 *
 * 这份数据以前从内核的 `kernel.info` 拿；单进程内核没有那条自省命令了，改成这个件自己
 * 去盘上读——扫的是内核算 importmap 时扫的同一批清单（home 的 dependencies，逐包读
 * `gwb.shared`），所以两边看到的是同一件事。读不动的包**跳过不报错**：正在装的那一瞬间
 * 清单可能是半份，而少标一个「共享包」的代价远小于整格画不出来。
 */
export async function readSharedPackages(homeDir: string): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {}
  for (const pkg of Object.keys(await readHomeDependencies(homeDir))) {
    let text: string
    try {
      text = await fs.promises.readFile(path.join(homeDir, 'node_modules', ...pkg.split('/'), MANIFEST), 'utf8')
    } catch {
      continue
    }
    let bares: string[] | undefined
    try {
      bares = toShared(JSON.parse(text))
    } catch {
      continue
    }
    if (bares !== undefined) out[pkg] = bares
  }
  return out
}

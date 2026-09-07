import fs from 'node:fs'
import path from 'node:path'
import { toDependencies } from './inventory.js'

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

import fs from 'node:fs'
import path from 'node:path'

/**
 * 「这个 home 里装着哪些件」——给 `index` 的件表供料。**2026-09-18 起加的这一节**：
 * 门原来只给命令与说明书两张平表，纯界面件（baseui 那种 0 命令）与库在门里等于隐形；
 * 件级那句话本该由包自己说，门只差把它端出来。
 *
 * 两个来源，都在 home 目录下、格式都是我们自己的：
 *
 * - `cordis.yml`——**挂着的条目**：一条 `- id: <条目名>` 带一行 `name: '<包名>'`（plugin-manager
 *   生成的形状，就这两行）。不读 cordis 的运行时内部面、也不依赖 plugin-manager 件
 * - `<home>/node_modules/<包名>/package.json`——版本与那句话
 *
 * **认不出的行跳过**：如实少报，不猜。拿不到 cordis.yml 就回空表（件表空着，命令与说明书照出）。
 */

/** 件表一行 */
export interface PluginRow {
  /** 包名——正是命令与说明书两表里 `plugin` 那一格的取值，三张表靠它对得上 */
  pkg: string
  /** cordis.yml 里的条目名 */
  entryId?: string
  /** 装着的版本（读不到不写） */
  version?: string
  /** 包自己那句话（读不到不写） */
  description?: string
}

/** cordis.yml 文本 → 条目表。`- id: x` 起一条，随后的 `name: '<包名>'` 归它 */
export function parseEntries(text: string): Array<{ id?: string; pkg: string }> {
  const out: Array<{ id?: string; pkg: string }> = []
  let current: { id?: string; pkg?: string } | undefined
  const flush = (): void => {
    if (current?.pkg !== undefined && current.pkg !== '') {
      out.push(current.id === undefined ? { pkg: current.pkg } : { id: current.id, pkg: current.pkg })
    }
    current = undefined
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '')
    const id = line.match(/^\s*-\s*id:\s*(\S+)\s*$/)
    if (id !== null) {
      flush()
      current = { id: id[1] }
      continue
    }
    const name = line.match(/^\s*-?\s*name:\s*'?"?([^'"\s]+)'?"?\s*$/)
    if (name !== null) {
      if (current === undefined) {
        // name 先出现（少见）——当成一条只有包名的条目
        current = { pkg: name[1] }
        flush()
      } else {
        current.pkg = name[1]
      }
    }
  }
  flush()
  return out
}

/** home 目录 → 件表。读的是挂在 cordis.yml 里的条目，逐条去 node_modules 里拿版本与那句话 */
export function readPlugins(homeDir: string): PluginRow[] {
  let entries: Array<{ id?: string; pkg: string }> = []
  try {
    entries = parseEntries(fs.readFileSync(path.join(homeDir, 'cordis.yml'), 'utf8'))
  } catch {
    return []
  }
  const rows: PluginRow[] = []
  for (const entry of entries) {
    const row: PluginRow = entry.id === undefined ? { pkg: entry.pkg } : { pkg: entry.pkg, entryId: entry.id }
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(homeDir, 'node_modules', entry.pkg, 'package.json'), 'utf8'),
      ) as { version?: unknown; description?: unknown }
      if (typeof manifest.version === 'string') row.version = manifest.version
      if (typeof manifest.description === 'string') row.description = manifest.description
    } catch {
      // 清单读不到（链路怪、手改过）——条目照报，版本与那句话空着
    }
    rows.push(row)
  }
  return rows
}

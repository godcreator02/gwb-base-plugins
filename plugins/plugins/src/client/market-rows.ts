/**
 * 「可装」那段的纯逻辑：检索结果与已装索引的对账、搜索框的本地筛、汇总。
 * 不碰 DOM、**也不碰网络**——网络那半在 node 半（`plugins.search`），这儿只管拿到手之后的事。
 *
 * **不 import node 半的类型**：检索结果跨 fd3 过来，本来就得当 `unknown` 收窄一次；
 * node 半的 `search.ts` 里有一份同形的 `SearchRow`，两边各认各的（跟 `rows.ts` 对
 * `PackageView` 的规矩同一款）。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 一条检索结果过桥之后的样子。跟 node 半 `search.ts` 的 `SearchRow` 是同一个形状 */
export interface SearchRow {
  pkg: string
  /** registry 上的最新版 */
  version?: string
  /** registry 上的一句话 */
  description?: string
}

/** 判形。**认不出的丢掉、不崩**——node 半改了形状时宁可少显示几行，不要整段白屏 */
export function acceptPackages(raw: unknown): SearchRow[] {
  if (!Array.isArray(raw)) return []
  const out: SearchRow[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const pkg = item['pkg']
    if (typeof pkg !== 'string' || pkg === '') continue
    const row: SearchRow = { pkg }
    const version = item['version']
    const description = item['description']
    if (typeof version === 'string' && version !== '') row.version = version
    if (typeof description === 'string' && description !== '') row.description = description
    out.push(row)
  }
  return out
}

/** 包名 → 它在 home 里的版本范围。`undefined` 就是没装。由窗格已取的那份 `plugins.list` 推导 */
export type InstalledIndex = ReadonlyMap<string, string | undefined>

/** 表还没取到时用的那份。**空表不等于「一个都没装」**，界面得靠别的信号分开这两种 */
export const NO_INDEX: InstalledIndex = new Map<string, string | undefined>()

/**
 * 本件窗格已取的包行 → 已装索引。**只收 `installed === true` 那些**——那张表还会列出
 * 「cordis.yml 里有条目、可包不在 home 里」的包，那种在这一段里就是**没装**，点「装」
 * 正是该做的事。
 */
export function installedIndex(rows: readonly { pkg: string; installed: boolean; spec?: string }[]): InstalledIndex {
  const map = new Map<string, string | undefined>()
  for (const row of rows) if (row.installed) map.set(row.pkg, row.spec)
  return map
}

/** 列表上的一行 */
export interface MarketRow extends SearchRow {
  /** 这个包在 home 里 */
  installed: boolean
  /** 装的是哪个版本范围。装了才可能有 */
  spec?: string
}

/**
 * 搜索框的本地筛：包名与 registry 那句话一起筛，子串、不区分大小写。
 * 检索本身是挂上时一把抓回全量（这条线就几十个包），筛是纯本地的。
 * **不做正则**：写错的表达式静默匹配不到。
 */
export function matchesQuery(row: SearchRow, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return (
    row.pkg.toLowerCase().includes(needle) ||
    (row.description ?? '').toLowerCase().includes(needle)
  )
}

/** 检索结果 + 已装的那份 → 要画的那几行。**顺序照检索结果**（node 半已按包名收），装没装不参与排序 */
export function toRows(packages: readonly SearchRow[], index: InstalledIndex, query: string): MarketRow[] {
  const out: MarketRow[] = []
  for (const item of packages) {
    if (!matchesQuery(item, query)) continue
    const spec = index.get(item.pkg)
    if (spec === undefined && !index.has(item.pkg)) {
      out.push({ ...item, installed: false })
    } else {
      out.push(spec === undefined ? { ...item, installed: true } : { ...item, installed: true, spec })
    }
  }
  return out
}

export interface Summary {
  /** registry 上这条线一共几个 */
  total: number
  /** 其中已经装了几条。**数的是筛选之前的全量** */
  installed: number
  /** 这次筛出来几行 */
  shown: number
}

export function summarize(
  packages: readonly SearchRow[],
  index: InstalledIndex,
  rows: readonly MarketRow[],
): Summary {
  let installed = 0
  for (const item of packages) if (index.has(item.pkg)) installed += 1
  return { total: packages.length, installed, shown: rows.length }
}

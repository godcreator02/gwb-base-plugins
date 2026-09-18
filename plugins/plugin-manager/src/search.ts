/**
 * npm registry 标准检索协议（`GET <registry>/-/v1/search`）的解析与过滤。纯函数，单独测。
 *
 * **这里不认识任何具体的 registry**——Verdaccio、npmjs、哪个 npm 兼容源实现的都是同一份
 * 协议；基址由调用方从 pnpm 配置解析（装从哪来，搜就到哪去）。
 *
 * 返回形状是实测钉的（2026-09-08，`text=@godcreator&size=100`）：顶层 `{ objects, total,
 * time }`，每条 `object.package` 里带 `name` / `version` / `description` / `keywords`。
 * 字段缺失的单条跳过，整份认不出回 undefined 让调用方给一句人话。
 *
 * **name 的两种形状**（2026-09-15 实测）：npmjs/verdaccio 把 scope 合在 name 里
 * （`@godcreator/gwb-x`）；gitea（个人源）拆开单放——`package.scope` 是 `"@godcreator"`、
 * `name` 只有 `gwb-x`。不归一的话整表都是短名，读出来的包名全是错的。
 *
 * **「是不是件」看包自报家门**（2026-09-18 起）：manifest 的 `keywords` 里带不带
 * `gwb-plugin`（`isPluginRow`）。这一格 **registry 的搜索回执直接带**（packument 会裁自定义
 * 字段，keywords 留着——2026-09-18 实测），所以一趟请求认完，不用逐包再问。
 * 名字（scope / `gwb-` 前缀）不参与判断，**没有回退**：没写这枚词的包不进「可装」表。
 */

/** 检索出来的一条：包名 + registry 上的最新版、一句话、与包自报的 keywords */
export interface SearchRow {
  pkg: string
  version?: string
  description?: string
  /** 包在 manifest 里写的 keywords；registry 没给、不是数组、或元素不是字符串的都滤掉 */
  keywords: string[]
}

/** 整份响应认不出的记号。跟「空结果」（空数组）分得开 */
export type ParsedSearch = SearchRow[] | undefined

/** 自报家门的那枚词：件在 manifest 里写 `"keywords": ["gwb", "gwb-plugin"]` */
export const PLUGIN_KEYWORD = 'gwb-plugin'

/**
 * 这条是不是件：只看包自己写的 keywords 里有没有 `PLUGIN_KEYWORD`。
 * 名字（scope / `gwb-` 前缀）不参与判断，也没有别的回退——一处声明、一处判据。
 */
export function isPluginRow(row: SearchRow): boolean {
  return row.keywords.includes(PLUGIN_KEYWORD)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 解析检索响应。空 objects → 空数组；不是这份 JSON → undefined；坏条目只跳过那一条。
 *
 * **响应不统一**：新索引进来的条目带 `package.version`，旧一批只有 `dist-tags.latest`
 * （实测 2026-09-08，同一份响应里两种并存）——latest 取前者，缺了回后者。
 */
export function parseSearch(text: string): ParsedSearch {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(raw) || !Array.isArray(raw['objects'])) return undefined
  const out: SearchRow[] = []
  for (const item of raw['objects']) {
    if (!isRecord(item) || !isRecord(item['package'])) continue
    const rawName = item['package']['name']
    if (typeof rawName !== 'string' || rawName === '') continue
    // gitea 拆开单放的 scope 拼回全名；name 已带 @ 前缀的（npmjs/verdaccio 形状）原样用
    const scope = item['package']['scope']
    const pkg =
      typeof scope === 'string' && scope !== '' && !rawName.startsWith('@') ? `${scope}/${rawName}` : rawName
    const row: SearchRow = { pkg, keywords: [] }
    const version = item['package']['version']
    const latest = isRecord(item['package']['dist-tags']) ? item['package']['dist-tags']['latest'] : undefined
    const resolved =
      typeof version === 'string' && version !== ''
        ? version
        : typeof latest === 'string' && latest !== ''
          ? latest
          : undefined
    if (resolved !== undefined) row.version = resolved
    const description = item['package']['description']
    if (typeof description === 'string' && description !== '') row.description = description
    const keywords = item['package']['keywords']
    if (Array.isArray(keywords)) row.keywords = keywords.filter((one): one is string => typeof one === 'string')
    out.push(row)
  }
  return out
}

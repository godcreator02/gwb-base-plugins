/**
 * npm registry 标准检索协议（`GET <registry>/-/v1/search`）的解析与过滤。纯函数，单独测。
 *
 * **这里不认识任何具体的 registry**——Verdaccio、npmjs、哪个 npm 兼容源实现的都是同一份
 * 协议；基址由调用方从 pnpm 配置解析（装从哪来，搜就到哪去）。
 *
 * 返回形状是实测钉的（2026-09-08，`text=@team&size=100`）：顶层 `{ objects, total,
 * time }`，每条 `object.package` 里有 `name` / `version` / `description`。字段缺失的单条
 * 跳过，整份认不出回 undefined 让调用方给一句人话。
 */

/** 检索出来的一条：包名 + registry 上的最新版与一句话 */
export interface SearchRow {
  pkg: string
  version?: string
  description?: string
}

/** 整份响应认不出的记号。跟「空结果」（空数组）分得开 */
export type ParsedSearch = SearchRow[] | undefined

/**
 * 这条线上的包才算：`@team` scope 下、`gwb-` 前缀。
 *
 * scope 与前缀不是口味是**名字本身**（scope 不换，前缀是当年跟废弃那批错开用的）。
 * 按这条字面规则列，registry 上一整条废弃的 `gwb-*` 与共享包、词汇表包也会一并进来——
 * 那是「以 gwb- 开头的都列进来」的直接后果，拍板记在件仓文档站的 decisions。
 */
export function isGwbLine(pkg: string): boolean {
  return pkg.startsWith('@team/gwb-')
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
    const pkg = item['package']['name']
    if (typeof pkg !== 'string' || pkg === '') continue
    const row: SearchRow = { pkg }
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
    out.push(row)
  }
  return out
}

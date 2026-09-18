/**
 * npm registry 标准检索协议（`GET <registry>/-/v1/search`）的解析与过滤。纯函数，单独测。
 *
 * **这里不认识任何具体的 registry**——Verdaccio、npmjs、哪个 npm 兼容源实现的都是同一份
 * 协议；基址由调用方从 pnpm 配置解析（装从哪来，搜就到哪去）。
 *
 * 返回形状是实测钉的（2026-09-08，`text=@godcreator&size=100`）：顶层 `{ objects, total,
 * time }`，每条 `object.package` 里有 `name` / `version` / `description`。字段缺失的单条
 * 跳过，整份认不出回 undefined 让调用方给一句人话。
 *
 * **name 的两种形状**（2026-09-15 实测）：npmjs/verdaccio 把 scope 合在 name 里
 * （`@godcreator/gwb-x`）；gitea（个人源）拆开单放——`package.scope` 是 `"@godcreator"`、
 * `name` 只有 `gwb-x`。不归一的话整表都是短名，逐条读 packument 的键（`@scope/name`）
 * 全对不上，search 回空数组还不报错。
 *
 * **件的身份看 manifest 不看名字**（2026-09-18 起）：判据是 manifest 里的 `gwb.plugin`。
 * search 的响应不带 manifest 字段，得逐条读 packument（`readPluginMark`）；**没有回退**——
 * 名字（scope / `gwb-` 前缀）不再是任何判据，没声明过的包不进这张表。
 * 声明随各包的版本铺开：插件的 latest 还没带上 `gwb.plugin: true` 时，它就不在表里。
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
 * 从 packument 里读「件的身份声明」：`versions[dist-tags.latest].gwb.plugin`。
 *
 * 认得出 boolean 就回它（`true` 是件、`false` 明确不是，lib / 共享包 / 词汇表包用）；
 * 读不到 / 不是 JSON / 没有该版本 / `gwb` 段里没这个键，一律回 undefined——
 * **undefined 不是「不是件」，是「没声明过」**；调用方当前一律不列（宁缺毋滥），
 * 将来若要放宽，判据落在这儿，别回到名字上。
 */
export function readPluginMark(text: string): boolean | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(raw)) return undefined
  const versions = raw['versions']
  const distTags = raw['dist-tags']
  if (!isRecord(versions) || !isRecord(distTags)) return undefined
  const latest = distTags['latest']
  if (typeof latest !== 'string') return undefined
  const picked = versions[latest]
  if (!isRecord(picked)) return undefined
  const gwb = picked['gwb']
  if (!isRecord(gwb)) return undefined
  const plugin = gwb['plugin']
  return typeof plugin === 'boolean' ? plugin : undefined
}

/**
 * 限并发跑一批异步活，结果按原顺序回。逐条读 packument 用它——一次只发几个请求，
 * 别把源砸了，也别排成一条几百毫秒乘 N 的长队。
 */
export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = []
  let next = 0
  const run = async (): Promise<void> => {
    for (;;) {
      const i = next
      next += 1
      if (i >= items.length) return
      out[i] = await fn(items[i] as T)
    }
  }
  const lanes = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: lanes }, run))
  return out
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
    const pkg = typeof scope === 'string' && scope !== '' && !rawName.startsWith('@') ? `${scope}/${rawName}` : rawName
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

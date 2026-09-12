/**
 * `settings.all` 回的那份 → 跟条目 join 成「这一格的设置」。纯逻辑，不碰 DOM。
 *
 * `settings.all` 交出来的是按 `section`（条目裸 id）平铺的一张表，那串东西不是给人读
 * 的；join 到条目上，人才能「先想到哪个件，再看到它的设置」。正本的形状在 settings 件
 * 的 `src/registry.ts`（SettingView），这儿按形状收。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const TYPES = ['string', 'number', 'boolean', 'secret'] as const
export type SettingType = (typeof TYPES)[number]

/** 一项设置过桥之后的样子。跟 node 半的 `SettingView` 是同一个形状 */
export interface SettingRow {
  section: string
  key: string
  type: SettingType
  title?: string
  description?: string
  value?: unknown
  /** 此刻还有件声明着它。false 的多半是件停着或已经卸了，盘上的值还在 */
  live?: boolean
}

/** 认不出的丢掉、不崩——node 半改了形状时宁可少显示几行，不要整格白屏 */
export function acceptSettings(raw: unknown): SettingRow[] {
  if (!Array.isArray(raw)) return []
  const out: SettingRow[] = []
  for (const item of raw as unknown[]) {
    if (!isRecord(item)) continue
    const section = item['section']
    const key = item['key']
    if (typeof section !== 'string' || section === '') continue
    if (typeof key !== 'string' || key === '') continue
    const rawType = item['type']
    const type: SettingType = (TYPES as readonly string[]).includes(rawType as string)
      ? (rawType as SettingType)
      : 'string'
    const row: SettingRow = { section, key, type }
    const title = item['title']
    const description = item['description']
    const live = item['live']
    if (typeof title === 'string' && title !== '') row.title = title
    if (typeof description === 'string' && description !== '') row.description = description
    if (item['value'] !== undefined) row.value = item['value']
    if (live === false) row.live = false
    out.push(row)
  }
  return out
}

/** `home:hello` → `hello`。设置的 section 就是这个末段 */
export function bareId(entryId: string): string {
  const parts = entryId.split(':')
  return parts[parts.length - 1] ?? entryId
}

/**
 * 一项设置在盘上的唯一位置。`settings.set` / `settings.delete` 都按这两样定位。
 *
 * **每段 encodeURIComponent 再拼**：section 万一将来放进带 `/` 的东西也不会把定位串
 * 拆乱——拆开再 decode 一段不差。
 */
export function slotKey(s: Pick<SettingRow, 'section' | 'key'>): string {
  return `${encodeURIComponent(s.section)}/${encodeURIComponent(s.key)}`
}

export function parseSlotKey(slot: string): { section: string; key: string } {
  const [section, key] = slot.split('/').map((part) => decodeURIComponent(part))
  return { section: section ?? '', key: key ?? '' }
}

/** 条目自己那几张设置：section 就是条目 id 的末段 */
export function settingsForEntry(all: readonly SettingRow[], entryId: string): SettingRow[] {
  const bare = bareId(entryId)
  return all.filter((s) => s.section === bare)
}

/**
 * 谁也认不走的那些：section 对不上画面上任何条目。盘上有值、此刻却没主——多半是条目
 * 删了值没擦，或者件停着还没声明。
 */
export function orphanSettings(all: readonly SettingRow[], entries: readonly string[]): SettingRow[] {
  const bareIds = new Set(entries.map(bareId))
  return all.filter((s) => !bareIds.has(s.section))
}

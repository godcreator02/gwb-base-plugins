/**
 * 布局档：外壳往 gwbData 落的那份文档，与围绕它的几个纯判断。
 *
 * v3（多桌面第二波，保活）起一份文档装三样：**desktops**（每口桌面各自那口井的档，
 * 各自防抖保存）、**active**（重启回到哪口）、**saved**（人起名存的布局清单——「照片」，
 * 铺开即弃，跟桌面是两回事，判据见文档站 decisions）。仍是单文档：写单位是整档，
 * 保存器醒来时读「当下」重拼一份，迟到的旧定时器写不坏账；gwbData 的面一个字不用扩。
 *
 * 每条 `layout` 都是那一口井的 dockview `toJSON()` 结果，这层**原样搬运、不解读**
 * ——形状归 dockview。`null` 是「还没存过」：新建的桌面第一次切到时按注册表铺默认。
 *
 * 认不出的版本整档当没有（见 `parseLayoutDoc`），不写回：两台机器不同版本互毁的事，
 * 等真有了第二台再管。**v2 认得、当场迁**：current 迁成第一口桌面（「主桌面」），saved
 * 原样带走——v2 是昨天还在写的形状，扔掉它等于每次升档把人的井洗回默认。多桌面时代
 * 0.0.14 的 v1 不迁，照「认不出」整档当没有。
 *
 * 零 DOM、零 react，node 里直接测。
 */

/** 落进 gwbData 的文档名 */
export const LAYOUT_DOC = 'layout'
/** 取档 / 存档两条命令的名字。client 半 import 的是本模块（纯逻辑，不带 cordis），所以常量住这儿 */
export const LAYOUT_GET_COMMAND = 'shell.layout.get'
export const LAYOUT_SAVE_COMMAND = 'shell.layout.save'

/** 档的版本。改形状就抬它；旧档按 parseLayoutDoc 的规矩走（v2 迁移，更老的当没有） */
export const LAYOUT_VERSION = 3

/** 一套存下来的布局。`id` 档内部认人用（`l1`、`l2`…），人看的是 `name` */
export interface SavedLayout {
  id: string
  name: string
  /** 井的序列化结果。存进来是什么就是什么，应用时原样交给 `fromJSON` */
  layout: Record<string, unknown>
}

/** 一口桌面在档里的那一条 */
export interface DesktopRow {
  /** 档内部认人用（`d1`、`d2`…）。切换、可见性通知都按它，id 才是身份 */
  id: string
  /** 人看的名字。不唯一——同名的两口靠 id 分 */
  name: string
  /** 这口井上次的样子。null = 没存过（第一次切到时按注册表铺默认） */
  layout: Record<string, unknown> | null
}

/** 布局档本体 */
export interface LayoutDoc {
  v: number
  /** 此刻活动的是哪口（desktops 里某条的 id）。井在页面那半，档记的是「重启回到哪口」 */
  active: string
  desktops: DesktopRow[]
  saved: SavedLayout[]
}

/** saved 清单的严格校验，v2 / v3 两条路同吃一份。坏一条整档当没有：档是机器写的，坏一条通常意味着整份都有问题 */
function parseSaved(raw: unknown): SavedLayout[] | null {
  if (!Array.isArray(raw)) return null
  const rows: SavedLayout[] = []
  const ids = new Set<string>()
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null
    const row = item as { id?: unknown; name?: unknown; layout?: unknown }
    if (typeof row.id !== 'string' || row.id === '') return null
    if (typeof row.name !== 'string' || row.name === '') return null
    if (row.layout === null || typeof row.layout !== 'object' || Array.isArray(row.layout)) return null
    // id 撞了后面所有「按 id 认布局」的账全乱，进不了档
    if (ids.has(row.id)) return null
    ids.add(row.id)
    rows.push({ id: row.id, name: row.name, layout: row.layout as Record<string, unknown> })
  }
  return rows
}

/** 井的序列化那格：要么是对象（dockview 的 toJSON），要么是 null（没存过）。别的都是坏档 */
function parseLayout(raw: unknown): Record<string, unknown> | null | undefined {
  if (raw === null) return null
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  return undefined
}

/**
 * 盘上的东西 → 档。**认不出就回 null，当没有**：第一次开机、档被人手改坏、多桌面时代的
 * v1 旧档，都走同一条路（回默认）。**v2 当场迁成 v3**——迁移不落盘，下一次自动保存写的
 * 就已经是 v3。
 */
export function parseLayoutDoc(raw: unknown): LayoutDoc | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const v = (raw as { v?: unknown }).v
  if (v === 2) {
    const doc = raw as { current?: unknown; saved?: unknown }
    const current = parseLayout(doc.current)
    if (current === undefined) return null
    const saved = parseSaved(doc.saved)
    if (saved === null) return null
    return { v: LAYOUT_VERSION, active: 'd1', desktops: [{ id: 'd1', name: '主桌面', layout: current }], saved }
  }
  if (v !== LAYOUT_VERSION) return null
  const doc = raw as { active?: unknown; desktops?: unknown; saved?: unknown }
  if (typeof doc.active !== 'string' || doc.active === '') return null
  if (!Array.isArray(doc.desktops) || doc.desktops.length === 0) return null
  const rows: DesktopRow[] = []
  const ids = new Set<string>()
  for (const item of doc.desktops) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null
    const row = item as { id?: unknown; name?: unknown; layout?: unknown }
    if (typeof row.id !== 'string' || row.id === '') return null
    if (typeof row.name !== 'string' || row.name === '') return null
    const layout = parseLayout(row.layout)
    if (layout === undefined) return null
    if (ids.has(row.id)) return null
    ids.add(row.id)
    rows.push({ id: row.id, name: row.name, layout })
  }
  // active 指着一口不存在的桌面：档坏了，整份当没有——猜一口（比如第一口）的话，
  // 重启回到哪儿就取决于谁写的档，那种静默比回默认贵
  if (!ids.has(doc.active)) return null
  const saved = parseSaved(doc.saved)
  if (saved === null) return null
  return { v: LAYOUT_VERSION, active: doc.active, desktops: rows, saved }
}

/** 头一回（或档废了）的那份：一口「桌面 1」，layout 留 null——井第一次起时按注册表铺默认 */
export function defaultDoc(): LayoutDoc {
  return { v: LAYOUT_VERSION, active: 'd1', desktops: [{ id: 'd1', name: '桌面 1', layout: null }], saved: [] }
}

/** 新桌面的 id：取最小没占用的 `dN`。与 saved 那套同理——删过再建会复用号，无害 */
export function nextDesktopId(desktops: readonly DesktopRow[]): string {
  const taken = new Set(desktops.map((d) => d.id))
  for (let n = 1; ; n++) {
    const id = `d${n}`
    if (!taken.has(id)) return id
  }
}

/**
 * 存一条进 saved 清单。**同名覆盖**：名字是这套布局的钥匙，重存就是更新——不然清单里躺两个
 * 「干活」谁也说不清点哪个。覆盖时**保住原条目的 id**（id 是档内部认人的键，跟人走
 * 的名字换了内容也不换身份）。纯函数，出的是新数组。
 */
export function upsertSaved(saved: readonly SavedLayout[], name: string, layout: Record<string, unknown>): SavedLayout[] {
  const prev = saved.find((s) => s.name === name)
  const rest = saved.filter((s) => s.name !== name)
  return [...rest, { id: prev?.id ?? nextLayoutId(rest), name, layout }]
}

/** 新布局条目的 id：取最小没占用的 `lN`。删过再存会复用号——旧条目整个不在了，复用无害 */
export function nextLayoutId(saved: readonly SavedLayout[]): string {
  const taken = new Set(saved.map((s) => s.id))
  for (let n = 1; ; n++) {
    const id = `l${n}`
    if (!taken.has(id)) return id
  }
}

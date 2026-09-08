/**
 * 布局档：外壳往 gwbData 落的那份文档，与围绕它的几个纯判断。
 *
 * 一份文档装两样：**current**（上次的井，自动防抖保存，重启回到它）与 **saved**（人起名
 * 存下的布局清单，点了哪条就把哪条铺回井上）。仍是单文档——写单位是整档，保存器醒来
 * 时读「当下」重拼一份，迟到的旧定时器写不坏账；gwbData 的面一个字不用扩。
 *
 * `current` / 每条 `layout` 都是井的 dockview `toJSON()` 结果，这层**原样搬运、不解读**
 * ——形状归 dockview。认不出的版本整档当没有（见 `parseLayoutDoc`），不写回：两台机器
 * 不同版本互毁的事，等真有了第二台再管。
 *
 * 多桌面（一张桌面一口井、井常驻保活）在这条线上做到 0.0.14 后**撤回**——实机切换出了
 * 「无响应 / 疑似覆盖」的现场，第一波改做这份布局保存。将来重做时档形状另起，不吃这份。
 *
 * 零 DOM、零 react，node 里直接测。
 */

/** 落进 gwbData 的文档名 */
export const LAYOUT_DOC = 'layout'
/** 取档 / 存档两条命令的名字。client 半 import 的是本模块（纯逻辑，不带 cordis），所以常量住这儿 */
export const LAYOUT_GET_COMMAND = 'shell.layout.get'
export const LAYOUT_SAVE_COMMAND = 'shell.layout.save'

/** 档的版本。改形状就抬它，旧档按「认不出」整份当没有 */
export const LAYOUT_VERSION = 2

/** 一套存下来的布局。`id` 档内部认人用（`l1`、`l2`…），人看的是 `name` */
export interface SavedLayout {
  id: string
  name: string
  /** 井的序列化结果。存进来是什么就是什么，应用时原样交给 `fromJSON` */
  layout: Record<string, unknown>
}

/** 布局档本体 */
export interface LayoutDoc {
  v: number
  /**
   * 上次开着的那口井。**null 是「从没存过」**——头一回开机（或档废了）走默认铺格；
   * 井存过一次档（哪怕是空的）这里就是对象。
   */
  current: Record<string, unknown> | null
  saved: SavedLayout[]
}

/**
 * 盘上的东西 → 档。**认不出就回 null，当没有**：第一次开机、档被人手改坏、多桌面时代
 * 的 v1 旧档，都走同一条路（回默认）。saved 里一条坏了也不单独赦免——档是机器写的，
 * 坏一条通常意味着整份都有问题，半份恢复出来的布局谁也说不清缺了什么。
 */
export function parseLayoutDoc(raw: unknown): LayoutDoc | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const doc = raw as { v?: unknown; current?: unknown; saved?: unknown }
  if (doc.v !== LAYOUT_VERSION) return null
  if (doc.current !== null && (typeof doc.current !== 'object' || Array.isArray(doc.current))) return null
  if (!Array.isArray(doc.saved)) return null
  const rows: SavedLayout[] = []
  const ids = new Set<string>()
  for (const item of doc.saved) {
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
  return { v: LAYOUT_VERSION, current: doc.current as Record<string, unknown> | null, saved: rows }
}

/** 头一回（或档废了）的那份：`current` 留 null——井第一次起时按「表里有几格开几格」铺默认 */
export function defaultDoc(): LayoutDoc {
  return { v: LAYOUT_VERSION, current: null, saved: [] }
}

/** 新布局条目的 id：取最小没占用的 `lN`。删过再存会复用号——旧条目整个不在了，复用无害 */
export function nextLayoutId(saved: readonly SavedLayout[]): string {
  const taken = new Set(saved.map((s) => s.id))
  for (let n = 1; ; n++) {
    const id = `l${n}`
    if (!taken.has(id)) return id
  }
}

/**
 * 存一条进清单。**同名覆盖**：名字是这套布局的钥匙，重存就是更新——不然清单里躺两个
 * 「干活」谁也说不清点哪个。覆盖时**保住原条目的 id**（id 是档内部认人的键，跟人走
 * 的名字换了内容也不换身份）。纯函数，出的是新数组。
 */
export function upsertSaved(saved: readonly SavedLayout[], name: string, layout: Record<string, unknown>): SavedLayout[] {
  const prev = saved.find((s) => s.name === name)
  const rest = saved.filter((s) => s.name !== name)
  return [...rest, { id: prev?.id ?? nextLayoutId(rest), name, layout }]
}

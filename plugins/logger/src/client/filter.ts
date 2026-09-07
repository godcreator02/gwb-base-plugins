import { LEVELS, type LogEntry, type LogLevel, type LogSource } from './entries'

/**
 * 四个筛选条件合成一个谓词。纯逻辑，不碰 DOM。
 *
 * 四个维度是「与」的关系——人能把自己筛成空表，所以界面上的空态得分得清
 * 「一条都没有」和「被筛掉了」。
 */

/** 越小越严重。门限是「这一级**及以上**」 */
const SEVERITY: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 }

export interface FilterState {
  /**
   * 级别**门限**，显示这一级及以上。不是等值筛选——日志里 error 少 info 多，
   * 实际操作永远是「把噪声压下去」，而「只看 info 不看 error」那个场景不成立。
   */
  level: LogLevel
  /** 要看哪几路。空集合就是一条都不显示 */
  sources: ReadonlySet<LogSource>
  /**
   * 来源名，空串是「全部」。值是 `source|name` 这样的**复合键**——
   * 不同路的同名（比如宿主和某个件都叫 install）不能撞在一起。
   */
  key: string
  /** 子串、不区分大小写，同时匹配 name 与 msg。**不做正则**：写错的表达式静默匹配不到 */
  search: string
}

export const ALL_SOURCES: ReadonlySet<LogSource> = new Set(['plugin', 'host', 'main', 'renderer'])

export const EMPTY_FILTER: FilterState = {
  level: LEVELS[LEVELS.length - 1]!,
  sources: ALL_SOURCES,
  key: '',
  search: '',
}

/** 一条条目在筛选里的身份键 */
export function keyOf(entry: Pick<LogEntry, 'source' | 'name'>): string {
  return `${entry.source}|${entry.name}`
}

export function matches(entry: LogEntry, f: FilterState): boolean {
  if (SEVERITY[entry.level] > SEVERITY[f.level]) return false
  if (!f.sources.has(entry.source)) return false
  if (f.key !== '' && keyOf(entry) !== f.key) return false
  if (f.search !== '') {
    const needle = f.search.toLowerCase()
    if (!entry.msg.toLowerCase().includes(needle) && !entry.name.toLowerCase().includes(needle)) return false
  }
  return true
}

/** 数一下每一路各有多少条。路那排 toggle 上要显示，**数的是筛选之前的全量** */
export function countBySource(entries: readonly LogEntry[]): Record<LogSource, number> {
  const out: Record<LogSource, number> = { plugin: 0, host: 0, main: 0, renderer: 0 }
  for (const e of entries) out[e.source] += 1
  return out
}

/** 出现过的来源名，按路分组、组内按名字排。下拉那几个 optgroup 就是它 */
export function groupNames(entries: readonly LogEntry[]): { source: LogSource; names: string[] }[] {
  const bySource = new Map<LogSource, Set<string>>()
  for (const e of entries) {
    let set = bySource.get(e.source)
    if (set === undefined) {
      set = new Set()
      bySource.set(e.source, set)
    }
    set.add(e.name)
  }
  const order: LogSource[] = ['plugin', 'host', 'main', 'renderer']
  return order
    .filter((s) => bySource.has(s))
    .map((source) => ({ source, names: [...bySource.get(source)!].sort() }))
}

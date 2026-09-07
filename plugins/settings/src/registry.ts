import { isRecord } from '@godcreator02/gwb-plugin-api'
import { assertKey, assertSection, SHARED_SECTION } from './paths.js'

/** 注册表本体：内存里的两张表 + 定义表 + 解析规则。不碰 ctx、不碰 fs，于是可测 */

export type SettingType = 'string' | 'number' | 'boolean' | 'secret'

/** 不写就是 home：跟着这个 home 走。machine：全机一份，跨 home */
export type SettingScope = 'home' | 'machine'

/** 一项设置的自述。件在 apply 里声明 */
export interface SettingDef {
  /** kebab-case */
  key: string
  /** 界面上的标签 */
  title: string
  /** 界面照它挑控件；`secret` 只影响显示打码，**存储照样明文** */
  type: SettingType
  /** 不写就是 home */
  scope?: SettingScope
  /** 写 true 进公共区，别的件不用 define 就读得到 */
  shared?: boolean
  description?: string
  /** 盘上没值时 get 回它 */
  default?: unknown
}

/** 盘上一项的形状。`value` 缺席就是「还没设过」，不是「设成了 undefined」 */
export interface StoredSetting {
  title?: string
  type?: string
  description?: string
  value?: unknown
}

/** 一份文件：分区 → 设置名 → 那一项 */
export type SettingsFile = Record<string, Record<string, StoredSetting>>

/**
 * 调用方是谁。**两样都要**：机器级按包名分区（跨 home 稳定），home 级按 entryId 分区
 * （同一个包挂两条时分得开）。
 */
export interface Owner {
  entryId: string
  pkg: string
}

/** 一项设置在盘上的位置 */
export interface Slot {
  scope: SettingScope
  section: string
  key: string
}

/** 全局视图的一行，`settings.all` 命令交出去的就是它 */
export interface SettingView extends Slot {
  title?: string
  type?: string
  description?: string
  value?: unknown
  /** 此刻有件声明着它吗。件停了盘上那份还在，但这里是 false */
  live: boolean
}

export interface SettingsRegistry {
  /** 把盘上读来的两份装进来。只在构造时调一次 */
  load(home: SettingsFile, machine: SettingsFile): void
  define(owner: Owner, def: SettingDef): () => void
  get(owner: Owner, key: string): unknown
  /** 算出这一项该往哪写。没声明过回 undefined */
  locate(owner: Owner, key: string): Slot | undefined
  /** 按位置直读，不经身份。界面走这条——它不是一个件，没有身份可绑 */
  read(slot: Slot): unknown
  put(slot: Slot, value: unknown): void
  drop(slot: Slot): void
  /** 内存里的那一份，给落盘用 */
  file(scope: SettingScope): SettingsFile
  all(): SettingView[]
}

/** 定义表的键。NUL 做分隔——entryId 与设置名都不可能含它 */
function defKey(owner: Owner, key: string): string {
  return `${owner.entryId}\u0000${key}`
}

/** 一项声明落在哪一格 */
function slotOf(owner: Owner, def: SettingDef): Slot {
  const scope = def.scope ?? 'home'
  const section = def.shared === true ? SHARED_SECTION : scope === 'machine' ? owner.pkg : owner.entryId
  return { scope, section, key: def.key }
}

function viewKey(slot: Slot): string {
  return `${slot.scope}\u0000${slot.section}\u0000${slot.key}`
}

/**
 * 盘上读来的东西收窄成 `SettingsFile`。用户手改坏了一格，只丢那一格，不是整份不认。
 * 坏了都要 warn ——数据烂掉悄悄变成「用默认值」是最难查的那种。
 */
export function toSettingsFile(raw: unknown, warn: (message: string) => void, where: string): SettingsFile {
  if (!isRecord(raw)) {
    warn(`${where} 顶层不是一个对象，当没有处理`)
    return {}
  }
  const out: SettingsFile = {}
  for (const [section, items] of Object.entries(raw)) {
    if (!isRecord(items)) {
      warn(`${where} 的分区 ${section} 不是一个对象，跳过`)
      continue
    }
    const bucket: Record<string, StoredSetting> = {}
    for (const [key, item] of Object.entries(items)) {
      if (!isRecord(item)) {
        warn(`${where} 的 ${section}/${key} 不是一个对象，跳过`)
        continue
      }
      bucket[key] = item as StoredSetting
    }
    out[section] = bucket
  }
  return out
}

/**
 * 盘上那份打底，内存这份盖上去。
 * `machine.json` 跨 home 共享，可能有另一个实例也在写，写前要这么并一次。
 */
export function mergeFiles(disk: SettingsFile, mine: SettingsFile): SettingsFile {
  const out: SettingsFile = {}
  for (const [section, items] of Object.entries(disk)) out[section] = { ...items }
  for (const [section, items] of Object.entries(mine)) out[section] = { ...out[section], ...items }
  return out
}

export function createRegistry(warn: (message: string) => void): SettingsRegistry {
  const defs = new Map<string, { owner: Owner; def: SettingDef }>()
  const files: Record<SettingScope, SettingsFile> = { home: {}, machine: {} }

  /** 读一格的值。缺席与「设成了 undefined」在这儿是同一件事 */
  const valueAt = (slot: Slot): unknown => files[slot.scope][slot.section]?.[slot.key]?.value

  return {
    load(home, machine) {
      files.home = home
      files.machine = machine
    },

    define(owner, def) {
      assertKey(def.key)
      assertSection(owner.entryId)
      assertSection(owner.pkg)
      // 空 title 是「这一项没说自己是谁」，让它进表只会在界面上多一格没标签的框
      if (def.title === '') throw new Error(`设置 ${def.key} 的 title 是空的。`)

      const k = defKey(owner, def.key)
      // 撞名后来者赢，但要告警——跟命令总线、窗格注册一个规矩
      if (defs.has(k)) warn(`${owner.entryId} 重复声明了设置 ${def.key}，后来者生效`)
      const record = { owner, def }
      defs.set(k, record)

      // 元信息落进内存表：件挂着时**代码是权威**，盘上那份被覆盖。值不动
      const slot = slotOf(owner, def)
      const section = (files[slot.scope][slot.section] ??= {})
      section[def.key] = {
        ...section[def.key],
        title: def.title,
        type: def.type,
        description: def.description,
      }

      // 注销只收自己那份：撞名之后先来者的注销函数不该把后来者摘掉
      return () => {
        if (defs.get(k) === record) defs.delete(k)
      }
    },

    get(owner, key) {
      const record = defs.get(defKey(owner, key))
      if (record !== undefined) {
        const found = valueAt(slotOf(record.owner, record.def))
        return found === undefined ? record.def.default : found
      }
      // 没声明过，那多半是在读别的件声明进公共区的项——凭据就是这么跨件共享的
      const shared = files.home[SHARED_SECTION]?.[key]?.value
      if (shared !== undefined) return shared
      const machineShared = files.machine[SHARED_SECTION]?.[key]?.value
      if (machineShared !== undefined) return machineShared
      warn(`${owner.entryId} 读了一项谁也没声明过的设置：${key}`)
      return undefined
    },

    locate(owner, key) {
      const record = defs.get(defKey(owner, key))
      return record === undefined ? undefined : slotOf(record.owner, record.def)
    },

    read(slot) {
      return valueAt(slot)
    },

    put(slot, value) {
      const section = (files[slot.scope][slot.section] ??= {})
      section[slot.key] = { ...section[slot.key], value }
    },

    drop(slot) {
      const stored = files[slot.scope][slot.section]?.[slot.key]
      if (stored === undefined) return
      // 抹掉值，定义还在——get 因此回落到 default
      const { value: _dropped, ...rest } = stored
      files[slot.scope][slot.section]![slot.key] = rest
    },

    file(scope) {
      return files[scope]
    },

    all() {
      const live = new Set<string>()
      for (const { owner, def } of defs.values()) live.add(viewKey(slotOf(owner, def)))

      const out: SettingView[] = []
      for (const scope of ['home', 'machine'] as const) {
        for (const [section, items] of Object.entries(files[scope])) {
          for (const [key, stored] of Object.entries(items)) {
            const slot: Slot = { scope, section, key }
            out.push({ ...slot, ...stored, live: live.has(viewKey(slot)) })
          }
        }
      }
      return out
    },
  }
}

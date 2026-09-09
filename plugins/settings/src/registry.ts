import { isRecord } from '@godcreator02/gwb-plugin-api'
import { assertKey, assertSection, entrySection, SHARED_SECTION } from './paths.js'

/** 注册表本体：内存里的两张表 + 定义表 + 解析规则。不碰 ctx、不碰 fs，于是可测 */

/** `list` 的值是 `string[]`——写入时收窄（见 `toListValue`），别的类型不做运行时校验 */
export type SettingType = 'string' | 'number' | 'boolean' | 'secret' | 'list'

/** 一项设置的自述。件在 apply 里声明。**没有机器级**——home 自持全部配置 */
export interface SettingDef {
  /** kebab-case */
  key: string
  /** 界面上的标签 */
  title: string
  /**
   * 界面照它挑控件；`secret` 只影响显示打码，**存储照样明文**。
   * `list` 是唯一做收窄的：写进来的字符串按逗号或空白拆成数组、数组逐项转字符串、别的拒
   */
  type: SettingType
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

/** 调用方是谁。落盘的分区名取 entryId 的末段 */
export interface Owner {
  entryId: string
  pkg: string
}

/** 一项设置在盘上的位置 */
export interface Slot {
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
  /** 把盘上读来的这份装进来。只在构造时调一次 */
  load(home: SettingsFile): void
  define(owner: Owner, def: SettingDef): () => void
  get(owner: Owner, key: string): unknown
  /** 算出这一项该往哪写。没声明过回 undefined */
  locate(owner: Owner, key: string): Slot | undefined
  /** 按位置直读，不经身份。界面走这条——它不是一个件，没有身份可绑 */
  read(slot: Slot): unknown
  /** 按位置写。这一格有活着的定义时按它的 type 收窄（list → string[]，别的原样） */
  put(slot: Slot, value: unknown): void
  drop(slot: Slot): void
  /** 内存里的那一份，给落盘用 */
  file(): SettingsFile
  all(): SettingView[]
}

/**
 * 定义表的键。NUL 做分隔——条目 id 与设置名都不可能含它。
 *
 * 用的是**末段**，跟落盘的分区名一个写法：同一个 owner 两种写法迟早有人对不上。
 * 这张表在内存里，键不落盘。
 */
function defKey(owner: Owner, key: string): string {
  return `${entrySection(owner.entryId)}\u0000${key}`
}

/** 一项声明落在哪一格：共享项进公共区，其余按条目 id 的末段（见 `entrySection`） */
function slotOf(owner: Owner, def: SettingDef): Slot {
  const section = def.shared === true ? SHARED_SECTION : entrySection(owner.entryId)
  return { section, key: def.key }
}

function viewKey(slot: Slot): string {
  return `${slot.section}\u0000${slot.key}`
}

/**
 * `list` 类型的值收窄成 `string[]`。三种来源同一种落盘形状：界面上一格文本框写的
 * `a, b c`、命令行递来的一串、代码里给的一个数组。
 *
 * - 字符串：按逗号或空白拆，空段丢掉（`'a, ,b'` → `['a','b']`，空串 → `[]`）
 * - 数组：逐项 `String()`
 * - 别的一律拒——抛出的话要说清要什么，经命令总线回去就是 `{ ok: false, error }`
 */
export function toListValue(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/[,\s]+/).filter((item) => item !== '')
  if (Array.isArray(value)) return value.map(String)
  throw new Error(`list 类型的设置要一个字符串（逗号或空白分隔）或一个数组，给的是 ${typeof value}`)
}

/** 按定义收窄要写进去的值。只有 `list` 做收窄——别的类型仍是「只给界面挑控件」 */
export function coerceValue(def: Pick<SettingDef, 'type'>, value: unknown): unknown {
  return def.type === 'list' ? toListValue(value) : value
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

export function createRegistry(warn: (message: string) => void): SettingsRegistry {
  const defs = new Map<string, { owner: Owner; def: SettingDef }>()
  let files: SettingsFile = {}

  /** 读一格的值。缺席与「设成了 undefined」在这儿是同一件事 */
  const valueAt = (slot: Slot): unknown => files[slot.section]?.[slot.key]?.value

  /** 此刻有件声明着这一格吗——有的话按它的 type 收窄写入的值。共享项要反查，定义表按 owner 键 */
  const defAt = (slot: Slot): SettingDef | undefined => {
    for (const { owner, def } of defs.values()) {
      const at = slotOf(owner, def)
      if (at.section === slot.section && at.key === slot.key) return def
    }
    return undefined
  }

  return {
    load(home) {
      files = home
    },

    define(owner, def) {
      assertKey(def.key)
      // 分区名算一遍就是校验：id 不合规、段数超了都在这儿抛——抛在动表之前
      assertSection(entrySection(owner.entryId))
      // 空 title 是「这一项没说自己是谁」，让它进表只会在界面上多一格没标签的框
      if (def.title === '') throw new Error(`设置 ${def.key} 的 title 是空的。`)

      const k = defKey(owner, def.key)
      // 撞名后来者赢，但要告警——跟命令总线、窗格注册一个规矩
      if (defs.has(k)) warn(`${owner.entryId} 重复声明了设置 ${def.key}，后来者生效`)
      const record = { owner, def }
      defs.set(k, record)

      // 元信息落进内存表：件挂着时**代码是权威**，盘上那份被覆盖。值不动
      const slot = slotOf(owner, def)
      const section = (files[slot.section] ??= {})
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
      const shared = files[SHARED_SECTION]?.[key]?.value
      if (shared !== undefined) return shared
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
      // 有活着的定义就按它收窄（眼下只有 list 真收窄）；没有就原样存——件停着时界面照样能改值
      const def = defAt(slot)
      const stored = def === undefined ? value : coerceValue(def, value)
      const section = (files[slot.section] ??= {})
      section[slot.key] = { ...section[slot.key], value: stored }
    },

    drop(slot) {
      const stored = files[slot.section]?.[slot.key]
      if (stored === undefined) return
      // 抹掉值，定义还在——get 因此回落到 default
      const { value: _dropped, ...rest } = stored
      files[slot.section]![slot.key] = rest
    },

    file() {
      return files
    },

    all() {
      const live = new Set<string>()
      for (const { owner, def } of defs.values()) live.add(viewKey(slotOf(owner, def)))

      const out: SettingView[] = []
      for (const [section, items] of Object.entries(files)) {
        for (const [key, stored] of Object.entries(items)) {
          const slot: Slot = { section, key }
          out.push({ ...slot, ...stored, live: live.has(viewKey(slot)) })
        }
      }
      return out
    },
  }
}

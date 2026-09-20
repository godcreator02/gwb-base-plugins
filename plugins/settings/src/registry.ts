import { isRecord } from '@godcreator/gwb-plugin-api'
import { assertKey, assertSection, entrySection, OWNERS_KEY, SHARED_SECTION } from './paths.js'

/** 注册表本体：内存里的两张表 + 定义表 + 解析规则。不碰 ctx、不碰 fs，于是可测 */

export type SettingType = 'string' | 'number' | 'boolean' | 'secret' | 'string-list'

/** 一项设置的自述。件在 apply 里声明。**没有机器级**——home 自持全部配置 */
export interface SettingDef {
  /** kebab-case */
  key: string
  /** 界面上的标签 */
  title: string
  /** 界面照它挑控件；`secret` 只影响显示打码，**存储照样明文**；`string-list` 是字符串数组，界面逐行编辑 */
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

/** 户主表：分区名 → 包名。盘上住在文件顶层的 `$owners` 键下 */
export type SettingsOwners = Record<string, string>

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
  /**
   * 声明方递的默认值——只有此刻 live 的项才带：它住在内存定义表里**不落盘**，
   * 界面拿它画灰占位（「没设过时生效的是这个」）。件停了以后的陈旧默认没有显示的意义
   */
  default?: unknown
  /** 此刻有件声明着它吗。件停了盘上那份还在，但这里是 false */
  live: boolean
}

export interface SettingsRegistry {
  /** 把盘上读来的这份装进来。只在构造时调一次 */
  load(home: SettingsFile, owners: SettingsOwners): void
  define(owner: Owner, def: SettingDef): () => void
  get(owner: Owner, key: string): unknown
  /** 算出这一项该往哪写。没声明过回 undefined */
  locate(owner: Owner, key: string): Slot | undefined
  /** 按位置直读，不经身份。界面走这条——它不是一个件，没有身份可绑 */
  read(slot: Slot): unknown
  put(slot: Slot, value: unknown): void
  drop(slot: Slot): void
  /** 内存里的那一份，给落盘用 */
  file(): SettingsFile
  /** 户主表，给落盘与 `owners()` 用 */
  owners(): SettingsOwners
  /** 把一个分区过户给 `pkg` */
  transfer(section: string, pkg: string): void
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
    // 户主表另读，见 `toOwners`
    if (section === OWNERS_KEY) continue
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

/** 盘上读来的东西里取出户主表。坏了的那一格丢掉并 warn——丢了只是那个分区回到「谁先来归谁」 */
export function toOwners(raw: unknown, warn: (message: string) => void, where: string): SettingsOwners {
  const table = isRecord(raw) ? raw[OWNERS_KEY] : undefined
  if (table === undefined) return {}
  if (!isRecord(table)) {
    warn(`${where} 的 ${OWNERS_KEY} 不是一个对象，当没有处理`)
    return {}
  }
  const out: SettingsOwners = {}
  for (const [section, pkg] of Object.entries(table)) {
    if (typeof pkg !== 'string' || pkg === '') {
      warn(`${where} 的 ${OWNERS_KEY}.${section} 不是一个包名，跳过`)
      continue
    }
    out[section] = pkg
  }
  return out
}

export function createRegistry(warn: (message: string) => void): SettingsRegistry {
  const defs = new Map<string, { owner: Owner; def: SettingDef }>()
  let files: SettingsFile = {}
  let owners: SettingsOwners = {}

  /** 读一格的值。缺席与「设成了 undefined」在这儿是同一件事 */
  const valueAt = (slot: Slot): unknown => files[slot.section]?.[slot.key]?.value

  return {
    load(home, table) {
      files = home
      owners = table
    },

    define(owner, def) {
      assertKey(def.key)
      // 分区名算一遍就是校验：id 不合规、段数超了都在这儿抛——抛在动表之前
      const own = entrySection(owner.entryId)
      assertSection(own)
      // 空 title 是「这一项没说自己是谁」，让它进表只会在界面上多一格没标签的框
      if (def.title === '') throw new Error(`设置 ${def.key} 的 title 是空的。`)
      // 核章：分区没主就归它，是别的包的就拒——不拒的话它会把前一个包留下的设置当自己的读
      const holder = owners[own]
      if (holder !== undefined && holder !== owner.pkg) {
        throw new Error(
          `设置分区 ${own} 归 ${holder}，${owner.pkg} 用不了。多半是两个包名不同的件算出了同一个条目 id——给这条条目换个 id；确认是同一个件改了包名，走 plugin-manager.transfer-owner 过户`,
        )
      }
      owners[own] = owner.pkg

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
      const section = (files[slot.section] ??= {})
      section[slot.key] = { ...section[slot.key], value }
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

    owners() {
      return owners
    },

    transfer(section, pkg) {
      assertSection(section)
      if (pkg === '') throw new Error('过户要给一个非空的包名')
      owners[section] = pkg
    },

    all() {
      const live = new Set<string>()
      const defaults = new Map<string, unknown>()
      for (const { owner, def } of defs.values()) {
        const view = viewKey(slotOf(owner, def))
        live.add(view)
        if (def.default !== undefined) defaults.set(view, def.default)
      }

      const out: SettingView[] = []
      for (const [section, items] of Object.entries(files)) {
        for (const [key, stored] of Object.entries(items)) {
          const slot: Slot = { section, key }
          const view = viewKey(slot)
          const declared = defaults.get(view)
          out.push({ ...slot, ...stored, ...(declared !== undefined ? { default: declared } : {}), live: live.has(view) })
        }
      }
      return out
    },
  }
}

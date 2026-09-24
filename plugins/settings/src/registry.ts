import { isRecord } from './vocab.js'
import { assertKey, assertSection, entrySection, OWNERS_KEY, SHARED_SECTION } from './paths.js'

// 这个文件不碰 ctx、不碰 fs：内存里的设置表、声明表与解析规则

export type SettingType = 'string' | 'number' | 'boolean' | 'secret' | 'string-list'

/** 一项设置的声明，插件在 apply 里给 */
export interface SettingDef {
  /** kebab-case */
  key: string
  /** 界面上的标签 */
  title: string
  /**
   * 界面照它挑控件。`secret`：界面打码显示，`settings.all` 不回值（只回 `secret` / `isSet` / `mask`），
   * 存储照样是明文，`settings.get` 与服务的 `get` 读得到真值。`string-list` 是字符串数组，界面逐行编辑
   */
  type: SettingType
  /** 写 true 进公共区，别的插件不用 define 就读得到 */
  shared?: boolean
  description?: string
  /** 文件里没值时 get 回它 */
  default?: unknown
}

/** 文件里一项的形状。`value` 缺席就是「还没设过」，不是「设成了 undefined」 */
export interface StoredSetting {
  title?: string
  type?: string
  description?: string
  value?: unknown
}

/** 一份文件：分区 → 设置名 → 那一项 */
export type SettingsFile = Record<string, Record<string, StoredSetting>>

/** 归属表：分区名 → 包名。在文件里是顶层的 `$owners` 键 */
export type SettingsOwners = Record<string, string>

/** 调用方是谁。分区名取 entryId 的末段 */
export interface Owner {
  entryId: string
  pkg: string
}

/** 一项设置在文件里的位置 */
export interface Slot {
  section: string
  key: string
}

/** `settings.all` 给 secret 行的掩码。长度恒定：照真实长度打码等于把长度交出去。设没设过看 `isSet`，别从掩码推 */
export const SECRET_MASK = '••••'

/** `settings.all` 交出去的一行。secret 行没有 `value` 也没有 `default` */
export interface SettingView extends Slot {
  title?: string
  type?: string
  description?: string
  /** 明文的值。secret 行没有这一项，看 `secret` / `isSet` / `mask` */
  value?: unknown
  /** 声明方给的默认值，只有此刻有插件声明着的项才带（它不写进文件）。secret 行不带：写死的凭据也是凭据 */
  default?: unknown
  /** 此刻有插件声明着它吗。插件停了文件里那份还在，但这里是 false */
  live: boolean
  /** 这一项是 `secret` 型吗。非 secret 行不带 */
  secret?: true
  /** secret 行设过值没有。非 secret 行不带 */
  isSet?: boolean
  /** secret 行已设置时的定长掩码。没设过就不带——空掩码会被读成「设了个空值」 */
  mask?: string
}

export interface SettingsRegistry {
  /** 把文件里读来的这份装进来。只在构造时调一次 */
  load(home: SettingsFile, owners: SettingsOwners): void
  define(owner: Owner, def: SettingDef): () => void
  get(owner: Owner, key: string): unknown
  /** 算出这一项该往哪写。没声明过回 undefined */
  locate(owner: Owner, key: string): Slot | undefined
  /** 按位置直读，不经身份，secret 项也回明文。`settings.get` 命令走这条 */
  read(slot: Slot): unknown
  put(slot: Slot, value: unknown): void
  drop(slot: Slot): void
  /** 内存里的那一份，写文件用 */
  file(): SettingsFile
  /** 归属表，写文件与 `owners()` 用 */
  owners(): SettingsOwners
  /** 把一个分区改归 `pkg` */
  transfer(section: string, pkg: string): void
  /** 全部设置，给 `settings.all` 命令。secret 行不回明文，见 `SettingView` */
  all(): SettingView[]
}

interface Declaration {
  owner: Owner
  def: SettingDef
}

/** 声明表的键：分区名（末段，和文件里的分区名同一种写法）+ NUL + 设置名。条目 id 与设置名都不可能含 NUL */
function declarationKey(owner: Owner, key: string): string {
  return `${entrySection(owner.entryId)}\u0000${key}`
}

/** 共享项进公共区，其余按条目 id 的末段 */
function slotOf(owner: Owner, def: SettingDef): Slot {
  const section = def.shared === true ? SHARED_SECTION : entrySection(owner.entryId)
  return { section, key: def.key }
}

function viewKey(slot: Slot): string {
  return `${slot.section}\u0000${slot.key}`
}

/** secret 行摘掉 `value` 与 `default`，补上 `secret`、`isSet`、设过才有的 `mask`；非 secret 行原样返回 */
function maskSecret(view: SettingView): SettingView {
  if (view.type !== 'secret') return view
  const { value: _value, default: _default, ...rest } = view
  const isSet = _value !== undefined
  return { ...rest, secret: true, isSet, ...(isSet ? { mask: SECRET_MASK } : {}) }
}

function validItemsOfSection(items: Record<string, unknown>, section: string, warn: (message: string) => void, where: string): Record<string, StoredSetting> {
  const validItems: Record<string, StoredSetting> = {}
  for (const [key, item] of Object.entries(items)) {
    if (!isRecord(item)) {
      warn(`${where} 的 ${section}/${key} 不是一个对象，跳过`)
      continue
    }
    validItems[key] = item as StoredSetting
  }
  return validItems
}

/** 文件里读来的东西收窄成 `SettingsFile`。手改坏了一项只丢那一项并写 warn，不是整份不认 */
export function toSettingsFile(raw: unknown, warn: (message: string) => void, where: string): SettingsFile {
  if (!isRecord(raw)) {
    warn(`${where} 顶层不是一个对象，当没有处理`)
    return {}
  }
  const settingsBySection: SettingsFile = {}
  for (const [section, items] of Object.entries(raw)) {
    if (section === OWNERS_KEY) continue
    if (!isRecord(items)) {
      warn(`${where} 的分区 ${section} 不是一个对象，跳过`)
      continue
    }
    settingsBySection[section] = validItemsOfSection(items, section, warn, where)
  }
  return settingsBySection
}

/** 文件里读来的东西里取出归属表。坏了的那一项丢掉并 warn，那个分区回到「谁先声明归谁」 */
export function toOwners(raw: unknown, warn: (message: string) => void, where: string): SettingsOwners {
  const table = isRecord(raw) ? raw[OWNERS_KEY] : undefined
  if (table === undefined) return {}
  if (!isRecord(table)) {
    warn(`${where} 的 ${OWNERS_KEY} 不是一个对象，当没有处理`)
    return {}
  }
  const ownerBySection: SettingsOwners = {}
  for (const [section, pkg] of Object.entries(table)) {
    if (typeof pkg !== 'string' || pkg === '') {
      warn(`${where} 的 ${OWNERS_KEY}.${section} 不是一个包名，跳过`)
      continue
    }
    ownerBySection[section] = pkg
  }
  return ownerBySection
}

/** 先于任何改动做完全部校验，返回调用方的分区名 */
function assertDefinable(owner: Owner, def: SettingDef): string {
  assertKey(def.key)
  const ownSection = entrySection(owner.entryId)
  assertSection(ownSection)
  if (def.title === '') throw new Error(`设置 ${def.key} 的 title 是空的。`)
  return ownSection
}

export function createRegistry(warn: (message: string) => void): SettingsRegistry {
  const declarationsByKey = new Map<string, Declaration>()
  let settingsBySection: SettingsFile = {}
  let ownerBySection: SettingsOwners = {}

  const valueAt = (slot: Slot): unknown => settingsBySection[slot.section]?.[slot.key]?.value

  /** 分区没有归属就归调用方，归别的包就抛错 */
  const claimSection = (ownSection: string, owner: Owner): void => {
    const holder = ownerBySection[ownSection]
    if (holder !== undefined && holder !== owner.pkg) {
      throw new Error(
        `设置分区 ${ownSection} 归 ${holder}，${owner.pkg} 用不了。多半是两个包名不同的插件算出了同一个条目 id——给这条条目换个 id；确认是同一个插件改了包名，走 plugin-manager.transfer-owner 过户`,
      )
    }
    ownerBySection[ownSection] = owner.pkg
  }

  /** 插件加载着时声明是权威：标题、类型、说明覆盖文件里的，值不动 */
  const writeDeclarationIntoFile = (owner: Owner, def: SettingDef): void => {
    const slot = slotOf(owner, def)
    const section = (settingsBySection[slot.section] ??= {})
    section[def.key] = {
      ...section[def.key],
      title: def.title,
      type: def.type,
      description: def.description,
    }
  }

  /** 此刻有声明的各项的位置，与其中带默认值的那些 */
  const liveViewKeysAndDefaults = (): { liveViewKeys: Set<string>; declaredDefaultByViewKey: Map<string, unknown> } => {
    const liveViewKeys = new Set<string>()
    const declaredDefaultByViewKey = new Map<string, unknown>()
    for (const { owner, def } of declarationsByKey.values()) {
      const view = viewKey(slotOf(owner, def))
      liveViewKeys.add(view)
      if (def.default !== undefined) declaredDefaultByViewKey.set(view, def.default)
    }
    return { liveViewKeys, declaredDefaultByViewKey }
  }

  return {
    load(home, table) {
      settingsBySection = home
      ownerBySection = table
    },

    define(owner, def) {
      const ownSection = assertDefinable(owner, def)
      claimSection(ownSection, owner)

      const key = declarationKey(owner, def.key)
      if (declarationsByKey.has(key)) warn(`${owner.entryId} 重复声明了设置 ${def.key}，后来者生效`)
      const declaration: Declaration = { owner, def }
      declarationsByKey.set(key, declaration)
      writeDeclarationIntoFile(owner, def)

      // 只删自己这份：重复声明之后，先声明的一方注销时不能删掉后来的那份
      return () => {
        if (declarationsByKey.get(key) === declaration) declarationsByKey.delete(key)
      }
    },

    get(owner, key) {
      const declaration = declarationsByKey.get(declarationKey(owner, key))
      if (declaration !== undefined) {
        const stored = valueAt(slotOf(declaration.owner, declaration.def))
        return stored === undefined ? declaration.def.default : stored
      }
      const shared = settingsBySection[SHARED_SECTION]?.[key]?.value
      if (shared !== undefined) return shared
      warn(`${owner.entryId} 读了一项谁也没声明过的设置：${key}`)
      return undefined
    },

    locate(owner, key) {
      const declaration = declarationsByKey.get(declarationKey(owner, key))
      return declaration === undefined ? undefined : slotOf(declaration.owner, declaration.def)
    },

    read(slot) {
      return valueAt(slot)
    },

    put(slot, value) {
      const section = (settingsBySection[slot.section] ??= {})
      section[slot.key] = { ...section[slot.key], value }
    },

    drop(slot) {
      const stored = settingsBySection[slot.section]?.[slot.key]
      if (stored === undefined) return
      const { value: _dropped, ...rest } = stored
      settingsBySection[slot.section]![slot.key] = rest
    },

    file() {
      return settingsBySection
    },

    owners() {
      return ownerBySection
    },

    transfer(section, pkg) {
      assertSection(section)
      if (pkg === '') throw new Error('过户要给一个非空的包名')
      ownerBySection[section] = pkg
    },

    all() {
      const { liveViewKeys, declaredDefaultByViewKey } = liveViewKeysAndDefaults()
      const rows: SettingView[] = []
      for (const [section, items] of Object.entries(settingsBySection)) {
        for (const [key, stored] of Object.entries(items)) {
          const slot: Slot = { section, key }
          const view = viewKey(slot)
          const declaredDefault = declaredDefaultByViewKey.get(view)
          rows.push({ ...slot, ...stored, ...(declaredDefault !== undefined ? { default: declaredDefault } : {}), live: liveViewKeys.has(view) })
        }
      }
      // secret 行的明文在这里拦下，见 `maskSecret`
      return rows.map(maskSecret)
    },
  }
}

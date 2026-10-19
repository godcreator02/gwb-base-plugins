import { isRecord } from './vocab.js'
import { assertKey, assertSection, derivedKey, entrySection, isValidKey, OWNERS_KEY, SHARED_SECTION } from './paths.js'

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
   * 值由本 home 的 credentials.json 明文保管；插件内部 get 可取用，MCP 只读状态。`string-list` 是字符串数组
   */
  type: SettingType
  /** 写 true 进公共区，别的插件不用 define 就读得到 */
  shared?: boolean
  description?: string
  /** 文件里没值时 get 回它 */
  default?: unknown
  /**
   * 只能配 `type: 'string'`。界面画成下拉框，清单经 `settings.options` 取；经命令或 `set` 写入时值必须在清单里，`delete` 不查。
   * 每次用到都调一次，不缓存：清单可以随本机状态变（如装了新字体）
   */
  options?: () => Promise<readonly string[]>
}

/**
 * 一组设置：同一套字段可以有任意多份实例（如多份模型配置，每份有模型名、地址、token）。
 * `key` 这一项本身是 string-list，存实例名单；名单里每个实例的每个字段各是一项普通设置，键名 `<key>.<实例>.<字段>`
 */
export interface SettingGroupDef {
  /** kebab-case，也是存实例名单那一项的键 */
  key: string
  /** 实例名单那一项的标签 */
  title: string
  description?: string
  /** 每份实例都有的字段。key 是 kebab-case、组内不重复；派生项的标签是「<实例> · <字段 title>」 */
  fields: Array<{ key: string; title: string; type: SettingType; description?: string; default?: unknown }>
}

/** `getGroup` 回的一份实例：名字与各字段的值，没值的字段是它的 default */
export interface SettingGroupInstance {
  name: string
  values: Record<string, unknown>
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
  /** 声明里带 `options`：界面画成下拉框，清单经 `settings.options` 取。没有选项的行不带 */
  hasOptions?: true
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
  /** 声明实例名单一项，再给名单里现有的每个实例声明各字段。回的函数把这些声明全部注销 */
  defineGroup(owner: Owner, def: SettingGroupDef): () => void
  /** 按名单顺序回各实例的值。没 defineGroup 过这个组就抛错 */
  getGroup(owner: Owner, key: string): SettingGroupInstance[]
  get(owner: Owner, key: string): unknown
  /** 算出这一项该往哪写。没声明过回 undefined */
  locate(owner: Owner, key: string): Slot | undefined
  /** 内部按位置直读，不经身份，secret 项也回明文；命令层先校验对象类型与调用来源 */
  read(slot: Slot): unknown
  /** 按位置读、没值时回此刻声明里的 default：就是声明方 get 会回的值，给 watch 的回调用 */
  effectiveValue(slot: Slot): unknown
  /** 此刻声明着这个位置、且带 `options` 的那份声明的清单函数；没有就回 undefined */
  optionsAt(slot: Slot): (() => Promise<readonly string[]>) | undefined
  /** 不含值的状态，普通项也不带 value/default。不存在时回 undefined */
  status(slot: Slot): SettingStatus | undefined
  /** 写的是某个组的实例名单时，先校验新名单（不合规抛错、什么都不改），写入后补上新实例的声明、撤销去掉的实例的声明 */
  put(slot: Slot, value: unknown): void
  /** 抹掉的是某个组的实例名单时，名单变空，全部实例的声明撤销，值留着 */
  drop(slot: Slot): void
  /** 内存里的那一份，写文件用 */
  file(): SettingsFile
  /** 归属表，写文件与 `owners()` 用 */
  owners(): SettingsOwners
  /** 把一个分区改归 `pkg` */
  transfer(section: string, pkg: string): void
  /** 完整元信息视图；命令层分别筛给 settings.all 与 credentials.list。secret 行不回明文 */
  all(): SettingView[]
}

/** 供 agent 核对配置是否存在；不携带值或默认值 */
export interface SettingStatus extends Slot {
  type?: string
  secret: boolean
  isSet: boolean
  live: boolean
}

interface Declaration {
  owner: Owner
  def: SettingDef
}

interface GroupDeclaration {
  owner: Owner
  def: SettingGroupDef
  /** 实例名 → 注销它各字段声明的函数 */
  undefineFieldsByInstance: Map<string, Array<() => void>>
}

/** 名单是外部输入（命令、手改的文件）：不合规就拒绝，不替它修正 */
function instanceNamesOf(groupKey: string, value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((name) => typeof name === 'string')) {
    throw new Error(`一组设置 ${groupKey} 的实例名单要是字符串数组，如 ["deepseek","kimi"]`)
  }
  const names = value as string[]
  const invalid = names.filter((name) => !isValidKey(name))
  if (invalid.length > 0) {
    throw new Error(`一组设置 ${groupKey} 的实例名不合规：${invalid.map((name) => JSON.stringify(name)).join('、')}。实例名一律 kebab-case（小写字母、数字、单连字符分段），比如 deepseek、kimi-k2`)
  }
  const duplicated = names.filter((name, index) => names.indexOf(name) !== index)
  if (duplicated.length > 0) throw new Error(`一组设置 ${groupKey} 的实例名重复了：${[...new Set(duplicated)].join('、')}`)
  return names
}

function assertGroupDefinable(def: SettingGroupDef): void {
  assertKey(def.key)
  if (def.title === '') throw new Error(`一组设置 ${def.key} 的 title 是空的。`)
  if (def.fields.length === 0) throw new Error(`一组设置 ${def.key} 没有字段。`)
  const seen = new Set<string>()
  for (const field of def.fields) {
    assertKey(field.key)
    if (field.title === '') throw new Error(`一组设置 ${def.key} 的字段 ${field.key} 的 title 是空的。`)
    if (seen.has(field.key)) throw new Error(`一组设置 ${def.key} 的字段 ${field.key} 重复了。`)
    seen.add(field.key)
  }
}

function instanceListDef(def: SettingGroupDef): SettingDef {
  return { key: def.key, title: def.title, type: 'string-list', description: def.description }
}

function instanceFieldDefs(def: SettingGroupDef, instanceName: string): SettingDef[] {
  return def.fields.map((field) => ({
    key: derivedKey(def.key, instanceName, field.key),
    title: `${instanceName} · ${field.title}`,
    type: field.type,
    description: field.description,
    default: field.default,
  }))
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

/** 先于任何改动做完全部校验，返回调用方的分区名。只有 define 收的键要查 kebab-case，组派生的键由 defineGroup 拼出 */
function assertDefinable(owner: Owner, def: SettingDef): string {
  assertKey(def.key)
  return assertDeclarable(owner, def)
}

function assertDeclarable(owner: Owner, def: SettingDef): string {
  const ownSection = entrySection(owner.entryId)
  assertSection(ownSection)
  if (def.title === '') throw new Error(`设置 ${def.key} 的 title 是空的。`)
  if (def.options !== undefined && def.type !== 'string') throw new Error(`设置 ${def.key} 配了 options，只有 type 为 'string' 的项能配，它是 '${def.type}'。`)
  return ownSection
}

export function createRegistry(warn: (message: string) => void): SettingsRegistry {
  const declarationsByKey = new Map<string, Declaration>()
  let settingsBySection: SettingsFile = {}
  let ownerBySection: SettingsOwners = {}

  const valueAt = (slot: Slot): unknown => settingsBySection[slot.section]?.[slot.key]?.value

  const writeValue = (slot: Slot, value: unknown): void => {
    const section = (settingsBySection[slot.section] ??= {})
    section[slot.key] = { ...section[slot.key], value }
  }

  /** 分区没有归属就归调用方，归别的包就抛错 */
  const claimSection = (ownSection: string, owner: Owner): void => {
    const holder = ownerBySection[ownSection]
    if (holder !== undefined && holder !== owner.pkg) {
      throw new Error(
        `设置分区 ${ownSection} 归 ${holder}，不能给 ${owner.pkg} 用。多半是两个包名不同的插件算出了同一个条目 id。要让 ${owner.pkg} 用这个 id，由人手工处理，先关掉工作台（它开着时会用内存里的内容覆盖手改的文件），再改 <home>/settings.json：把分区 ${ownSection} 改名或删掉，同时删掉顶层 ${OWNERS_KEY} 里的 ${ownSection} 一项；确认是同一个插件改了包名、要接着用这些设置，就只把 ${OWNERS_KEY} 里的 ${ownSection} 改成 ${owner.pkg}。也可以给这条条目换个 id`,
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

  /** 此刻有声明的各项的位置，与其中带默认值、带选项的那些 */
  const liveViewKeysAndDefaults = (): { liveViewKeys: Set<string>; declaredDefaultByViewKey: Map<string, unknown>; viewKeysWithOptions: Set<string> } => {
    const liveViewKeys = new Set<string>()
    const declaredDefaultByViewKey = new Map<string, unknown>()
    const viewKeysWithOptions = new Set<string>()
    for (const { owner, def } of declarationsByKey.values()) {
      const view = viewKey(slotOf(owner, def))
      liveViewKeys.add(view)
      if (def.default !== undefined) declaredDefaultByViewKey.set(view, def.default)
      if (def.options !== undefined) viewKeysWithOptions.add(view)
    }
    return { liveViewKeys, declaredDefaultByViewKey, viewKeysWithOptions }
  }

  /** 此刻声明着这个位置的那份声明；共享项与分区项的位置都按 slotOf 比 */
  const liveDeclarationAt = (slot: Slot): SettingDef | undefined => {
    const wanted = viewKey(slot)
    for (const { owner, def } of declarationsByKey.values()) {
      if (viewKey(slotOf(owner, def)) === wanted) return def
    }
    return undefined
  }

  const assertNotDowngradingSecret = (owner: Owner, def: SettingDef): void => {
    const slot = slotOf(owner, def)
    if (settingsBySection[slot.section]?.[slot.key]?.type === 'secret' && def.type !== 'secret') {
      throw new Error('已登记的凭据项不能改成普通设置；请为普通设置另取一个键')
    }
  }

  /** 校验都做完之后才调：从这里起开始改表 */
  const declare = (owner: Owner, def: SettingDef, ownSection: string): (() => void) => {
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
  }

  /** 键是 declarationKey 的写法；组不进公共区，所以实例名单的位置与声明表的键一一对应 */
  const groupsByDeclarationKey = new Map<string, GroupDeclaration>()

  const groupAt = (slot: Slot): GroupDeclaration | undefined =>
    slot.section === SHARED_SECTION ? undefined : groupsByDeclarationKey.get(viewKey(slot))

  const instanceListSlot = (group: GroupDeclaration): Slot => slotOf(group.owner, instanceListDef(group.def))

  /** 名单里每个实例要声明的各项先全部查过，查完才动表 */
  const assertInstancesDeclarable = (owner: Owner, def: SettingGroupDef, names: readonly string[]): void => {
    for (const name of names) {
      for (const fieldDef of instanceFieldDefs(def, name)) assertNotDowngradingSecret(owner, fieldDef)
    }
  }

  /** 去掉的实例撤销声明（值留在文件里，成为 live:false 的项），新增的实例补声明 */
  const syncInstanceDeclarations = (group: GroupDeclaration, names: readonly string[]): void => {
    for (const [name, undefineFields] of group.undefineFieldsByInstance) {
      if (names.includes(name)) continue
      for (const undefine of undefineFields) undefine()
      group.undefineFieldsByInstance.delete(name)
    }
    const ownSection = entrySection(group.owner.entryId)
    for (const name of names) {
      if (group.undefineFieldsByInstance.has(name)) continue
      group.undefineFieldsByInstance.set(name, instanceFieldDefs(group.def, name).map((fieldDef) => declare(group.owner, fieldDef, ownSection)))
    }
  }

  return {
    load(home, table) {
      settingsBySection = home
      ownerBySection = table
    },

    define(owner, def) {
      const ownSection = assertDefinable(owner, def)
      assertNotDowngradingSecret(owner, def)
      return declare(owner, def, ownSection)
    },

    defineGroup(owner, def) {
      assertGroupDefinable(def)
      const listDef = instanceListDef(def)
      const ownSection = assertDeclarable(owner, listDef)
      assertNotDowngradingSecret(owner, listDef)
      const names = instanceNamesOf(def.key, valueAt(slotOf(owner, listDef)))
      assertInstancesDeclarable(owner, def, names)

      const undefineList = declare(owner, listDef, ownSection)
      const group: GroupDeclaration = { owner, def, undefineFieldsByInstance: new Map() }
      const key = declarationKey(owner, def.key)
      groupsByDeclarationKey.set(key, group)
      syncInstanceDeclarations(group, names)

      return () => {
        syncInstanceDeclarations(group, [])
        if (groupsByDeclarationKey.get(key) === group) groupsByDeclarationKey.delete(key)
        undefineList()
      }
    },

    getGroup(owner, key) {
      const group = groupsByDeclarationKey.get(declarationKey(owner, key))
      if (group === undefined) throw new Error(`${owner.entryId} 没有用 defineGroup 声明过一组设置 ${key}`)
      const names = instanceNamesOf(key, valueAt(instanceListSlot(group)))
      const ownSection = entrySection(group.owner.entryId)
      return names.map((name) => ({
        name,
        values: Object.fromEntries(group.def.fields.map((field) => {
          const stored = valueAt({ section: ownSection, key: derivedKey(key, name, field.key) })
          return [field.key, stored === undefined ? field.default : stored]
        })),
      }))
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

    effectiveValue(slot) {
      const stored = valueAt(slot)
      return stored === undefined ? liveDeclarationAt(slot)?.default : stored
    },

    optionsAt(slot) {
      return liveDeclarationAt(slot)?.options
    },

    status(slot) {
      const stored = settingsBySection[slot.section]?.[slot.key]
      if (stored === undefined) return undefined
      const { liveViewKeys } = liveViewKeysAndDefaults()
      return { ...slot, type: stored.type, secret: stored.type === 'secret', isSet: stored.value !== undefined, live: liveViewKeys.has(viewKey(slot)) }
    },

    put(slot, value) {
      const group = groupAt(slot)
      if (group === undefined) {
        writeValue(slot, value)
        return
      }
      const names = instanceNamesOf(group.def.key, value)
      assertInstancesDeclarable(group.owner, group.def, names)
      writeValue(slot, value)
      syncInstanceDeclarations(group, names)
    },

    drop(slot) {
      const stored = settingsBySection[slot.section]?.[slot.key]
      if (stored === undefined) return
      const { value: _dropped, ...rest } = stored
      settingsBySection[slot.section]![slot.key] = rest
      const group = groupAt(slot)
      if (group !== undefined) syncInstanceDeclarations(group, [])
    },

    file() {
      return settingsBySection
    },

    owners() {
      return ownerBySection
    },

    transfer(section, pkg) {
      assertSection(section)
      if (pkg === '') throw new Error('改归属要给一个非空的包名')
      ownerBySection[section] = pkg
    },

    all() {
      const { liveViewKeys, declaredDefaultByViewKey, viewKeysWithOptions } = liveViewKeysAndDefaults()
      const rows: SettingView[] = []
      for (const [section, items] of Object.entries(settingsBySection)) {
        for (const [key, stored] of Object.entries(items)) {
          const slot: Slot = { section, key }
          const view = viewKey(slot)
          const declaredDefault = declaredDefaultByViewKey.get(view)
          rows.push({
            ...slot,
            ...stored,
            ...(declaredDefault !== undefined ? { default: declaredDefault } : {}),
            live: liveViewKeys.has(view),
            ...(viewKeysWithOptions.has(view) ? { hasOptions: true as const } : {}),
          })
        }
      }
      // secret 行的明文在这里拦下，见 `maskSecret`
      return rows.map(maskSecret)
    },
  }
}

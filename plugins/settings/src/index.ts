import { Service, type Context } from 'cordis'
import type { GwbContext } from '@godcreator/gwb-kernel-desktop'
import { isRecord, requireKernel } from './vocab.js'
// 这两个 import 同时激活命令插件与说明书插件的 `declare module 'cordis'`，给 ctx 加上 gwbCommands、gwbSkills
import type { GwbCommands } from '@godcreator/gwb-commands'
import type {} from '@godcreator/gwb-skills'
import { entrySection, homeFile, looksRandom } from './paths.js'
import {
  createRegistry,
  type Owner,
  type SettingDef,
  type SettingGroupDef,
  type SettingGroupInstance,
  type SettingsOwners,
  type SettingsRegistry,
  type SettingView,
  type SettingStatus,
  type Slot,
} from './registry.js'
import { readSettings, writeSettings } from './store.js'
import { assertWritableCredential, copyArgs, credentialSlot, generateArgs, generateCredential, importArgs, readCopiedCredential, readImportedCredential } from './credentials.js'

export type {
  SettingDef,
  SettingGroupDef,
  SettingGroupInstance,
  SettingType,
  SettingView,
  SettingStatus,
  SettingsFile,
  SettingsOwners,
  Slot,
  StoredSetting,
} from './registry.js'
export { SHARED_SECTION } from './paths.js'

const PLUGIN_NAME = 'gwb-settings'
/** 命令的 plugin 写包名：MCP 入口按包名给命令分组 */
const PACKAGE_NAME = '@godcreator/gwb-settings'

/** 构建产物在 dist/ 下，包根的 skills/ 就是 '../skills/'；这个目录要列进 package.json 的 files */
const OWN_SKILLS_DIR = new URL('../skills/', import.meta.url)

export const ALL_COMMAND = 'settings.all'
export const GET_COMMAND = 'settings.get'
export const SET_COMMAND = 'settings.set'
export const DELETE_COMMAND = 'settings.delete'
export const CREDENTIALS_LIST_COMMAND = 'credentials.list'
export const CREDENTIALS_STATUS_COMMAND = 'credentials.status'
export const CREDENTIALS_SET_COMMAND = 'credentials.set'
export const CREDENTIALS_DELETE_COMMAND = 'credentials.delete'
export const CREDENTIALS_COPY_COMMAND = 'credentials.copy'
export const CREDENTIALS_IMPORT_COMMAND = 'credentials.import'
export const CREDENTIALS_GENERATE_COMMAND = 'credentials.generate'
export const CREDENTIALS_REVEAL_COMMAND = 'credentials.reveal'

/** 调用方拿到的接口。写 `inject: ['gwbSettings']` 才有 */
export interface GwbSettingsApi {
  /** 声明一项。回注销函数（插件卸载时自动注销，不用自己包 ctx.effect） */
  define(def: SettingDef): () => void
  /**
   * 声明一组设置：`key` 一项存实例名单（string-list），名单里每个实例的每个字段由本服务声明成普通设置，键名 `<key>.<实例>.<字段>`。
   * 名单经 `settings.set` 或 `set` 改动时校验并重算这些声明；去掉的实例值留着，成为 live:false 的项。回注销函数，插件卸载时自动注销
   */
  defineGroup(def: SettingGroupDef): () => void
  /** 按名单顺序读一组设置的每份实例，没值的字段回 default，secret 也回明文。只认自己 defineGroup 过的组，用时现读，名单变化不发事件 */
  getGroup(key: string): SettingGroupInstance[]
  /** 读一项。同步——表在内存里 */
  get(key: string): unknown
  /** 写一项，写进文件 */
  set(key: string, value: unknown): Promise<void>
  /** 抹掉值，定义还在。get 因此回落到 default */
  delete(key: string): Promise<void>
  /** 各分区归哪个包：分区名（条目 id 最后一段）→ 包名。还没被 define 过的分区不列。插件管理的 plugin-manager.transfer-owner 调它 */
  owners(): SettingsOwners
  /** 把一个分区改归 `pkg`，写进文件。`id` 认完整 entryId 也认不带前缀的 id。插件管理的 plugin-manager.transfer-owner 调它 */
  transferOwner(id: string, pkg: string): Promise<void>
}

function argsAsRecord(args: unknown): Record<string, unknown> {
  if (!isRecord(args)) throw new Error('参数要是一个对象：{ section, key }')
  return args
}

/** 命令按位置定位，不看调用方身份：页面不是插件，没有身份可取 */
function slotFromArgs(args: unknown): Slot {
  const raw = argsAsRecord(args)
  const section = raw['section']
  const key = raw['key']
  if (typeof section !== 'string' || section === '') throw new Error('section 要是个非空字符串')
  if (typeof key !== 'string' || key === '') throw new Error('key 要是个非空字符串')
  return { section, key }
}

const ALL_USAGE =
  '参数 { section? }：section 是分区名（插件条目 id 的末段，shared 项是 *），只回这一个分区；不给回全部分区。' +
  '回普通设置 [{ section, key, title?, type?, description?, value?, default?, live }]；凭据用 credentials.list'

const CREDENTIALS_LIST_USAGE =
  '参数 { section? }：只回指定分区；不给回全部分区。回凭据 [{ section, key, title?, type, description?, live, secret:true, isSet, mask? }]，不含值和默认值'

/** 不给参数回全部；给了 section 只回那个分区，分区不存在就报错并列出有哪些 */
export function settingsInSection(rows: readonly SettingView[], args: unknown): SettingView[] {
  return rowsInSection(rows, args, ALL_COMMAND, ALL_USAGE)
}

function rowsInSection(rows: readonly SettingView[], args: unknown, command: string, usage: string): SettingView[] {
  if (args === undefined || args === null) return [...rows]
  if (!isRecord(args)) throw new Error(`${command} 的参数要是对象：${usage}`)
  const unknownKeys = Object.keys(args).filter((key) => key !== 'section')
  if (unknownKeys.length > 0) throw new Error(`${command} 不认识参数 ${unknownKeys.join('、')}：${usage}`)
  const section = args['section']
  if (section === undefined) return [...rows]
  if (typeof section !== 'string' || section === '') throw new Error(`${command} 的 section 要是非空字符串`)
  const inSection = rows.filter((row) => row.section === section)
  if (inSection.length === 0) {
    const sections = [...new Set(rows.map((row) => row.section))]
    throw new Error(`没有分区 ${section}；现有的分区：${sections.join('、')}`)
  }
  return inSection
}

/** 方法里的 `this.ctx` 是调用方的上下文，分区由调用方的条目算出，调用方报不出别人的身份 */
export default class GwbSettings extends Service implements GwbSettingsApi {
  /** 用 TS 的 `private` 不用 `#`：cordis 给每个调用方派生 `Object.create(this)`，`#` 字段在派生对象上一读就抛错 */
  private readonly settingsRegistry: SettingsRegistry
  private readonly settingsFile: string
  private readonly logWarn: (message: string) => void
  private readonly logInfo: (message: string) => void
  private pendingMergedWrite: ReturnType<typeof setTimeout> | undefined
  /** 派生给各调用方的 Service 共用这一条队列，覆盖检查和写入不可交错。 */
  private readonly operations = { tail: Promise.resolve() }

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbSettings')
    // 构造时 this.ctx 还是本插件自己的上下文，logger 记在本插件名下
    this.logWarn = (message: string): void => ctx.logger(PLUGIN_NAME).warn(message)
    this.logInfo = (message: string): void => ctx.logger(PLUGIN_NAME).info(message)
    this.settingsFile = homeFile(requireKernel(ctx).dataDir)
    this.settingsRegistry = createRegistry(this.logWarn)
    // 必须在构造函数里同步读完，见 store.ts 的 readSettings
    const stored = readSettings(this.settingsFile, this.logWarn)
    this.settingsRegistry.load(stored.sections, stored.owners)
  }

  [Service.init](): void {
    // init 里 this.ctx 还是本插件自己的上下文，定时器随本插件卸载取消
    this.ctx.effect(() => () => this.cancelMergedWrite())
    this.registerCommandsWheneverCommandBusIsLoaded()
    this.ctx.logger(PLUGIN_NAME).info(`设置就绪（ctx.gwbSettings），取全部设置调 ${ALL_COMMAND}`)
    this.registerOwnSkillsWheneverSkillsPluginIsLoaded()
  }

  private registerCommandsWheneverCommandBusIsLoaded(): void {
    this.ctx.inject(['gwbCommands'], (contextWithCommands) => {
      const commandBus = contextWithCommands.gwbCommands
      // inject 保证了它在，这句只是把类型收窄
      if (commandBus === undefined) return
      this.registerSettingsCommands(contextWithCommands, commandBus)
    })
  }

  private registerSettingsCommands(contextWithCommands: Context, commandBus: GwbCommands): void {
    contextWithCommands.effect(() =>
      commandBus.register(
        { name: ALL_COMMAND, description: '普通设置项与它们的值，可只取一个分区；凭据用 credentials.list', usage: ALL_USAGE, plugin: PACKAGE_NAME, effect: 'read' },
        (args) => settingsInSection(this.settingsRegistry.all(), args).filter((row) => row.secret !== true),
      ),
    )
    contextWithCommands.effect(() =>
      commandBus.register(
        { name: GET_COMMAND, description: '按位置读普通设置', usage: '参数 { section, key }。回保存值；凭据项拒绝读取，查凭据状态用 credentials.status', plugin: PACKAGE_NAME, effect: 'read' },
        (args) => {
          const slot = slotFromArgs(args)
          this.assertOrdinarySetting(slot)
          return this.settingsRegistry.read(slot)
        },
      ),
    )
    contextWithCommands.effect(() =>
      commandBus.register({ name: SET_COMMAND, description: '按位置写一项普通设置', usage: '参数 { section, key, value }。凭据项拒绝写入，请用 credentials.*', plugin: PACKAGE_NAME, effect: 'write' }, async (args) => {
        const raw = argsAsRecord(args)
        await this.writeValueAt(slotFromArgs(raw), raw['value'], true)
        return { ok: true }
      }),
    )
    contextWithCommands.effect(() =>
      commandBus.register({ name: DELETE_COMMAND, description: '按位置抹掉一项普通设置的值（定义还在）', usage: '参数 { section, key }。凭据项请用 credentials.delete', plugin: PACKAGE_NAME, effect: 'write' }, async (args) => {
        await this.dropValueAt(slotFromArgs(args), 'setting')
        return { ok: true }
      }),
    )
    this.registerCredentialCommands(contextWithCommands, commandBus)
  }

  private registerCredentialCommands(context: Context, commands: GwbCommands): void {
    context.effect(() => commands.register(
      { name: CREDENTIALS_LIST_COMMAND, description: '列出凭据与配置状态，不返回值', usage: CREDENTIALS_LIST_USAGE, plugin: PACKAGE_NAME, effect: 'read' },
      (args) => rowsInSection(this.settingsRegistry.all(), args, CREDENTIALS_LIST_COMMAND, CREDENTIALS_LIST_USAGE).filter((row) => row.secret === true),
    ))
    context.effect(() => commands.register(
      { name: CREDENTIALS_STATUS_COMMAND, description: '查一项凭据是否已配置，不返回值', usage: '参数 { section, key }。回 { section, key, type:"secret", secret:true, isSet, live }；没这一项回 null，普通设置报错。isSet 只代表存有值，不代表服务端认证成功', plugin: PACKAGE_NAME, effect: 'read' },
      (args) => this.credentialStatus(credentialSlot(args)) ?? null,
    ))
    context.effect(() => commands.register(
      { name: CREDENTIALS_SET_COMMAND, description: '本地设置界面保存凭据', usage: '参数 { section, key, value }，value 要是字符串。只给本地页面或受信插件；目标必须是已启用插件声明的凭据，覆盖保存值，只回目标状态', plugin: PACKAGE_NAME, effect: 'write', hiddenFromAgents: true },
      (args, source) => {
        if (source?.via !== 'ui' && source?.via !== 'plugin') throw new Error('凭据输入只供本地页面和受信插件使用；管理凭据请用 credentials.copy/import/generate')
        const raw = argsAsRecord(args)
        const slot = credentialSlot({ section: raw['section'], key: raw['key'] })
        return this.writeCredential(slot, true, () => {
          if (typeof raw['value'] !== 'string') throw new Error('凭据值要是字符串；清除请用 credentials.delete')
          return raw['value']
        })
      },
    ))
    context.effect(() => commands.register(
      { name: CREDENTIALS_DELETE_COMMAND, description: '清除凭据值，保留声明', usage: '参数 { section, key }。只清除本 home 的凭据值，可清除已停用插件留下的凭据，回目标配置状态；服务端撤销由对应插件负责', plugin: PACKAGE_NAME, effect: 'write' },
      async (args) => {
        const slot = credentialSlot(args)
        await this.dropValueAt(slot, 'credential')
        return this.credentialStatus(slot)
      },
    ))
    context.effect(() => commands.register(
      { name: CREDENTIALS_REVEAL_COMMAND, description: '本地设置界面查看凭据', usage: '参数 { section, key }。只给本地页面或受信插件，回保存值；不对 MCP 开放', plugin: PACKAGE_NAME, effect: 'read', hiddenFromAgents: true },
      (args, source) => {
        if (source?.via !== 'ui' && source?.via !== 'plugin') throw new Error('凭据明文只供本地页面和受信插件使用；管理凭据请用 credentials.copy/import/generate')
        const slot = credentialSlot(args)
        this.requireCredential(slot)
        return this.settingsRegistry.read(slot)
      },
    ))
    context.effect(() => commands.register(
      { name: CREDENTIALS_COPY_COMMAND, description: '把指定凭据复制到当前 home 的凭据项，不回显明文', usage: '参数 { from:{ home?, section, key }, to:{ section, key }, overwrite?:false }。from.home 只收当前 home 同级的 home 名，不给读当前 home；只读来源、只写当前 home。两端必须是 secret，目标必须由已启用插件声明；已有值需 overwrite:true。回目标配置状态，复制后两边独立，后续修改不同步', plugin: PACKAGE_NAME, effect: 'write' },
      (raw) => {
        const args = copyArgs(raw)
        return this.writeCredential(args.to, args.overwrite, () => readCopiedCredential(this.settingsFile, args.from, (slot) => this.settingsRegistry.read(slot), (slot) => this.settingsRegistry.status(slot)))
      },
    ))
    context.effect(() => commands.register(
      { name: CREDENTIALS_IMPORT_COMMAND, description: '从指定本机文件导入凭据，不把内容带进回执', usage: '参数 { from:{ file, format:"text"|"json", path?:["字段",…] }, to:{ section, key }, overwrite?:false }。file 是绝对路径、1 MiB 以内；text 去掉一个末尾换行，json 按 path 选非空字符串（空路径选根）。目标必须是当前 home 已启用插件声明的 secret；已有值需 overwrite:true。来源只读；回目标状态、不回值，不代表认证成功', plugin: PACKAGE_NAME, effect: 'write' },
      (raw) => {
        const args = importArgs(raw)
        return this.writeCredential(args.to, args.overwrite, () => readImportedCredential(args.from))
      },
    ))
    context.effect(() => commands.register(
      { name: CREDENTIALS_GENERATE_COMMAND, description: '生成随机凭据并直接保存，不返回值', usage: '参数 { to:{ section, key }, bytes?:32, overwrite?:false }。bytes 是 16—128 的整数，生成 base64url 字符串；目标必须是已启用插件声明的 secret。回目标状态。这里只生成随机值，不签发第三方 token、不赋予有效期；注册、失效、撤销由使用它的服务负责', plugin: PACKAGE_NAME, effect: 'write' },
      (raw) => {
        const args = generateArgs(raw)
        return this.writeCredential(args.to, args.overwrite, () => generateCredential(args.bytes))
      },
    ))
  }

  private registerOwnSkillsWheneverSkillsPluginIsLoaded(): void {
    this.ctx.inject(['gwbSkills'], (contextWithSkills) => {
      contextWithSkills.effect(() => contextWithSkills.gwbSkills.register(OWN_SKILLS_DIR))
    })
  }

  /** `fiber.entry` 是 loader 加上的，不在 cordis 的类型里，按运行时形状取 */
  private callerEntryIdentity(): Owner {
    const fiber = this.ctx.fiber as unknown as { entry?: { id?: unknown; options?: { name?: unknown } } } | undefined
    const entry = fiber?.entry
    const entryId = entry?.id
    const pkg = entry?.options?.name
    if (typeof entryId !== 'string' || entryId === '' || typeof pkg !== 'string' || pkg === '') {
      throw new Error('取不到调用方的身份——ctx.gwbSettings 只能在经 cordis.yml 加载的插件里用')
    }
    return { entryId, pkg }
  }

  private warnWhenEntryIdIsRandom(identity: Owner): void {
    if (!looksRandom(identity.entryId)) return
    this.logWarn(
      `${identity.pkg} 那条条目没在 cordis.yml 里写 id（现在是 ${identity.entryId}）。随机 id 每次启动都变，它的设置重启后就对不上了`,
    )
  }

  define(def: SettingDef): () => void {
    const identity = this.callerEntryIdentity()
    this.warnWhenEntryIdIsRandom(identity)
    const undefine = this.settingsRegistry.define(identity, def)
    this.scheduleMergedWrite()
    // this.ctx 是调用方的上下文，调用方卸载时自动注销
    this.ctx.effect(() => undefine)
    return undefine
  }

  defineGroup(def: SettingGroupDef): () => void {
    const identity = this.callerEntryIdentity()
    this.warnWhenEntryIdIsRandom(identity)
    const undefine = this.settingsRegistry.defineGroup(identity, def)
    this.scheduleMergedWrite()
    this.ctx.effect(() => undefine)
    return undefine
  }

  get(key: string): unknown {
    return this.settingsRegistry.get(this.callerEntryIdentity(), key)
  }

  getGroup(key: string): SettingGroupInstance[] {
    return this.settingsRegistry.getGroup(this.callerEntryIdentity(), key)
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.writeValueAt(this.slotOfOwnDeclaration(key, '写'), value)
  }

  async delete(key: string): Promise<void> {
    await this.dropValueAt(this.slotOfOwnDeclaration(key, '删'))
  }

  owners(): SettingsOwners {
    return { ...this.settingsRegistry.owners() }
  }

  async transferOwner(id: string, pkg: string): Promise<void> {
    const section = entrySection(id)
    this.settingsRegistry.transfer(section, pkg)
    await this.writeSettingsFile()
    this.logInfo(`设置分区 ${section} 改归 ${pkg}`)
  }

  /** 调用方没声明过这一项就抛错 */
  private slotOfOwnDeclaration(key: string, verb: string): Slot {
    const identity = this.callerEntryIdentity()
    const slot = this.settingsRegistry.locate(identity, key)
    if (slot === undefined) {
      throw new Error(`${identity.entryId} 要${verb}一项自己没声明过的设置：${key}。先 define 再动它`)
    }
    return slot
  }

  private assertOrdinarySetting(slot: Slot): void {
    if (this.settingsRegistry.status(slot)?.secret === true) throw new Error('这是凭据项；请用 credentials.*，查状态用 credentials.status')
  }

  private credentialStatus(slot: Slot): SettingStatus | undefined {
    const status = this.settingsRegistry.status(slot)
    if (status !== undefined && !status.secret) throw new Error('这是普通设置；请用 settings.*')
    return status
  }

  private requireCredential(slot: Slot): SettingStatus {
    const status = this.credentialStatus(slot)
    if (status === undefined) throw new Error('凭据项不存在；请用 credentials.list 查可用项')
    return status
  }

  private async writeValueAt(slot: Slot, value: unknown, ordinaryOnly = false): Promise<void> {
    await this.enqueue(async () => {
      if (ordinaryOnly) this.assertOrdinarySetting(slot)
      if (this.settingsRegistry.status(slot)?.secret === true && typeof value !== 'string') throw new Error('凭据值要是字符串；清除请用 delete')
      const previous = this.settingsRegistry.read(slot)
      this.settingsRegistry.put(slot, value)
      await this.persistValueChange(slot, previous)
      this.logInfo(`设置 ${slot.section}.${slot.key} 已写`)
    })
  }

  private async dropValueAt(slot: Slot, kind?: 'setting' | 'credential'): Promise<void> {
    await this.enqueue(async () => {
      if (kind === 'setting') this.assertOrdinarySetting(slot)
      if (kind === 'credential') this.requireCredential(slot)
      const previous = this.settingsRegistry.read(slot)
      this.settingsRegistry.drop(slot)
      await this.persistValueChange(slot, previous)
      this.logInfo(`设置 ${slot.section}.${slot.key} 已删`)
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.tail.then(operation)
    this.operations.tail = result.then(() => {}, () => {})
    return result
  }

  private writeCredential(slot: Slot, overwrite: boolean, read: () => string): Promise<SettingStatus> {
    return this.enqueue(async () => {
      assertWritableCredential(this.settingsRegistry.status(slot), overwrite)
      const previous = this.settingsRegistry.read(slot)
      this.settingsRegistry.put(slot, read())
      await this.persistValueChange(slot, previous)
      this.logInfo(`凭据 ${slot.section}.${slot.key} 已写`)
      return this.settingsRegistry.status(slot)!
    })
  }

  private async persistValueChange(slot: Slot, previous: unknown): Promise<void> {
    try {
      await this.writeSettingsFile()
    } catch (error) {
      // 凭据可能已落盘而元信息写失败，按磁盘事实恢复此项，不让内存假装成功。
      let persisted: unknown = previous
      try { persisted = readSettings(this.settingsFile, this.logWarn).sections[slot.section]?.[slot.key]?.value } catch { /* 原始存储错误由下面交回 */ }
      if (persisted === undefined) this.settingsRegistry.drop(slot)
      else this.settingsRegistry.put(slot, persisted)
      throw error
    }
  }

  /** 日志里永远不写 value：gwb.log 在磁盘上，凭据写进去就删不掉。写失败先 warn 再抛，调用方吞掉异常也留得下记录 */
  private async writeSettingsFile(): Promise<void> {
    // 每次都写整张表，已经排着的那次合并写入写的内容这次都有了
    this.cancelMergedWrite()
    try {
      await writeSettings(this.settingsFile, { sections: this.settingsRegistry.file(), owners: this.settingsRegistry.owners() })
    } catch (writeError: unknown) {
      this.logWarn(`设置写入文件失败：${String(writeError)}`)
      throw writeError
    }
  }

  /** 同一轮里的多次 define 合并成一次写文件 */
  private scheduleMergedWrite(): void {
    if (this.pendingMergedWrite !== undefined) return
    this.pendingMergedWrite = setTimeout(() => {
      this.pendingMergedWrite = undefined
      // 失败时 writeSettingsFile 已经写过 warn，这里只接住，不让它成为没人处理的 rejection
      void this.enqueue(() => this.writeSettingsFile()).catch(() => undefined)
    }, 0)
  }

  private cancelMergedWrite(): void {
    if (this.pendingMergedWrite === undefined) return
    clearTimeout(this.pendingMergedWrite)
    this.pendingMergedWrite = undefined
  }
}

declare module 'cordis' {
  interface Context {
    gwbSettings: GwbSettingsApi
  }
}

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
  type SettingsOwners,
  type SettingsRegistry,
  type Slot,
} from './registry.js'
import { readSettings, writeSettings } from './store.js'

export type {
  SettingDef,
  SettingType,
  SettingView,
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

/** 调用方拿到的接口。写 `inject: ['gwbSettings']` 才有 */
export interface GwbSettingsApi {
  /** 声明一项。回注销函数（插件卸载时自动注销，不用自己包 ctx.effect） */
  define(def: SettingDef): () => void
  /** 读一项。同步——表在内存里 */
  get(key: string): unknown
  /** 写一项，写进文件 */
  set(key: string, value: unknown): Promise<void>
  /** 抹掉值，定义还在。get 因此回落到 default */
  delete(key: string): Promise<void>
  /** 各分区归哪个包：分区名（条目 id 最后一段）→ 包名。还没被 define 过的分区不列。插件管理 0.14 起不再调用，留待本插件下次本来就要升 x 时删 */
  owners(): SettingsOwners
  /** 把一个分区改归 `pkg`，写进文件。`id` 认完整 entryId 也认不带前缀的 id。插件管理 0.14 起不再调用，留待本插件下次本来就要升 x 时删 */
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

/** 方法里的 `this.ctx` 是调用方的上下文，分区由调用方的条目算出，调用方报不出别人的身份 */
export default class GwbSettings extends Service implements GwbSettingsApi {
  /** 用 TS 的 `private` 不用 `#`：cordis 给每个调用方派生 `Object.create(this)`，`#` 字段在派生对象上一读就抛错 */
  private readonly settingsRegistry: SettingsRegistry
  private readonly settingsFile: string
  private readonly logWarn: (message: string) => void
  private readonly logInfo: (message: string) => void
  private pendingMergedWrite: ReturnType<typeof setTimeout> | undefined

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
        { name: ALL_COMMAND, description: '此刻所有设置项与它们的值（secret 项不回值，只回是否已设置）', usage: '无参数', plugin: PACKAGE_NAME },
        () => this.settingsRegistry.all(),
      ),
    )
    contextWithCommands.effect(() =>
      commandBus.register({ name: GET_COMMAND, description: '按位置读一项设置（secret 项也回明文）', usage: '参数 { section, key }', plugin: PACKAGE_NAME }, (args) =>
        this.settingsRegistry.read(slotFromArgs(args)),
      ),
    )
    contextWithCommands.effect(() =>
      commandBus.register({ name: SET_COMMAND, description: '按位置写一项设置', usage: '参数 { section, key, value }', plugin: PACKAGE_NAME }, async (args) => {
        const raw = argsAsRecord(args)
        await this.writeValueAt(slotFromArgs(raw), raw['value'])
        return { ok: true }
      }),
    )
    contextWithCommands.effect(() =>
      commandBus.register({ name: DELETE_COMMAND, description: '按位置抹掉一项设置的值（定义还在）', usage: '参数 { section, key }', plugin: PACKAGE_NAME }, async (args) => {
        await this.dropValueAt(slotFromArgs(args))
        return { ok: true }
      }),
    )
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

  get(key: string): unknown {
    return this.settingsRegistry.get(this.callerEntryIdentity(), key)
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

  private async writeValueAt(slot: Slot, value: unknown): Promise<void> {
    this.settingsRegistry.put(slot, value)
    await this.writeSettingsFile()
    this.logInfo(`设置 ${slot.section}.${slot.key} 已写`)
  }

  private async dropValueAt(slot: Slot): Promise<void> {
    this.settingsRegistry.drop(slot)
    await this.writeSettingsFile()
    this.logInfo(`设置 ${slot.section}.${slot.key} 已删`)
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
      void this.writeSettingsFile().catch(() => undefined)
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

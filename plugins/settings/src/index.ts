import { Service } from 'cordis'
import type { GwbContext } from '@godcreator/gwb-plugin-api'
import { isRecord, requireKernel } from './vocab.js'
// 只为激活 commands 插件的 `declare module 'cordis'`——它给 ctx 加上 gwbCommands 这个名字
import type {} from '@godcreator/gwb-commands'
// 只为激活 skills 插件的 `declare module 'cordis'`——下面局部注入要用 gwbSkills 这个名字
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

/**
 * 设置：插件声明自己有哪些设置项，值存在 `<home>/settings.json` 一个文件里，跟 cordis.yml
 * 在同一目录。**全部配置都在 home 里，没有机器级**——跨 home 想共享就复制文件。
 *
 * `ctx.gwbSettings` 这个服务**自动绑定到调用它的那个插件**——插件不报名字，也就没法
 * 报别人的名字去改别人的设置。靠的是 cordis `Service` 的机制：方法里的 `this.ctx` 是
 * **调用方**的 ctx（`gwb-data` 的 `owner()` 是同一个做法）。
 * 每个分区第一次被 define 时记下所属包名，之后包名对不上的一律拒绝，见 `paths.ts` 的 `OWNERS_KEY`。
 */

const NAME = 'gwb-settings'
/** 登记命令时的归属：包名——agent 侧的操作键认它，不认短名 */
const PKG = '@godcreator/gwb-settings'

/** 四条命令。登记与调用两处都用这几个常量 */
export const ALL_COMMAND = 'settings.all'
export const GET_COMMAND = 'settings.get'
export const SET_COMMAND = 'settings.set'
export const DELETE_COMMAND = 'settings.delete'

/** 使用方拿到的服务接口。写 `inject: ['gwbSettings']` 才有 */
export interface GwbSettingsApi {
  /** 声明一项。回注销函数（插件卸载时自动注销，不用自己包 ctx.effect） */
  define(def: SettingDef): () => void
  /** 读一项。同步——表在内存里 */
  get(key: string): unknown
  /** 写一项，写盘 */
  set(key: string, value: unknown): Promise<void>
  /** 抹掉值，定义还在。get 因此回落到 default */
  delete(key: string): Promise<void>
  /** 各分区归哪个包：分区名（条目 id 最后一段）→ 包名。还没被 define 过的分区不列 */
  owners(): SettingsOwners
  /** 把一个分区改归 `pkg`，写盘。`id` 认完整 entryId 也认不带前缀的 id。包改了名、要接着用旧设置时用它 */
  transferOwner(id: string, pkg: string): Promise<void>
}

export default class GwbSettings extends Service implements GwbSettingsApi {
  /**
   * 注册表本体。**用 TS 的 `private` 不用 `#`**：cordis 给每个消费者派生一份
   * `Object.create(this)`，而 `#` 私有字段的内部槽不在原型链上，派生对象上一读就抛错。
   */
  private readonly registry: SettingsRegistry
  private readonly file: string
  private readonly warn: (message: string) => void
  private readonly info: (message: string) => void
  private writeTask: ReturnType<typeof setTimeout> | undefined

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbSettings')
    // 构造时 this.ctx 还是**提供方**自己的，logger 绑的是本插件
    this.warn = (message: string): void => ctx.logger(NAME).warn(message)
    this.info = (message: string): void => ctx.logger(NAME).info(message)
    const dataDir = requireKernel(ctx).dataDir
    this.file = homeFile(dataDir)
    this.registry = createRegistry(this.warn)
    // 读盘必须在构造函数里同步做完，理由见 store.ts 的 readSettings
    const stored = readSettings(this.file, this.warn)
    this.registry.load(stored.sections, stored.owners)
  }

  [Service.init](): void {
    // 定时器是本插件自己的资源。init 里 this.ctx 还是提供方的，effect 登记在自己身上
    this.ctx.effect(() => () => this.cancelWrite())
    // 命令是**可选**的：没有命令总线时服务照样完整，只是界面调不到——这一点跟
    // gwb-shell 不同，它没有命令总线就什么窗格都开不出来。
    // 嵌套注入：命令总线在才登记，它停用就自动注销，后加载的也接得上
    this.ctx.inject(['gwbCommands'], (ctx) => {
      const cli = ctx.gwbCommands
      // inject 保证了它在，这句只是把类型收窄
      if (cli === undefined) return
      ctx.effect(() =>
        cli.register(
          { name: ALL_COMMAND, description: '此刻所有设置项与它们的值（secret 项不回值，只回是否已设置）', usage: '无参数', plugin: PKG },
          () => this.registry.all(),
        ),
      )
      // 读设置有两条命令，判断不同：`settings.all` 是**全部列出**（一调就把整个 home 的设置列出来），
      // secret 项的明文在那里去掉；这一条是**按位置读**（调用方先知道 section/key），照旧回明文——
      // 插件按位置读别的分区里的凭据是现有用法（plugin-sources 读 gitea 分区的 token
      // 就用这条），两条都去掉明文只会挡住正当的读取，而拦不住真想拿的人
      ctx.effect(() =>
        cli.register({ name: GET_COMMAND, description: '按位置读一项设置（secret 项也回明文）', usage: '参数 { section, key }', plugin: PKG }, (args) =>
          this.registry.read(toSlot(args)),
        ),
      )
      ctx.effect(() =>
        cli.register({ name: SET_COMMAND, description: '按位置写一项设置', usage: '参数 { section, key, value }', plugin: PKG }, async (args) => {
          const raw = asRecord(args)
          await this.putAt(toSlot(raw), raw['value'])
          return { ok: true }
        }),
      )
      // 删值跟写值一样按位置：删条目的界面要能顺手把那个插件的设置值删干净，
      // 不删的话磁盘上留下一堆没有归属的值
      ctx.effect(() =>
        cli.register({ name: DELETE_COMMAND, description: '按位置抹掉一项设置的值（定义还在）', usage: '参数 { section, key }', plugin: PKG }, async (args) => {
          const slot = toSlot(args)
          this.registry.drop(slot)
          await this.flush()
          this.info(`设置 ${slot.section}.${slot.key} 已删`)
          return { ok: true }
        }),
      )
    })
    this.ctx.logger(NAME).info(`设置就绪（ctx.gwbSettings），取表走 ${ALL_COMMAND}`)
    // 说明书**局部注入**：没装 skills 插件的 home 里设置插件照常加载。
    // 构建产物在 dist/ 下，包根的 skills/ 是 '../skills/'；那个目录要写进 package.json 的 files
    this.ctx.inject(['gwbSkills'], (scoped) => {
      scoped.effect(() => scoped.gwbSkills.register(new URL('../skills/', import.meta.url)))
    })
  }

  /**
   * 调用方是哪个插件。`fiber.entry` 是 loader 加上的（不是 cordis 本身的接口），
   * 所以按运行时形状取、不动全局类型声明
   */
  private owner(): Owner {
    const fiber = this.ctx.fiber as unknown as { entry?: { id?: unknown; options?: { name?: unknown } } } | undefined
    const entry = fiber?.entry
    const entryId = entry?.id
    const pkg = entry?.options?.name
    if (typeof entryId !== 'string' || entryId === '' || typeof pkg !== 'string' || pkg === '') {
      throw new Error('取不到调用方的身份——ctx.gwbSettings 只能在经 cordis.yml 挂上的件里用')
    }
    return { entryId, pkg }
  }

  define(def: SettingDef): () => void {
    const owner = this.owner()
    // 不抛错（那条条目本来能正常运行），也不省略日志（对不上是最难查的那种问题）
    if (looksRandom(owner.entryId)) {
      this.warn(
        `${owner.pkg} 那条条目没在 cordis.yml 里写 id（现在是 ${owner.entryId}）。随机 id 每次启动都变，它的设置重启后就对不上了`,
      )
    }
    const off = this.registry.define(owner, def)
    this.scheduleWrite()
    // 登记到**调用方**的 effect 上（方法里的 this.ctx 是调用方的），插件卸载时自动注销
    this.ctx.effect(() => off)
    return off
  }

  get(key: string): unknown {
    return this.registry.get(this.owner(), key)
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.putAt(this.locateOwn(key, '写'), value)
  }

  async delete(key: string): Promise<void> {
    const slot = this.locateOwn(key, '删')
    this.registry.drop(slot)
    await this.flush()
    this.info(`设置 ${slot.section}.${slot.key} 已删`)
  }

  owners(): SettingsOwners {
    return { ...this.registry.owners() }
  }

  async transferOwner(id: string, pkg: string): Promise<void> {
    const section = entrySection(id)
    this.registry.transfer(section, pkg)
    await this.flush()
    this.info(`设置分区 ${section} 过户给 ${pkg}`)
  }

  /** 调用方声明过这个 key 才能改它。没声明就抛错——把一项谁也不认识的值写进磁盘，出错没人发现 */
  private locateOwn(key: string, verb: string): Slot {
    const owner = this.owner()
    const slot = this.registry.locate(owner, key)
    if (slot === undefined) {
      throw new Error(`${owner.entryId} 要${verb}一项自己没声明过的设置：${key}。先 define 再动它`)
    }
    return slot
  }

  private async putAt(slot: Slot, value: unknown): Promise<void> {
    this.registry.put(slot, value)
    await this.flush()
    this.info(`设置 ${slot.section}.${slot.key} 已写`)
  }

  /**
   * 写盘。**日志里永远不写 value**——gwb.log 在磁盘上，凭据写进去就删不掉。
   * 写失败要记 warn：只把异常抛给调用方的话，调用方一 catch，「没存上」就没人知道了
   */
  private async flush(): Promise<void> {
    try {
      await writeSettings(this.file, { sections: this.registry.file(), owners: this.registry.owners() })
    } catch (err: unknown) {
      this.warn(`设置落盘失败：${String(err)}`)
      throw err
    }
  }

  /** 元信息写盘要合并：每个插件加载时都写一次的话，一次启动要写 N 遍 */
  private scheduleWrite(): void {
    if (this.writeTask !== undefined) return
    this.writeTask = setTimeout(() => {
      this.writeTask = undefined
      // 失败时 flush 已经记过 warn，这里只 catch 住，不让它成为没人处理的 rejection
      void this.flush().catch(() => undefined)
    }, 0)
  }

  private cancelWrite(): void {
    if (this.writeTask === undefined) return
    clearTimeout(this.writeTask)
    this.writeTask = undefined
  }
}

function asRecord(args: unknown): Record<string, unknown> {
  if (!isRecord(args)) throw new Error('参数要是一个对象：{ section, key }')
  return args
}

/** 命令按位置定位，不看调用方身份——界面不是插件，没有身份可取 */
function toSlot(args: unknown): Slot {
  const raw = asRecord(args)
  const section = raw['section']
  const key = raw['key']
  if (typeof section !== 'string' || section === '') throw new Error('section 要是个非空字符串')
  if (typeof key !== 'string' || key === '') throw new Error('key 要是个非空字符串')
  return { section, key }
}

declare module 'cordis' {
  interface Context {
    gwbSettings: GwbSettingsApi
  }
}

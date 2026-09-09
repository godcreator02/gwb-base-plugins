import { Service } from 'cordis'
import { isRecord, requireKernel, type GwbContext } from '@godcreator02/gwb-plugin-api'
// 只为激活 commands 件的 `declare module 'cordis'`——它给 ctx 加上 gwbCommands 这个名字
import type {} from '@godcreator02/gwb-commands'
// 只为激活 skills 件的 `declare module 'cordis'`——下面局部注入要用 gwbSkills 这个名字
import type {} from '@godcreator02/gwb-skills'
import { homeFile, looksRandom } from './paths.js'
import {
  createRegistry,
  type Owner,
  type SettingDef,
  type SettingsRegistry,
  type Slot,
} from './registry.js'
import { readSettings, writeSettings } from './store.js'

export type {
  SettingDef,
  SettingType,
  SettingView,
  SettingsFile,
  Slot,
  StoredSetting,
} from './registry.js'
export { SHARED_SECTION } from './paths.js'

/**
 * 设置：件声明自己有哪些设置项，值落在 `<home>/settings.json` 一份文件里，跟 cordis.yml
 * 并排。**home 自持全部配置，没有机器级**——跨 home 想共享就复制文件。
 *
 * `ctx.gwbSettings` 交出来的那一格**自动绑定到取它的那个件**——件不报名字，也就没法
 * 报别人的名字去改别人的设置。靠的是 cordis `Service` 的机制：方法里的 `this.ctx` 是
 * **消费者**的 ctx（`gwb-data` 的 `owner()` 是同一个套路）。
 */

const NAME = 'gwb-settings'

/** 三条命令。注册与调用两处同吃这几个常量 */
export const ALL_COMMAND = 'settings.all'
export const GET_COMMAND = 'settings.get'
export const SET_COMMAND = 'settings.set'
export const DELETE_COMMAND = 'settings.delete'

/** 消费方拿到的那一格。写 `inject: ['gwbSettings']` 才有 */
export interface GwbSettingsApi {
  /** 声明一项。回注销函数（件卸载时自动摘，不用自己包 ctx.effect） */
  define(def: SettingDef): () => void
  /** 读一项。同步——表在内存里 */
  get(key: string): unknown
  /** 写一项，落盘 */
  set(key: string, value: unknown): Promise<void>
  /** 抹掉值，定义还在。get 因此回落到 default */
  delete(key: string): Promise<void>
}

export default class GwbSettings extends Service implements GwbSettingsApi {
  /**
   * 注册表本体。**用 TS 的 `private` 不用 `#`**：cordis 给每个消费者派生一份
   * `Object.create(this)`，而 `#` 私有字段的内部槽不在原型链上，派生对象上一读就炸。
   */
  private readonly registry: SettingsRegistry
  private readonly file: string
  private readonly warn: (message: string) => void
  private readonly info: (message: string) => void
  private writeTask: ReturnType<typeof setTimeout> | undefined

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbSettings')
    // 构造时 this.ctx 还是**提供方**自己的，logger 绑的是本件
    this.warn = (message: string): void => ctx.logger(NAME).warn(message)
    this.info = (message: string): void => ctx.logger(NAME).info(message)
    const dataDir = requireKernel(ctx).dataDir
    this.file = homeFile(dataDir)
    this.registry = createRegistry(this.warn)
    // 读盘必须在构造函数里同步做完，理由见 store.ts 的 readSettings
    this.registry.load(readSettings(this.file, this.warn))
  }

  [Service.init](): void {
    // 定时器是本件自己的资源。init 里 this.ctx 还是提供方的，effect 挂在自己身上
    this.ctx.effect(() => () => this.cancelWrite())
    // 命令是**可选**的：没有命令总线时服务面照样完整，只是界面调不到——这一条跟
    // gwb-shell 判得不一样，它没有 cli 就是个开不出任何东西的空井。
    // 嵌套注入：cli 在才挂，走了自动摘，后来才挂也接得上
    this.ctx.inject(['gwbCommands'], (ctx) => {
      const cli = ctx.gwbCommands
      // inject 保证了它在，这句只是把类型收窄
      if (cli === undefined) return
      ctx.effect(() =>
        cli.register({ name: ALL_COMMAND, description: '此刻所有设置项与它们的值。无参数', plugin: NAME }, () =>
          this.registry.all(),
        ),
      )
      ctx.effect(() =>
        cli.register({ name: GET_COMMAND, description: '按位置读一项设置。参数 { section, key }', plugin: NAME }, (args) =>
          this.registry.read(toSlot(args)),
        ),
      )
      ctx.effect(() =>
        cli.register(
          {
            name: SET_COMMAND,
            description:
              '按位置写一项设置。参数 { section, key, value }；定义是 list 的项，value 给字符串（逗号或空白分隔）或数组',
            plugin: NAME,
          },
          async (args) => {
            const raw = asRecord(args)
            await this.putAt(toSlot(raw), raw['value'])
            return { ok: true }
          },
        ),
      )
      // 抹值跟写值走同一条「按位置」的路：删条目的界面要能顺手把那件的设置值擦干净，
      // 不擦的话盘上留下一堆无主的值
      ctx.effect(() =>
        cli.register({ name: DELETE_COMMAND, description: '按位置抹掉一项设置的值（定义还在）。参数 { section, key }', plugin: NAME }, async (args) => {
          const slot = toSlot(args)
          this.registry.drop(slot)
          await this.flush()
          this.info(`设置 ${slot.section}.${slot.key} 已删`)
          return { ok: true }
        }),
      )
    })
    this.ctx.logger(NAME).info(`设置就绪（ctx.gwbSettings），取表走 ${ALL_COMMAND}`)
    // 说明书那一格,**局部注入**:没装 skills 件的 home 里设置件照常挂。
    // 产物在 dist/ 下,包根的 skills/ 是 '../skills/';那个目录得进 package.json 的 files
    this.ctx.inject(['gwbSkills'], (scoped) => {
      scoped.effect(() => scoped.gwbSkills.register(new URL('../skills/', import.meta.url)))
    })
  }

  /**
   * 取它的是哪个件。`fiber.entry` 是 loader 挂上的（不是 cordis 本体的面），
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
    // 不抛错（那条件本来能跑），也不静默（对不上是最难查的那种）
    if (looksRandom(owner.entryId)) {
      this.warn(
        `${owner.pkg} 那条条目没在 cordis.yml 里写 id（现在是 ${owner.entryId}）。随机 id 每次启动都变，它的设置重启后就对不上了`,
      )
    }
    const off = this.registry.define(owner, def)
    this.scheduleWrite()
    // 挂在**调用方**的 effect 上（this.ctx 在方法里是消费者的），件卸载时自动摘
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

  /** 本件声明过这个 key 才动得了它。没声明就抛——写一项谁也不认识的东西进盘是静默事故 */
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
   * 落盘。**日志里永远不打 value**——gwb-kernel.log 是落盘的，凭据进去就拿不出来。
   * 写没写成得出声：直写路径过去把异常裸抛给调用方，调用方一吞，「没存上」就无声了
   */
  private async flush(): Promise<void> {
    const mine = this.registry.file()
    try {
      await writeSettings(this.file, mine)
    } catch (err: unknown) {
      this.warn(`设置落盘失败：${String(err)}`)
      throw err
    }
  }

  /** 元信息落盘要合批：每个件挂上都写一次的话，一次启动要写 N 遍 */
  private scheduleWrite(): void {
    if (this.writeTask !== undefined) return
    this.writeTask = setTimeout(() => {
      this.writeTask = undefined
      // 失败 flush 自己 warn 过了，这儿只兜住不让它成为没人接的 rejection
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

/** 命令按位置定位，不经身份——界面不是一个件，没有身份可绑 */
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

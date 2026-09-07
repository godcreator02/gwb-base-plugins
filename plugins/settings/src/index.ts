import { Service } from 'cordis'
import { isRecord, requireKernel, type GwbContext } from '@godcreator02/gwb-plugin-api'
// 只为激活 cli 件的 `declare module 'cordis'`——它给 ctx 加上 gwbCli 这个名字
import type {} from '@godcreator02/gwb-cli'
import { homeFile, looksRandom, machineFile } from './paths.js'
import {
  createRegistry,
  mergeFiles,
  type Owner,
  type SettingDef,
  type SettingScope,
  type SettingsRegistry,
  type Slot,
} from './registry.js'
import { readSettings, writeSettings } from './store.js'

export type {
  SettingDef,
  SettingScope,
  SettingType,
  SettingView,
  SettingsFile,
  Slot,
  StoredSetting,
} from './registry.js'
export { SHARED_SECTION } from './paths.js'

/**
 * 设置：件声明自己有哪些设置项，值落在两份 JSON 里——`<home>/settings.json` 跟着这个
 * home 走，`<userData>/machine.json` 全机一份。
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
  private readonly files: Record<SettingScope, string>
  private readonly warn: (message: string) => void
  private writeTask: ReturnType<typeof setTimeout> | undefined
  private readonly pending = new Set<SettingScope>()

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbSettings')
    // 构造时 this.ctx 还是**提供方**自己的，logger 绑的是本件
    this.warn = (message: string): void => ctx.logger(NAME).warn(message)
    const dataDir = requireKernel(ctx).dataDir
    this.files = { home: homeFile(dataDir), machine: machineFile(dataDir) }
    this.registry = createRegistry(this.warn)
    // 读盘必须在构造函数里同步做完，理由见 store.ts 的 readSettings
    this.registry.load(readSettings(this.files.home, this.warn), readSettings(this.files.machine, this.warn))
  }

  [Service.init](): void {
    // 定时器是本件自己的资源。init 里 this.ctx 还是提供方的，effect 挂在自己身上
    this.ctx.effect(() => () => this.cancelWrite())
    // 命令是**可选**的：没有命令总线时服务面照样完整，只是界面调不到——这一条跟
    // gwb-shell 判得不一样，它没有 cli 就是个开不出任何东西的空井。
    // 嵌套注入：cli 在才挂，走了自动摘，后来才挂也接得上
    this.ctx.inject(['gwbCli'], (ctx) => {
      const cli = ctx.gwbCli
      // inject 保证了它在，这句只是把类型收窄
      if (cli === undefined) return
      ctx.effect(() =>
        cli.register({ name: ALL_COMMAND, description: '此刻所有设置项与它们的值', plugin: NAME }, () =>
          this.registry.all(),
        ),
      )
      ctx.effect(() =>
        cli.register({ name: GET_COMMAND, description: '按位置读一项设置', plugin: NAME }, (args) =>
          this.registry.read(toSlot(args)),
        ),
      )
      ctx.effect(() =>
        cli.register({ name: SET_COMMAND, description: '按位置写一项设置', plugin: NAME }, async (args) => {
          const raw = asRecord(args)
          await this.putAt(toSlot(raw), raw['value'])
          return { ok: true }
        }),
      )
    })
    this.ctx.logger(NAME).info(`设置就绪（ctx.gwbSettings），取表走 ${ALL_COMMAND}`)
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
    this.scheduleWrite(def.scope ?? 'home')
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
    await this.flush(slot.scope)
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
    await this.flush(slot.scope)
  }

  /** 落一份盘。**日志里永远不打 value**——gwb-kernel.log 是落盘的，凭据进去就拿不出来 */
  private async flush(scope: SettingScope): Promise<void> {
    const mine = this.registry.file(scope)
    if (scope === 'home') {
      await writeSettings(this.files.home, mine)
      return
    }
    // machine.json 跨 home 共享，可能有另一个实例也在写。原子 rename 保证不写坏，
    // 但会**丢更新**（A 读→B 读→A 写→B 写）。写前重读合并，把窗口缩到毫秒级
    const disk = readSettings(this.files.machine, this.warn)
    await writeSettings(this.files.machine, mergeFiles(disk, mine))
  }

  /** 元信息落盘要合批：每个件挂上都写一次的话，一次启动要写 N 遍 */
  private scheduleWrite(scope: SettingScope): void {
    this.pending.add(scope)
    if (this.writeTask !== undefined) return
    this.writeTask = setTimeout(() => {
      this.writeTask = undefined
      const scopes = [...this.pending]
      this.pending.clear()
      void Promise.all(scopes.map((scope2) => this.flush(scope2))).catch((err: unknown) => {
        this.warn(`元信息落盘失败：${String(err)}`)
      })
    }, 0)
  }

  private cancelWrite(): void {
    if (this.writeTask === undefined) return
    clearTimeout(this.writeTask)
    this.writeTask = undefined
  }
}

function asRecord(args: unknown): Record<string, unknown> {
  if (!isRecord(args)) throw new Error('参数要是一个对象：{ scope, section, key }')
  return args
}

/** 命令按位置定位，不经身份——界面不是一个件，没有身份可绑 */
function toSlot(args: unknown): Slot {
  const raw = asRecord(args)
  const scope = raw['scope']
  const section = raw['section']
  const key = raw['key']
  if (scope !== 'home' && scope !== 'machine') {
    throw new Error(`scope 只能是 home 或 machine，收到 ${JSON.stringify(scope)}`)
  }
  if (typeof section !== 'string' || section === '') throw new Error('section 要是个非空字符串')
  if (typeof key !== 'string' || key === '') throw new Error('key 要是个非空字符串')
  return { scope, section, key }
}

declare module 'cordis' {
  interface Context {
    gwbSettings: GwbSettingsApi
  }
}

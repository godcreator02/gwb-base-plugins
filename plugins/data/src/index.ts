import { Service } from 'cordis'
import { requireKernel, type GwbContext } from '@godcreator/gwb-plugin-api'
import { claimDir, listOwners, stampOwner } from './owner.js'
import { dataRoot, entryDir, looksRandom } from './paths.js'
import { readDoc, writeDoc } from './store.js'

/**
 * 件的数据落盘。`ctx.gwbData` 交出来的那一格**自动绑定到取它的那个件**——
 * 件不报名字，也就没法报别人的名字去读别人的数据。
 *
 * 靠的是 cordis `Service` 的机制：方法里的 `this.ctx` 是**消费者**的 ctx，
 * 它的 `fiber.entry.id` 就是那个件在 `cordis.yml` 里那条条目的 id。
 * **数据按条目 id 归属，不按包名**——同一个包可以挂好几条条目，各是各的实例。
 * 每个目录第一次被访问时盖上户主章（包名），之后包名对不上的一律拒，见 `owner.ts`。
 */

const NAME = 'gwb-data'

/** 一条条目的身份。`entryId` 定数据落哪，`pkg` 只用来把话说清楚 */
interface Owner {
  entryId: string
  pkg: string
}

/** 消费方拿到的那一格。写 `inject: ['gwbData']` 才有 */
export interface GwbDataApi {
  /** 本件的数据目录。存非 JSON（图片、日志）时用它，不必自己拼路径 */
  readonly dir: string
  /** 读一份文档。没有 / 坏了一律回 undefined */
  readDoc(doc: string): Promise<unknown>
  /** 整份替换，原子落盘 */
  writeDoc(doc: string, value: unknown): Promise<void>
  /** 各数据目录的户主：目录名（条目 id 末段）→ 包名。还没盖章的目录不列 */
  owners(): Promise<Record<string, string>>
  /** 把一个数据目录过户给 `pkg`。`id` 认完整 entryId 也认裸 id。包改了名、要接着用旧数据时走它 */
  transferOwner(id: string, pkg: string): Promise<void>
}

export default class GwbData extends Service implements GwbDataApi {
  /** home 目录。构造时从**提供方**的 ctx 取——那时 this.ctx 还是自己 */
  private readonly home: string
  /**
   * 日志出口与「已经说过一次」的名单。
   *
   * **用 TS 的 `private` 不用 `#`**：cordis 给每个消费者派生一份 `Object.create(this)`，
   * 而 `#` 私有字段的内部槽不在原型链上，派生对象上一读就炸。
   */
  private readonly warn: (message: string) => void
  private readonly warned = new Set<string>()
  /** 核过章的目录 → 包名。每次读写都去盘上读章太费，核过一次就记下 */
  private readonly claimed = new Map<string, string>()

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbData')
    this.home = requireKernel(ctx).dataDir
    // 构造时 this.ctx 还是**提供方**自己的，logger 绑的是本件
    this.warn = (message: string): void => ctx.logger(NAME).warn(message)
  }

  /**
   * 取它的是哪个件。`fiber.entry` 是 loader 挂上的（不是 cordis 本体的面），
   * 所以这儿按运行时形状取、不动全局类型声明
   */
  private owner(): Owner {
    const fiber = this.ctx.fiber as unknown as { entry?: { id?: unknown; options?: { name?: unknown } } } | undefined
    const entry = fiber?.entry
    const entryId = entry?.id
    const pkg = entry?.options?.name
    if (typeof entryId !== 'string' || entryId === '' || typeof pkg !== 'string' || pkg === '') {
      throw new Error('取不到调用方的身份——ctx.gwbData 只能在经 cordis.yml 挂上的件里用')
    }
    return { entryId, pkg }
  }

  get dir(): string {
    return this.claim(this.owner())
  }

  async readDoc(doc: string): Promise<unknown> {
    return readDoc(this.dir, doc, (message) => this.ctx.logger.warn(message))
  }

  async writeDoc(doc: string, value: unknown): Promise<void> {
    const owner = this.owner()
    const dir = this.claim(owner)
    try {
      await writeDoc(dir, doc, value)
    } catch (err: unknown) {
      // 落盘失败过去只是把异常原样抛给调用方——很多调用方一吞，数据丢了都没声没响
      this.ctx.logger(NAME).error(`写 ${owner.entryId}/${doc} 失败：${String(err)}`)
      throw err
    }
  }

  async owners(): Promise<Record<string, string>> {
    return listOwners(dataRoot(this.home), this.warn)
  }

  async transferOwner(id: string, pkg: string): Promise<void> {
    if (typeof pkg !== 'string' || pkg === '') throw new Error('过户要给一个非空的包名')
    const dir = entryDir(this.home, id)
    stampOwner(dir, pkg)
    this.claimed.set(dir, pkg)
    this.ctx.logger(NAME).info(`数据目录 ${dir} 过户给 ${pkg}`)
  }

  /** 算出这条条目的目录并核章：没章盖上，别人的章抛。回目录 */
  private claim(owner: Owner): string {
    this.warnOnRandomId(owner)
    const dir = entryDir(this.home, owner.entryId)
    if (this.claimed.get(dir) === owner.pkg) return dir
    claimDir(dir, owner.pkg)
    this.claimed.set(dir, owner.pkg)
    return dir
  }

  /**
   * 没手写 id 的条目，loader 每次启动发一个新的随机 id，数据目录跟着换一个。
   * 不抛错（那条件本来能跑），也不静默（对不上是最难查的那种）。
   * 一条条目只说一次——`dir` 每读写一次就算一遍。
   */
  private warnOnRandomId(owner: Owner): void {
    if (!looksRandom(owner.entryId) || this.warned.has(owner.entryId)) return
    this.warned.add(owner.entryId)
    this.warn(
      `${owner.pkg} 那条条目没在 cordis.yml 里写 id（现在是 ${owner.entryId}）。随机 id 每次启动都变，它的数据每次启动都会新建一份`,
    )
  }
}

declare module 'cordis' {
  interface Context {
    gwbData: GwbDataApi
  }
}

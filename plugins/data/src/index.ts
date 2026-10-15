import { Service } from 'cordis'
import type { GwbContext } from '@godcreator/gwb-kernel-desktop'
import { requireKernel } from './vocab.js'
import { claimDir, listOwners, stampOwner } from './owner.js'
import { dataRoot, entryDir, looksRandom } from './paths.js'
import { readDoc, writeDoc } from './store.js'

const PLUGIN_NAME = 'gwb-data'

/** 调用方条目的身份。`entryId` 定数据写在哪，`pkg` 记归属、写进报错 */
interface CallerEntryIdentity {
  entryId: string
  pkg: string
}

/** 调用方拿到的接口。写 `inject: ['gwbData']` 才有 */
export interface GwbDataApi {
  /** 调用方条目的数据目录。存非 JSON（图片、日志）时用它，不必自己拼路径 */
  readonly dir: string
  /** 读一份文档。没有 / 坏了一律回 undefined */
  readDoc(doc: string): Promise<unknown>
  /** 整份替换，原子写入 */
  writeDoc(doc: string, value: unknown): Promise<void>
  /** 各数据目录的归属：目录名（条目 id 末段）→ 包名。还没记归属的目录不列。插件管理的 plugin-manager.transfer-owner 调它 */
  owners(): Promise<Record<string, string>>
  /** 把一个数据目录改归 `pkg`，目录不在就建出来。`id` 认完整 entryId 也认裸 id。插件管理的 plugin-manager.transfer-owner 调它 */
  transferOwner(id: string, pkg: string): Promise<void>
}

/** 方法里的 `this.ctx` 是调用方的上下文，目录由调用方的条目算出，调用方报不出别人的身份 */
export default class GwbData extends Service implements GwbDataApi {
  private readonly homeDir: string
  /** 用 TS 的 `private` 不用 `#`：cordis 给每个调用方派生 `Object.create(this)`，`#` 字段在派生对象上一读就抛错 */
  private readonly warnAsDataPlugin: (message: string) => void
  private readonly entryIdsWarnedAsRandom = new Set<string>()
  /** 核对过归属的目录 → 包名，免得每次读写都去磁盘上读 `.owner.json` */
  private readonly verifiedOwnerByDir = new Map<string, string>()

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbData')
    this.homeDir = requireKernel(ctx).dataDir
    // 构造时 this.ctx 还是本插件自己的上下文，logger 记在本插件名下
    this.warnAsDataPlugin = (message: string): void => ctx.logger(PLUGIN_NAME).warn(message)
  }

  /** `fiber.entry` 是 loader 加上的，不在 cordis 的类型里，按运行时形状取 */
  private callerEntryIdentity(): CallerEntryIdentity {
    const fiber = this.ctx.fiber as unknown as { entry?: { id?: unknown; options?: { name?: unknown } } } | undefined
    const entry = fiber?.entry
    const entryId = entry?.id
    const pkg = entry?.options?.name
    if (typeof entryId !== 'string' || entryId === '' || typeof pkg !== 'string' || pkg === '') {
      throw new Error('取不到调用方的身份——ctx.gwbData 只能在经 cordis.yml 加载的插件里用')
    }
    return { entryId, pkg }
  }

  get dir(): string {
    return this.claimEntryDir(this.callerEntryIdentity())
  }

  async readDoc(doc: string): Promise<unknown> {
    return readDoc(this.dir, doc, (message) => this.ctx.logger.warn(message))
  }

  async writeDoc(doc: string, value: unknown): Promise<void> {
    const identity = this.callerEntryIdentity()
    const dir = this.claimEntryDir(identity)
    try {
      await writeDoc(dir, doc, value)
    } catch (writeError: unknown) {
      // 调用方常把异常吞掉，这里不写日志的话数据没写进去也没人知道
      this.ctx.logger(PLUGIN_NAME).error(`写 ${identity.entryId}/${doc} 失败：${String(writeError)}`)
      throw writeError
    }
  }

  async owners(): Promise<Record<string, string>> {
    return listOwners(dataRoot(this.homeDir), this.warnAsDataPlugin)
  }

  async transferOwner(id: string, pkg: string): Promise<void> {
    if (typeof pkg !== 'string' || pkg === '') throw new Error('改归属要给一个非空的包名')
    const dir = entryDir(this.homeDir, id)
    stampOwner(dir, pkg)
    this.verifiedOwnerByDir.set(dir, pkg)
    this.ctx.logger(PLUGIN_NAME).info(`数据目录 ${dir} 改归 ${pkg}`)
  }

  /** 算出这条条目的目录并核对归属：没有归属就记上，归别的包就抛错 */
  private claimEntryDir(identity: CallerEntryIdentity): string {
    this.warnOnceWhenEntryIdIsRandom(identity)
    const dir = entryDir(this.homeDir, identity.entryId)
    if (this.verifiedOwnerByDir.get(dir) === identity.pkg) return dir
    claimDir(dir, identity.pkg)
    this.verifiedOwnerByDir.set(dir, identity.pkg)
    return dir
  }

  /** `dir` 每次读写都要算一遍，所以每条条目只告警一次 */
  private warnOnceWhenEntryIdIsRandom(identity: CallerEntryIdentity): void {
    if (!looksRandom(identity.entryId) || this.entryIdsWarnedAsRandom.has(identity.entryId)) return
    this.entryIdsWarnedAsRandom.add(identity.entryId)
    this.warnAsDataPlugin(
      `${identity.pkg} 那条条目没在 cordis.yml 里写 id（现在是 ${identity.entryId}）。随机 id 每次启动都变，它的数据每次启动都会新建一份`,
    )
  }
}

declare module 'cordis' {
  interface Context {
    gwbData: GwbDataApi
  }
}

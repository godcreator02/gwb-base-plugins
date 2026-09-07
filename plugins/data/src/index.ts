import { Service } from 'cordis'
import { requireKernel, type GwbContext } from '@godcreator02/gwb-plugin-api'
import { packageDir } from './paths.js'
import { readDoc, writeDoc } from './store.js'

/**
 * 件的数据落盘。`ctx.gwbData` 交出来的那一格**自动绑定到取它的那个件**——
 * 件不报名字，也就没法报别人的名字去读别人的数据。
 *
 * 靠的是 cordis `Service` 的机制：方法里的 `this.ctx` 是**消费者**的 ctx，
 * 从它的 `fiber.entry.options.name` 就是那个件在 `cordis.yml` 里的包名。
 */

/** 消费方拿到的那一格。写 `inject: ['gwbData']` 才有 */
export interface GwbDataApi {
  /** 本件的数据目录。存非 JSON（图片、日志）时用它，不必自己拼路径 */
  readonly dir: string
  /** 读一份文档。没有 / 坏了一律回 undefined */
  readDoc(doc: string): Promise<unknown>
  /** 整份替换，原子落盘 */
  writeDoc(doc: string, value: unknown): Promise<void>
}

export default class GwbData extends Service implements GwbDataApi {
  /** home 目录。构造时从**提供方**的 ctx 取——那时 this.ctx 还是自己 */
  private readonly home: string

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbData')
    this.home = requireKernel(ctx).dataDir
  }

  /**
   * 取它的是哪个件。`fiber.entry` 是 loader 挂上的（不是 cordis 本体的面），
   * 所以这儿按运行时形状取、不动全局类型声明
   */
  private owner(): string {
    const fiber = this.ctx.fiber as unknown as { entry?: { options?: { name?: unknown } } } | undefined
    const name = fiber?.entry?.options?.name
    if (typeof name !== 'string' || name === '') {
      throw new Error('取不到调用方的身份——ctx.gwbData 只能在经 cordis.yml 挂上的件里用')
    }
    return name
  }

  get dir(): string {
    return packageDir(this.home, this.owner())
  }

  async readDoc(doc: string): Promise<unknown> {
    return readDoc(this.dir, doc, (message) => this.ctx.logger.warn(message))
  }

  async writeDoc(doc: string, value: unknown): Promise<void> {
    return writeDoc(this.dir, doc, value)
  }
}

declare module 'cordis' {
  interface Context {
    gwbData: GwbDataApi
  }
}

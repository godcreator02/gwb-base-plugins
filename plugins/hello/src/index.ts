import { requireKernel, type GwbContext } from '@godcreator02/gwb-plugin-api'
// 只为激活 data 件的 `declare module 'cordis'`——它给 ctx 加上 gwbData 这个名字
import type {} from '@godcreator02/gwb-data'

/**
 * node 半：拿 data 件存一份计数，每次启动 +1。
 *
 * 这个件是**验收件**，它的活就是把链路走一遍给人看：浏览器那半验运行时环境与样式，
 * node 这半验数据落盘——读回上次写的值就说明真的落了盘、也真的认出了「我是谁」。
 */
export const name = 'gwb-hello'

/** 没有 data 件就不挂——inject 是 cordis 的等待机制，不是建议 */
export const inject = ['gwbData']

interface Probe {
  runs?: number
  at?: string
}

export function apply(ctx: GwbContext): void {
  // 这条链上的错必须有出口:apply 是同步的,里头的 async 一旦静默 reject,
  // 现象就是「件挂上了但什么都没发生」——查起来毫无线索
  void (async () => {
    console.log(`[hello] gwbData = ${typeof ctx.gwbData}，dir = ${ctx.gwbData?.dir ?? '取不到'}`)
    const before = (await ctx.gwbData.readDoc('probe')) as Probe | undefined
    const runs = (before?.runs ?? 0) + 1
    await ctx.gwbData.writeDoc('probe', { runs, at: new Date().toISOString() })
    console.log(`[hello] data 通了：这是第 ${runs} 次启动（上次 ${before?.at ?? '无'}）`)
    console.log(`[hello] home=${requireKernel(ctx).dataDir}`)
  })().catch((err: unknown) => {
    console.error(`[hello] data 探针失败：${err instanceof Error ? err.stack : String(err)}`)
  })
}

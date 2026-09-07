import { requireKernel, type GwbContext } from '@godcreator02/gwb-plugin-api'
// 只为激活那两个件的 `declare module 'cordis'`——它们给 ctx 加上 gwbData 与 gwbShell 这两个名字
import type {} from '@godcreator02/gwb-data'
import type {} from '@godcreator02/gwb-shell'
import type {} from '@godcreator02/gwb-skills'

/**
 * node 半：拿 data 件存一份计数，每次启动 +1；再往外壳注册**两格**窗格、报一下自己叫什么。
 *
 * 这个件是**验收件**，它的活就是把链路走一遍给人看：浏览器那半验运行时环境与样式，
 * node 这半验数据落盘与窗格注册——读回上次写的值就说明真的落了盘、也真的认出了
 * 「我是谁」；注册那两格出现在 `shell.panes` 的回执里，就说明服务真从 fiber 上认出了
 * 注册方的条目与包名。
 *
 * 两格是**故意**的：`main` 只能开一份，`counter` 声明了 `duplicable`——一个件同时验
 * 「几格各画各的」与「同一格开两份互不干扰」这两件事。
 */
export const name = 'gwb-hello'

/** 缺哪个都不挂——inject 是 cordis 的等待机制，不是建议 */
export const inject = ['gwbData', 'gwbShell']

interface Probe {
  runs?: number
  at?: string
}

export function apply(ctx: GwbContext): void {
  // 注册在 apply 里,同步的。身份不用报——服务从 fiber 上认。也不用自己包 effect,
  // 本件卸载时这两格自动从表上摘掉
  ctx.gwbShell.registerPane({ id: 'main', title: '验收件', icon: 'flask-conical' })
  // **声明 duplicable 的那一格**:它每一份自己一个本地计数,开两份互不干扰
  ctx.gwbShell.registerPane({ id: 'counter', title: '计数器', icon: 'hash', duplicable: true })
  ctx.gwbShell.describeSelf({ title: '验收件', icon: 'flask-conical' })
  console.log('[hello] 注册了两格（main、counter）并报了名字')

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

  // 说明书那一格。**局部注入,不写进 export const inject**:写进去,这个件在没装
  // skills 件的 home 里就整个挂不上了——而说明书不是它能不能干活的前提。
  // 产物在 dist/ 下,所以包根的 skills/ 是 '../skills/';那个目录得进 package.json 的 files
  ctx.inject(['gwbSkills'], (scoped) => {
    scoped.effect(() => scoped.gwbSkills.register(new URL('../skills/', import.meta.url)))
  })
}

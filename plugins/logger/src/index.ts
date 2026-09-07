import type { GwbContext } from '@godcreator02/gwb-plugin-api'
// 只为激活 shell 件的 `declare module 'cordis'`——它给 ctx 加上 gwbShell 这个名字
import type {} from '@godcreator02/gwb-shell'

/**
 * node 半：**只有注册**。
 *
 * 这个件叫 logger，却一条日志都不处理——日志的汇总、缓冲、落盘、轮转**全在内核**。
 * 不是还没写，是够不着：四路日志（件与 loader 的 cordis 日志、宿主自己的话、主进程
 * 自己的话、渲染层 console）里有三路只有内核看得见，件跑在宿主子进程里；而件挂 exporter
 * 那条路上，**件挂不上的那一刻它自己也不在场**——那恰恰是最该看日志的时候。
 *
 * 所以这儿只剩两件事：往外壳注册一格窗格、报一下自己叫什么。判据见文档站。
 */
export const name = 'gwb-logger'

/** 没有外壳就不挂——这一格窗格是这个件的全部 */
export const inject = ['gwbShell']

export function apply(ctx: GwbContext): void {
  // 两条都不用自己包 ctx.effect：件卸载时表上那两条自动摘掉
  ctx.gwbShell.registerPane({ id: 'main', title: '日志', icon: 'scroll-text', duplicable: true })
  ctx.gwbShell.describeSelf({ title: '日志', icon: 'scroll-text' })

  // 这句不是客套：它应该**出现在自己的窗格里**（来源 plugin、名字 gwb-logger），
  // 是整条链路最省事的一次自检
  ctx.logger(name).info('日志窗格已注册')
}

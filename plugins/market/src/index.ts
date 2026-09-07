import type { GwbContext } from '@godcreator02/gwb-plugin-api'
// 只为激活 shell 件的 `declare module 'cordis'`——它给 ctx 加上 gwbShell 这个名字
import type {} from '@godcreator02/gwb-shell'

/**
 * node 半：**只有注册**。
 *
 * 市场是「发现」的入口——摆出能装什么，点一下装。**装的动作不在这个件里**：那归
 * `gwb-plugins`（`plugins.install`），市场的浏览器半按名字调它的命令。所以这一半
 * 没有服务、没有命令、不碰 pnpm、不碰 cordis.yml，一行 I/O 都没有。
 *
 * 清单也不在这一半：`src/catalog.ts` 跟界面一起进 esbuild 那一束，直接摆在浏览器里。
 *
 * **没有外壳就不挂**（同 logger 件）：这一格窗格是这个件的全部，home 里没有外壳时
 * 它挂上也没地方画。让它停在「等 gwbShell」那一档，cordis 会在日志里明说它在等谁；
 * 换成可选注入的话，现象是「件挂上了，可什么都没发生」——那是最难查的一种。
 */
export const name = 'gwb-market'

/** 没有外壳就不挂——这一格窗格是这个件的全部 */
export const inject = ['gwbShell']

/** 窗格 id。跟 `src/client/index.tsx` 里那个常量对着，认不出的 id 那半会画一句错 */
const PANE_ID = 'market'

export function apply(ctx: GwbContext): void {
  // 两条都不用自己包 ctx.effect：件卸载时表上那两条自动摘掉
  ctx.gwbShell.registerPane({ id: PANE_ID, title: '市场', icon: 'store' })
  ctx.gwbShell.describeSelf({ title: '市场', icon: 'store' })

  ctx.logger(name).info('市场窗格已注册（只摆清单，装的动作归插件管理件）')
}

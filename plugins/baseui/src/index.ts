import type { GwbContext } from '@godcreator02/gwb-plugin-api'
// 只为激活那两个件的 `declare module 'cordis'`——它们给 ctx 加上各自那个名字。
// **都是嵌套注入**：home 里缺谁，下面那块局部注入就永远 PENDING，本件照常挂、
// 对应窗格不注册，其余照常
import type {} from '@godcreator02/gwb-logger'
import type {} from '@godcreator02/gwb-plugin-manager'
import type {} from '@godcreator02/gwb-shell'

/**
 * 基础界面件：基础件的官方窗格集。一件多格，浏览器半按 `pane.id` 分派。
 *
 * 本件存在的理由（2026-09-12 三仓拆分）：logger 与 plugin-manager 劈 core 后，各自的
 * 浏览器半没有独立成包，统一收进这里——薄皮单独成包的仪式开销（发版/文档/peer）
 * 摊平在一个发布单元上，共享组件（shadcn 那套）合一份。形态照 VS Code 内置视图抄：
 * **聚合的是发布，不是开发**——panes/ 下窗格之间零 import，只准 import components/。
 *
 * 三条规矩（哪条破了本件就吸成上帝件）：
 *
 * 1. 对每个 core 服务**一律嵌套注入**，硬 inject 只有 gwbShell——缺谁少画谁的窗格
 * 2. **一窗格一模块**：`panes/` 下互不引用，共享组件住 `src/client/components/ui`
 * 3. **只收「劈过件的皮」**：进本件的唯一资格是它是某个 core 件的官方脸；
 *    UI 即本体的件（hello、theme、将来的功能件）自带皮，不进
 */

export const name = 'gwb-baseui'

/** 浏览器半与样式表的地址，注册窗格时报给外壳。dist/ 下三个文件是邻居，从本模块算 */
const CLIENT_URL = new URL('./client.js', import.meta.url).href
const STYLE_URL = new URL('./style.css', import.meta.url).href

/** 缺外壳不挂：没有窗格井就没有「窗格集」——inject 是等待机制，不是建议 */
export const inject = ['gwbShell']

export function apply(ctx: GwbContext): void {
  const log = ctx.logger(name)

  // 状态栏报一次本件自己的脸；各窗格的标题与图标在各自注册时给
  ctx.gwbShell.describeSelf({ title: '基础界面', icon: 'layout-grid' })

  // 日志窗格。core 是 gwb-logger（聚合缓冲 + 查询命令 + 事件流），这半只是它的皮
  ctx.inject(['gwbLogger'], (scoped) => {
    scoped.effect(() =>
      scoped.gwbShell.registerPane({ id: 'logger', title: '日志', icon: 'scroll-text', client: CLIENT_URL, style: STYLE_URL }),
    )
  })

  // 插件管理面板。core 是 gwb-plugin-manager（装卸检升、条目管理），这半只是它的皮
  ctx.inject(['gwbPluginManager'], (scoped) => {
    scoped.effect(() =>
      scoped.gwbShell.registerPane({ id: 'plugin-manager', title: '插件管理', icon: 'puzzle', client: CLIENT_URL, style: STYLE_URL }),
    )
  })

  log.info('基础界面就位（装了哪些 core，就有哪些窗格）')
}

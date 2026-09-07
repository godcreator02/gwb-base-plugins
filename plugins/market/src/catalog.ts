/**
 * 市场摆出来的那份清单。**手工白名单，硬编码在件里**，零 I/O、不联网。
 *
 * ## 为什么是白名单，不是「搜 registry 里的全部」
 *
 * 本机 registry 的搜索接口（`/-/v1/search?text=@godcreator02`）能用，但它是个坟场：
 * 45 个包里正线只有十来个，其余是一整条**已废弃**的线，而且名字跟正线特别像——
 * `@godcreator02/gwb-api` 对着正线的 `gwb-plugin-api`、`gwb-cli` 对着正线的
 * `gwb-commands`，还有 `cli` / `config` / `devkit` / `echo` / `example` / `gwb-build` /
 * `gwb-home`。照搜索结果摆市场，用户第一件事就是装错一整条废弃线。
 *
 * 所以这份清单的**第一职责是白名单**，不是推荐语。加一条之前先确认它在正线上。
 *
 * ## 为什么一条只有三样
 *
 * - **没有 `spec`**：市场不钉版本，装的一律是最新的。已装的版本从 `plugins.list` 的
 *   `spec` 就有，用不着在这儿再存一份会过期的
 * - **没有分类、没有图标**：11 条排一列看得完。真到看不完那天再加
 *
 * ## `title` 与 `why` 各说一件事
 *
 * `title` 是短名（「外壳」「日志」），`why` 是**你什么时候会需要它**——不是「它是什么」。
 * 「它是什么」在每个件自己的 `description` 里，抄过来只会得到一份必然腐烂的副本。
 *
 * 这个文件只有浏览器那半在用（跟界面一起进 esbuild 那一束），node 半碰都不碰它。
 */

/** 清单里的一条。三样，就三样 */
export interface CatalogItem {
  /** 完整包名 */
  pkg: string
  /** 短名，列表上最显眼那几个字 */
  title: string
  /** 你什么时候会想装它 */
  why: string
}

export const CATALOG: readonly CatalogItem[] = [
  {
    pkg: '@godcreator02/gwb-shell',
    title: '外壳',
    why: '没有它界面就是一片白——所有带窗格的件都得靠它才有地方画。装了别的件却什么都没出现，先看这一条。',
  },
  {
    pkg: '@godcreator02/gwb-commands',
    title: '命令总线',
    why: '界面、命令行、外部 agent 想调到任何一个件的能力，都得先经过这一份注册表。没有它，按钮点了不会有反应。',
  },
  {
    pkg: '@godcreator02/gwb-plugins',
    title: '插件管理',
    why: '想看已经装了什么、临时停用一个件、给条目起个看得懂的名字的时候。市场这一格点「装」，干活的也是它。',
  },
  {
    pkg: '@godcreator02/gwb-settings',
    title: '设置',
    why: '某个件要你填点东西（一个路径、一个开关、一个 token）的时候——那个填的地方由它提供，值也由它存。',
  },
  {
    pkg: '@godcreator02/gwb-data',
    title: '数据',
    why: '想让件记住点东西（一份列表、一份草稿、上次选的那个），而那东西又不该摆进设置里的时候。',
  },
  {
    pkg: '@godcreator02/gwb-logger',
    title: '日志',
    why: '脱离终端跑起来之后，出了事还得有个地方能查——件、宿主、主进程、渲染层四路都汇进这一格。装第二个件之前先装它。',
  },
  {
    pkg: '@godcreator02/gwb-mcp',
    title: 'MCP 桥',
    why: '想让外面的 agent（Claude Code 这种）直接调这台工作台的命令的时候。',
  },
  {
    pkg: '@godcreator02/gwb-skills',
    title: '说明书',
    why: '装的件多到记不住谁能干什么的时候——每个件自己把说明书挂上来，在一处查得到。',
  },
  {
    pkg: '@godcreator02/gwb-node-cli',
    title: 'node CLI',
    why: '你写的件要跑一个 node 脚本的时候：起进程、收输出、按时限收尾这些琐事全归它，你只管登记一个 cli.js。',
  },
  {
    pkg: '@godcreator02/gwb-py-cli',
    title: 'python CLI',
    why: '你写的件要跑 python 的时候：venv 由它用 uv 建在你那个件的包根下，不碰机器上的全局环境。',
  },
  {
    pkg: '@godcreator02/gwb-hello',
    title: '示例件',
    why: '刚装完想确认这一套是活的，或者要照着写一个自己的件的时候——它把窗格、样式、两张注册表、两条 CLI 都走了一遍。',
  },
]

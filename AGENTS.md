# gwb-base-plugins

**单进程内核 `gwb-kernel-min`（`D:\unitfolders\26090705ymz\gwb-kernel-min`，单元
`26090705ymz`）的件仓。** 版本看各包 `package.json`。

## 2026-09-09：换了内核，换了契约

**旧内核 `gwb-kernel` 退役**——宿主子进程、fd3、`gwb://`、`kernel.info`、内核那条日志管道，
全都不在了。这个仓从 0.1.0 起对着 `gwb-kernel-min` 与**词汇表 0.1**
（`@godcreator02/gwb-plugin-api@0.1.0`）。变的就这几处：

| 从前 | 现在 |
| --- | --- |
| 内核按 `exports` 表解析 `gwb://asset/plugins/<包>/client` | **窗格件注册时自报地址**：`registerPane({ …, client, style })`，值从自己的 `import.meta.url` 算成 `file://` |
| 内核挑「谁是外壳」并 boot 它 | 外壳自己 `requireKernel(ctx).setShell(new URL('./client.js', import.meta.url).href)`；开机要的 home 与样式表走 `shell.env` |
| 日志四路汇总在内核，页面订 `window.gwb.logs` | **日志件自己是管道**：挂 cordis exporter 收三路（件 / 内核 / 渲染层）、自己缓冲、`gwbKernel.emit` 推；页面订 `window.gwb.on` 认自己的记号 |
| `kernel.info` 报 `shared` / `sharedPkgs` | **没有自省命令**。importmap 仍由内核扫各包的 `gwb.shared` 拼；件管理自己读 home 的 `node_modules`，命令是 `plugins.shared` |
| `gwbKernel.appVersion` / `install(specs)` / `kernel.install` | **都没有了**。要版本号读自己包的 `package.json`；装包走 `plugins.install` |

`commands` / `node-cli` / `py-cli` / `data` / `settings` / `skills` 六件源码一行没动——
契约面小的好处。判据与验的读数见文档站 `decisions` 那条 2026-09-09。

## 十二件

| 件 | 包名 | 服务 | 干什么 |
| --- | --- | --- | --- |
| commands | `@godcreator02/gwb-commands` | `ctx.gwbCommands` | 命令总线。**没有它,界面调不到任何 node 侧能力**——内核收到什么就原样派给它 |
| shell | `@godcreator02/gwb-shell` | `ctx.gwbShell` | dockview 外壳,占整页;窗格注册表 |
| logger | `@godcreator02/gwb-logger` | — | 日志件:管道 + 一格窗格 |
| settings | `@godcreator02/gwb-settings` | `ctx.gwbSettings` | 设置 |
| data | `@godcreator02/gwb-data` | `ctx.gwbData` | 件的数据落盘 |
| skills | `@godcreator02/gwb-skills` | `ctx.gwbSkills` | 说明书的收集与查询 |
| theme | `@godcreator02/gwb-theme` | — | 外观:字体与自定义 CSS,一格窗格 |
| plugins | `@godcreator02/gwb-plugins` | `ctx.gwbPlugins` | 管包与条目,一格窗格 |
| mcp | `@godcreator02/gwb-mcp` | — | MCP 桥,命令面开给外部 agent |
| node-cli / py-cli | `@godcreator02/gwb-node-cli` / `-py-cli` | `ctx.gwbNodeCli` / `ctx.gwbPyCli` | 两个 CLI 运行器 |
| hello | `@godcreator02/gwb-hello` | — | 验收件,两格窗格 + 两条 CLI |

## 两条命名规矩

**包名 `@godcreator02/gwb-<件名>`。** 加 `gwb-` 前缀是为了跟已废弃的那批错开——
`@godcreator02/cli`、`/shell`、`/logger`、`/settings` 被那批占着。

**服务名一律 `gwb` 开头小驼峰**，默认跟件名对应（`gwb-commands` → `ctx.gwbCommands`）。cordis 官方件
的服务照它自己的（`timer`、`loader`），那不是这个生态的东西。判据与理由在内核仓的
`AGENTS.md`。

## 件的三条通用规矩

1. **配置一律走 `gwbSettings.define`，不吃 `cordis.yml` 的 `config`。** 设置有界面、有命令、
   缺省值看得见；`config` 只有改文件重挂一条路。件的配置面只留一条（mcp 的 `port` 是样板）
2. **命令描述必须写参数形状。** `register({ description })` 要让 agent 只看它就知道参数怎么给
   ——`{ entryId }`、`{ pkg, spec? }`、`{ args?: string[], cwd?: string }` 这种；无参数写
   「无参数」。经 mcp 出去的命令，agent 手上除了名字就只有这一句
3. **要上顶层在登记命令时标 `top: true`，桥照它渲染；agent 标之前先问人。** 顶层是稀缺位
   （客户端的工具清单是连接时的快照），缺省只有说明书那两条；其余命令一律经
   `gwb_command_run` 按名调。判据见文档站 `decisions` 那条 2026-09-09「工具面收窄」

## 内核给的面就这么大

- **`ctx.gwbKernel`**（永不撤销，用 `requireKernel(ctx)` 取，**不写进 `inject`**）：
  `dataDir` / `emit(payload)` / `setShell(url) → 撤销函数`。**就这三样。**
- **`ctx.loader`**：条目树。改条目就是热挂卸——`create` / `remove` / `update` / `store`。
  自己所在的那棵树是 `ctx.fiber.entry?.parent?.tree`
- **一条内核命令都没有**：`gwb:command` 收到什么就原样派给 `ctx.gwbCommands`
- **页面的公共面 `window.gwb`**：`command(name, args)` / `on(cb)` / `onShell(cb)`
- **件跑在 Electron 主进程里**，所以 `import('electron')` 是件够得着的——开窗、菜单、
  托盘、对话框全归件

契约包 `@godcreator02/gwb-plugin-api` 0.1 只有这几个名字（`GwbContext` / `GwbKernelApi` /
`GwbResult` / `GwbWindowApi` / `ShellBoot` / `requireKernel` / `isRecord`）——**内核的面本来
就这么小**，别指望有更多。正本在 `gwb-kernel-min/packages/plugin-api/src/index.ts`。

## 母仓那批是参考，不是模板

废弃的件仓在 `D:\unitfolders\26090623hyz\gwb-plugins`。去查某个件当初为什么那么做、
踩过什么坑，值得；**结构、分层、包划分一概不抄**。

它那套有几样这里明确不要：`gwb.minAppVersion` 与精确 peer 号的双份准入、`platform` 分区与
`window.confirm` 拦截、为具体某个件写的硬编码分支。

一个**活着的回归**要第一天躲开：母仓把契约包声明成 `peerDependencies`，tsdown 默认把 peer
外置成裸名，于是 `settings` 和 `shell` 的 `client.js` 里留下了浏览器解析不到的裸名 import。
写带界面的件时，契约包要么进共享声明、要么强制打进束——二选一，配一条产物守卫测试钉住。

## 干活之前:判断层住 skill

`.claude/skills/` 三份（坐在这儿自动可见):

| skill | 什么时候用 |
| --- | --- |
| `gwb-plugin-dev` | 起一个新件、改一个件、发版、装进 home 实机验之前 |
| `gwb-doc` | 写文档、写注释、动 livedoc 引用之前（**正本在内核仓**,这份是路标) |
| `gwb-decide` | 遇到技术选型之前——推完**交给用户拍板,不自己定**（**正本在内核仓**) |

**先读内核仓 `gwb-kernel-min` 的 `AGENTS.md`**（内核只做六件事、契约面、件在新契约下长什么样;
准入判据两道关、服务命名、依赖三档沿用退役那份 `gwb-kernel/AGENTS.md`）。
那些是这条线的正本,这里只写件仓自己的事。

路线在文档站的 `roadmap` 页。

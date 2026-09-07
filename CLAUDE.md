# gwb-base-plugins

`gwb-kernel`（最小内核，`D:\unitfolders\26090705ymz\gwb-kernel`）的基础件仓。第一批四件：

| 件 | 包名 | 服务 | 干什么 |
| --- | --- | --- | --- |
| cli | `@godcreator02/gwb-cli` | `ctx.gwbCli` | 命令总线。**没有它,界面调不到任何 node 侧能力**——内核的 dispatch 除两条自省命令外全走它 |
| shell | `@godcreator02/gwb-shell` | — | dockview 外壳,占整页 |
| logger | `@godcreator02/gwb-logger` | — | 日志窗格 |
| settings | `@godcreator02/gwb-settings` | `ctx.gwbSettings` | 设置 |

## 两条命名规矩

**包名 `@godcreator02/gwb-<件名>`。** 加 `gwb-` 前缀是为了跟已废弃的那批错开——
`@godcreator02/cli`、`/shell`、`/logger`、`/settings` 被那批占着。

**服务名一律 `gwb` 开头小驼峰**，默认跟件名对应（`gwb-cli` → `ctx.gwbCli`）。cordis 官方件
的服务照它自己的（`timer`、`loader`），那不是这个生态的东西。判据与理由在内核仓的
`CLAUDE.md`。

## 内核给的面就这么大

- **`ctx.gwbKernel`**（永不撤销，用 `requireKernel(ctx)` 取，**不写进 `inject`**）：
  `dataDir` / `appVersion` / `install(specs)` / `emit(payload)`
- **`ctx.loader`**：条目树。改条目就是热挂卸——`create` / `remove` / `update` / `store`。
  自己所在的那棵树是 `ctx.fiber.entry?.parent?.tree`
- **两条内核命令**：`kernel.info`（自省）、`kernel.install`（装机）
- **`gwb://asset/plugins/<包名>/client.js`**：界面那半由这条 URL 交给页面

契约包 `@godcreator02/gwb-plugin-api` 只有五个名字（`GwbContext` / `GwbKernelApi` /
`GwbResult` / `requireKernel` / `isRecord`）——**内核的面本来就这么小**，别指望有更多。

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

**先读内核仓的 `CLAUDE.md`**（准入判据两道关、服务命名、依赖三档、内核四件事)。
那份是这条线的正本,这里只写件仓自己的事。

路线在文档站的 `roadmap` 页。

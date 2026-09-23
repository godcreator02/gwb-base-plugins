---
name: gwb-plugin-sources
description: 要查 registry 上有哪些插件可装、或要配第三方包源（比如 @j 这种个人源）时读。讲清不带参数的 search 查的是哪些源、一条源失败时回执怎么读、「是不是插件」怎么判断；plugin-sources.add 的两种写法（owner 走 gitea 的简便写法、registry 直接给地址）、为什么写在机器级 ~/.npmrc、@godcreator 为什么不许改删、token 怎么配对与遮掉、home 级同名 scope 会压过机器级。装、卸、升、条目管理不在这里，见说明书 gwb-plugin-manager。
---

# 找插件与配包源

`gwb-plugin-sources` 只回答两件事：配好的源上**有哪些插件可装**，以及**从哪些源装**。
四条命令，agent 经 MCP 入口的 `run` 按名字调用。真正的安装、卸载、升级、条目管理在
`gwb-plugin-manager`（说明书同名）。

## 查有什么可装：plugin-sources.search

不带参数直接调，就是查**全部配好的源**：`plugin-sources.list` 列出的两层 npmrc 里的所有 scope，
`@godcreator` 在前、其余按名字排（插件管理窗格的「可装」列表用的就是这个）。也可以
`{ "scope": "@j" }` 只查一条。

- 逐条源**并发**查，**一条失败不影响别的**：查成的源里的插件并进 `packages`，没查成的在 `note`
  里点名；全都没查成才 `ok: false`
- 每条源走 **npm registry 的标准检索接口**。地址按 scope 从 npmrc 里找——先找 `@scope:registry=`，
  再找 `registry=`，每一种都是 home 级压过机器级，都没写就是 npm 官方源。这和 pnpm 安装时读的是
  同一批配置行，所以**从哪装就在哪搜**；这条源配了凭据会自动带上
- 回执每行带 `pkg`、`version`、`description`、`keywords`。**「是不是插件」只看包自己在清单
  `keywords` 里写没写 `gwb-plugin`**，名字不参与判断；库、共享包、没写这个关键词的包不会出现
- 回的是这条规则筛出来的全部结果：已经不维护的旧包也可能在里面。装之前先 search 一遍确认包名，
  别猜

## 配第三方包源：plugin-sources.add / list / remove

装第三方 scope 的插件（比如 `@j/gwb-daily-planner`）之前，得先让 pnpm 知道那个 scope 从哪条源装——
**scope 路由和凭据写进机器级 `~/.npmrc`**。

为什么是机器级：`@godcreator` 的路由本来就写在那里，本机每个 home 的安装、每个源码仓的安装与发版都
读它，包源是整台机器共用的配置。home 级 `.npmrc` pnpm 也会读，而且同名行优先，但那里只放手工加的
行，这几条命令只读、不写它。

**`plugin-sources.add { "scope": "@j", "owner": "J" }`**——gitea 的简便写法：源地址拼成
`<gitea 地址>/api/packages/J/npm/`（gitea 地址取设置里的 `gitea.base-url`，没配就用
`git.tianshen02.online:28377`），token 没传就取设置 `gitea` 分区的 token。也可以直接给地址：
`{ "scope": "@x", "registry": "https://…/npm/", "token": "…" }`。

- 幂等：同一个 scope 已经有了就原地替换（回执 `replaced: true`），不会多写一行
- token 行按**源地址**配对：同一个 token 配几条源，各是各的一行，互不影响。换源后旧源的凭据行如果
  已经没有别的 scope 指向它，就一起删掉；还有指向它的就留着
- 回执里的 `lines` 已经遮掉 token（`_authToken=***`），凭据不进回执、不进日志
- 写完会重读一遍确认写进去了；home 级有同名 scope 指向别的地址时，`note` 会提醒你：pnpm 用的是
  home 级那条，要让新写的生效，得删掉 home 级那行
- **`@godcreator` 不许经这里改，也不许删**：本机所有安装与发版都靠它，两种操作都当场拒绝
- 私有源取不到 token（设置里没配 `gitea.token`，又没显式传）时回 `ok: false`：与其等到安装时才失败，
  不如现在说清楚。公开源可以不给 token，只写路由行

**`plugin-sources.list`**（无参数）——两层合起来看：`sources: [{ scope, registry, file, token }]`，
`file` 标出处（`user` 是机器级，`home` 是本 home），token 只报有没有。同一个 scope 两层都有时，
生效的是 home 级那条。

**`plugin-sources.remove { "scope": "@j" }`**——从机器级删掉一条路由；机器级没有这条时回执说明原因
（包括「它在 home 级，要手工删」的情形）。

## 配完源之后

不带参数调 `plugin-sources.search` 就能看到新源上的插件；装用
`plugin-manager.install {"pkg":"@j/…"}`。安装、升级走的都是 pnpm，源一配好它们都认。

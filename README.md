# gwb-base-plugins

gwb 的**无界面基础插件仓**：八个插件，类型只从内核包 `@godcreator/gwb-kernel-desktop` 的包根取，不依赖任何界面包。
界面插件（shell / theme / baseui；令牌表随 shell 包发布，页面上的 react 由内核包提供）在界面插件仓 gwb-ui-plugins；
插件管理（plugin-manager，含找插件、配包源）在生命周期插件仓 gwb-lifecycle-plugins，和 devkit 一起开发；内核在 gwb-kernel。

| 插件       | 包名                         | 服务                                            |
| -------- | -------------------------- | --------------------------------------------- |
| commands | `@godcreator/gwb-commands` | `ctx.gwbCommands`（命令总线）                       |
| mcp      | `@godcreator/gwb-mcp`      | 无（MCP 入口，工具只有 index / search / run 三个，以后也不增加） |
| skills   | `@godcreator/gwb-skills`   | `ctx.gwbSkills`（说明书）                          |
| settings | `@godcreator/gwb-settings` | `ctx.gwbSettings`（设置）                         |
| data     | `@godcreator/gwb-data`     | `ctx.gwbData`（数据目录）                           |
| logger   | `@godcreator/gwb-logger`   | `ctx.gwbLogger`（服务上没有方法；日志经两条命令取）             |
| node-cli | `@godcreator/gwb-node-cli` | `ctx.gwbNodeCli`（运行 node 命令行工具）               |
| py-cli   | `@godcreator/gwb-py-cli`   | `ctx.gwbPyCli`（运行 python 命令行工具）               |

每个插件在 peer 里写内核包 `@godcreator/gwb-kernel-desktop` 的范围，声明兼容哪些内核。

## 运行

```powershell
pnpm install
pnpm check          # 类型检查 + oxlint + vitest
pnpm build          # 构建产物都在各包的 dist/
pnpm doc            # docfirst check：被引用的代码变了会标黄
```

## 怎么装

在工作台里调 `plugin-manager.install {"pkg":"<包名>"}`，比如 `{"pkg":"@godcreator/gwb-commands"}`。

## 文档

文档站在 `docs-site/`：

```powershell
pnpm --filter gwb-base-plugins-docs-site dev   # http://localhost:4315
```

入口页是插件之间的接缝图，十条接缝各一页；八个插件各一页；另有关键设计、开发、遇到过的问题三页。

这份 README 是生成文件，正本是 `docs-site/content/outputs/readme.mdx`。

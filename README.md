# gwb-base-plugins

gwb 的**无界面基础插件仓**：八个插件，全部只依赖词汇表包 `@godcreator/gwb-plugin-api` 的类型，不依赖任何界面包。
界面插件（shell / theme / baseui；react 与令牌表随 shell 包发布）在界面插件仓 gwb-ui-plugins；
插件管理（plugin-manager，含找插件、配包源）在 devkit 仓 gwb-devkit，和 devkit 一起开发；内核在 gwb-kernel。

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

每个插件在 `package.json` 的 `gwb.testedKernel` 里写明在哪个内核版本上测过。

## 运行

```powershell
pnpm install
pnpm check          # 类型检查 + oxlint + vitest
pnpm build          # 构建产物都在各包的 dist/
pnpm doc            # docfirst check：被引用的代码变了会标黄
```

发正式版用 devkit 插件的命令（经 MCP 入口的 `run` 调用，从哪个 home 调都行；`packages` 相对仓根、
被依赖的在前），发之前读 devkit 的说明书 `gwb-release`：

```
devkit.release {"dir":"<仓根>","packages":["plugins/commands"]}
```

手工发布是在包目录里 `pnpm publish --no-git-checks`——不手写 `--registry`，`@godcreator` 的
scope 路由写在用户级配置里。发完装进 home 用 `plugin-manager.install {"pkg":"@godcreator/gwb-commands"}`
（包和条目一起加）；已装的升级用 `plugin-manager.update-all`。

## 两条命名规矩

**包名 `@godcreator/gwb-<插件名>`**。**服务名一律 `gwb` 开头小驼峰**，默认和插件名对应；cordis 官方插件的服务名照它自己的。

## 文档

文档站在 `docs-site/`：

```powershell
pnpm --filter gwb-base-plugins-docs-site dev   # http://localhost:4315
```

入口页是插件之间的接缝图，十条接缝各一页；八个插件各一页；另有关键设计、开发、遇到过的问题三页。

**代码注释只写现状**——为什么这么写、遇到过什么问题，写在文档站，并用 docfirst 引用对应的代码：代码一改，
文档就标黄。这份 README 是生成文件，正本是 `docs-site/content/outputs/readme.mdx`；仓根 `AGENTS.md`
同理，正本是同目录的 `agents.mdx`。

共同规矩（准入判据、服务命名、依赖写法）的正本在内核仓与 devkit 的说明书，这个站只记这八个插件自己的事。

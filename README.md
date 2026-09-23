# gwb-base-plugins

gwb 的**无界面基础插件仓**——没有界面的插件，不依赖任何界面包（构建产物检查会报错）。界面平台
（shell / theme / baseui；react 与令牌表随 shell 包发布）在界面平台仓 gwb-ui-plugins。
下面九个插件在用：command-http 已退役（从未发版，目录已于 2026-09-22 删除）；插件管理（plugin-manager）
在 devkit 仓（gwb-devkit）和 devkit 一起开发。
组装后的验收由 devkit 模板当场生成。

| 插件             | 包名                               | 服务                                               |
| -------------- | -------------------------------- | ------------------------------------------------ |
| commands       | `@godcreator/gwb-commands`       | `ctx.gwbCommands`                                |
| data           | `@godcreator/gwb-data`           | `ctx.gwbData`                                    |
| settings       | `@godcreator/gwb-settings`       | `ctx.gwbSettings`                                |
| mcp            | `@godcreator/gwb-mcp`            | —（MCP 入口，只有这一个——工具只有 index/search/run 三个，以后也不增加） |
| skills         | `@godcreator/gwb-skills`         | `ctx.gwbSkills`                                  |
| node-cli       | `@godcreator/gwb-node-cli`       | `ctx.gwbNodeCli`                                 |
| py-cli         | `@godcreator/gwb-py-cli`         | `ctx.gwbPyCli`                                   |
| logger         | `@godcreator/gwb-logger`         | `ctx.gwbLogger`（服务上没有方法）                         |
| plugin-sources | `@godcreator/gwb-plugin-sources` | —（找插件、配包源，只有命令）                                  |

**各自进展到哪不在这里**——版本与进度只记在文档站的「路线」那一页，再抄一份必然不一致。

## 运行

```powershell
pnpm install
pnpm check          # typecheck + oxlint + vitest
pnpm build          # 构建产物都在各包的 dist/
pnpm doc            # docfirst check：被引用的代码变了会标黄
```

发正式版用 devkit 插件的命令（经 MCP 入口的 `run` 调用，从哪个 home 调都行；`packages` 相对仓根、
按依赖顺序），再装进 home 验证：

```
devkit.release {"dir":"<仓根>","packages":["plugins/commands"]}
```

手工发布是在包目录里 `pnpm publish --no-git-checks`——不手写 `--registry`，`@godcreator` 的
scope 路由写在用户级配置里。发完装进 home 用 `plugin-manager.install {"pkg":"@godcreator/gwb-commands"}`
（包和条目一起加）；已装的升级用 `plugin-manager.update-all`。

## 两条命名规矩

**包名 `@godcreator/gwb-<插件名>`**，加前缀和已废弃的那批区分开。
**服务名一律 `gwb` 开头小驼峰**，默认和插件名对应；cordis 官方插件的服务名照它自己的。

## 文档

文档站在 `docs-site/`：

```powershell
pnpm --filter gwb-base-plugins-docs-site dev   # http://localhost:4315
```

**代码注释只写现状**——为什么这么写、遇到过什么问题，都写在文档站的「撞过的墙」那一页，并且用
docfirst 引用对应的代码：代码一改，文档就标黄。这份 README 是生成文件，正本是
`docs-site/content/outputs/readme.mdx`；仓根 `AGENTS.md` 同理，正本是同目录的 `agents.mdx`。

规则（准入判据、服务命名、依赖写法）的正本在**内核仓**，这个站只记插件自己的事。

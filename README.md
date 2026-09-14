# gwb-base-plugins

gwb 的**无头基础插件仓**——无 UI 的插件，零 UI 依赖（产物守卫钉着）。UI 平台
（shell / theme / baseui / shared-react / tokens）住 `26091217uiz\gwb-ui-plugins`。
此刻十个插件在册、九个在役：command-http 搁置（逃生门）、mcp 复位接班。
验收位（hello 仓）已于 2026-09-13 整体退役——装配态验收改由 devkit 模板现场生成。

| 插件             | 包名                                 | 服务                               |
| -------------- | ---------------------------------- | -------------------------------- |
| commands       | `@godcreator02/gwb-commands`       | `ctx.gwbCommands`                |
| data           | `@godcreator02/gwb-data`           | `ctx.gwbData`                    |
| settings       | `@godcreator02/gwb-settings`       | `ctx.gwbSettings`                |
| command-http   | `@godcreator02/gwb-command-http`   | —（搁置，逃生门；入口由 mcp 复位接回）           |
| mcp            | `@godcreator02/gwb-mcp`            | —（MCP 门，唯一的门——工具面封顶 surface/run） |
| skills         | `@godcreator02/gwb-skills`         | `ctx.gwbSkills`                  |
| node-cli       | `@godcreator02/gwb-node-cli`       | `ctx.gwbNodeCli`                 |
| py-cli         | `@godcreator02/gwb-py-cli`         | `ctx.gwbPyCli`                   |
| logger         | `@godcreator02/gwb-logger`         | `ctx.gwbLogger`（薄服务，面留空）         |
| plugin-manager | `@godcreator02/gwb-plugin-manager` | `ctx.gwbPluginManager`（装卸检升）     |

**各自到哪了不在这儿**——版本与进度只有文档站的「路线」那一页记，抄第二份必然漂。

## 跑起来

```powershell
pnpm install
pnpm check          # typecheck + oxlint + vitest
pnpm build          # 产物一律落各包的 dist/
pnpm doc            # docfirst check：钉住的代码变了会报黄
```

发一个插件到本机 registry、再装进 home 验：

```powershell
cd plugins/commands
pnpm publish --registry https://npm.tianshen02.online:28377/ --no-git-checks
# 然后在 home 目录 pnpm add @godcreator02/gwb-commands@<版本>，改 cordis.yml 加条目
```

## 两条命名规矩

**包名 `@godcreator02/gwb-<插件名>`**，加前缀跟已废弃的那批错开。
**服务名一律 `gwb` 开头小驼峰**，默认跟插件名对应；cordis 官方插件的服务照它自己的。

## 文档

文档站在 `docs-site/`：

```powershell
pnpm --filter gwb-base-plugins-docs-site dev   # http://localhost:4315
```

**代码注释只写现状**——为什么这么写、撞过什么，全在文档站的「撞过的墙」那页，并且用
docfirst 钉在对应代码上：代码一改文档就报黄。这份 README 是生成物，正本是
`docs-site/content/outputs/readme.mdx`；仓根 `AGENTS.md` 同理，正本是同目录的 `agents.mdx`。

规则（准入判据、服务命名、依赖三档）的正本在**内核仓**，这个站只记插件自己的事。

# gwb-base-plugins

`gwb-kernel`（最小内核，单元 `26090705ymz`）的基础件仓。

| 件        | 包名                           | 服务                | 状态       |
| -------- | ---------------------------- | ----------------- | -------- |
| cli      | `@godcreator02/gwb-cli`      | `ctx.gwbCli`      | 已发 0.0.3 |
| hello    | `@godcreator02/gwb-hello`    | —                 | 已发，验收件   |
| shell    | `@godcreator02/gwb-shell`    | —                 | 下一个      |
| logger   | `@godcreator02/gwb-logger`   | —                 | 待做       |
| settings | `@godcreator02/gwb-settings` | `ctx.gwbSettings` | 待做       |

`packages/` 下另有两个**共享包**（不是件，是件的依赖，跟件平级装进 home）：
`@godcreator02/gwb-shared-react`（运行时环境）与 `@godcreator02/gwb-tokens`（设计令牌）。

## 跑起来

```powershell
pnpm install
pnpm check          # typecheck + oxlint + vitest
pnpm build          # 产物一律落各包的 dist/
pnpm doc            # livedoc check：钉住的代码变了会报黄
```

发一个件到本机 registry、再装进 home 验：

```powershell
cd plugins/cli
pnpm publish --registry http://127.0.0.1:4873/ --no-git-checks
# 然后在 home 目录 pnpm add @godcreator02/gwb-cli@<版本>，改 cordis.yml 加条目
```

## 两条命名规矩

**包名 `@godcreator02/gwb-<件名>`**，加前缀跟已废弃的那批错开。
**服务名一律 `gwb` 开头小驼峰**，默认跟件名对应；cordis 官方件的服务照它自己的。

## 文档

文档站在 `docs-site/`：

```powershell
pnpm --filter gwb-base-plugins-docs-site dev   # http://localhost:4315
```

**代码注释只写现状**——为什么这么写、撞过什么，全在文档站的「撞过的墙」那页，并且用
livedoc 钉在对应代码上：代码一改文档就报黄。这份 README 是生成物，正本是
`docs-site/content/docs/readme.mdx`。

规则（准入判据、服务命名、依赖三档）的正本在**内核仓**，这个站只记件自己的事。

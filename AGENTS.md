# gwb-base-plugins

**gwb 的无头基础插件仓**——无 UI 的插件全部对着词汇表（`@godcreator/gwb-plugin-api`）。
在役九个：commands、data、settings、mcp、skills、node-cli、py-cli、logger(core)、
plugin-manager(core)；另有搁置中的 command-http（入口由 mcp 复位接回、default 已卸载，
判据见轨迹卡「MCP 复位」）。**这个仓的插件零 UI 依赖**：peer 与产物里不许出现 shell /
shared-react / tokens 三个包（产物守卫钉着）。

UI 那半住 `D:\unitfolders\26091217uiz\gwb-ui-plugins`（shell、theme、baseui 与两个共享包）。
验收位（hello 仓）已于 2026-09-13 整体退役：装配态验收改由 devkit 模板现场生成，判据见
devkit 仓轨迹卡「模板即插件」。旧内核 `gwb-kernel` 已退役
——宿主子进程、fd3、`gwb://`、`kernel.info` 都不在了。

## 产物纪律

* 相对 import 必须带 `.js`、产物里不许有裸名 import——两条都有产物守卫
* 命名（包名前缀、服务名 `gwb` 开头）与依赖三档的正本在 `gwb-devkit` 写插件手册

## 写插件与验机

写插件的整条路（起插件 / 改插件 / 发版 / 实机验）在 `gwb-devkit` 插件的 skill（经 `gwb-skills`
挂载，`skill.read {"name":"gwb-devkit"}`）；写文档、动钉码看 `docfirst-docs` skill。动手前
先读内核仓的 `AGENTS.md`，那些是这条线的正本。

门禁 `pnpm check`（typecheck + lint + test）；文档检查单独 `pnpm doc` / `pnpm doc:confirm`，
红了这个提交不许推；动了被钉住的源码，confirm 之前先 commit。

## 母仓那批是参考，不是模板

废弃插件仓 `26090623hyz/gwb-plugins`：查坑值得，结构、分层、包划分一概不抄。一个活着的回归要
躲开：契约包声明成 `peerDependencies` 时 tsdown 会把 peer 外置成裸名 import——契约包要么进
共享声明、要么强制打进束，配产物守卫钉住。

## 实验材料落 `probes/`

实验、测量的全部材料落仓根 `probes/<时间戳>_<目的>/`：一次实验一个目录、**自包含**（半年后照
README 第一行跑一次能得到同样结论）、**进 git**、**不进 pnpm workspace**（它自己的依赖树不
跟着仓的一起漂）、不进 `pnpm check`。轨迹 evidence 卡在依据段写相对仓根的路径指过去。

## 生成物

仓根 `README.md` 与这份 `AGENTS.md` 都是生成物，别手改——正本在 `docs-site/content/outputs/`
（`readme.mdx` / `agents.mdx`），改完在 `docs-site` 跑 `pnpm exec docfirst render --target ai`
重摆，一起提交。文档站在 `docs-site/`（六区：现状 / 轨迹 / 交接 / 未来 / 生成正本 / 反馈），
起站 `pnpm --filter gwb-base-plugins-docs-site dev`，端口 4315。

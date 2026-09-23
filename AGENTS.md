# gwb-base-plugins

**gwb 的无界面基础插件仓**——没有界面的插件，全部只依赖词汇表包（`@godcreator/gwb-plugin-api`）的类型。
在役九个：commands、data、settings、mcp、skills、node-cli、py-cli、logger(core)、plugin-sources。
插件管理（plugin-manager）在 devkit 仓（gwb-devkit）和 devkit 一起开发，改它去那个仓。
已退役的 command-http 目录已于 2026-09-22 删除（包从未发版，
入口由 mcp 承担，理由见轨迹卡「command-http 退役」；同批删掉 hello/http/baseui/shell/
theme 五个拆分后留下的目录，都没有 package.json）。**这个仓的插件不依赖任何界面包**：peer 与构建产物里不许出现
shell / shared-react / tokens 三个包（构建产物检查会报错；后两个已于 D7 并进 shell、停止发布，检查仍然查这两个旧名字）。

每个插件在 `package.json` 的 `gwb.testedKernel` 里写明在哪个内核版本上测过，插件管理据此报告哪些插件没在
当前内核上测过；在新的内核版本上测过之后更新这个字段。

界面部分在 `D:\unitfolders\s28bv-gwbbase\gwb-ui-plugins`（shell、theme、baseui；react 与令牌表随 shell 包发布）。
仓根 `packages/shared-react`、`packages/tokens` 两个目录如果还在，是 D7 前构建留下的未跟踪文件
（只剩 `dist/` 与 `node_modules/`、没有 `package.json`），不是在役的包。
验收仓（hello）已于 2026-09-13 整体退役：组装后的验收改由 devkit 模板当场生成，理由见
devkit 仓轨迹卡「模板即插件」。旧内核 `gwb-kernel` 已退役
——宿主子进程、fd3、`gwb://`、`kernel.info` 都不存在了。

## 构建产物的规矩

* 相对 import 必须带 `.js`、构建产物里不许有包名 import——两条都有测试检查
* 命名（包名前缀、服务名以 `gwb` 开头）与依赖写法的正本在 `gwb-devkit` 的写插件手册

## 写插件与实机验证

写插件的完整流程（新建插件、改插件、发版、实机验证）在 `gwb-devkit` 插件的说明书（经 `gwb-skills`
登记，`skill.read {"name":"gwb-devkit"}`）；写文档、改代码引用看 `docfirst-docs` 说明书。动手前
先读内核仓的 `AGENTS.md`，那是 gwb 各仓共同规矩的正本。

提交前检查 `pnpm check`（typecheck + lint + test）；文档检查单独运行 `pnpm doc` / `pnpm doc:confirm`，
`pnpm doc` 报红时这个提交不许推送；改了被文档引用的源码，confirm 之前先 commit。

## 旧插件仓只作参考，不是模板

废弃插件仓 `26090623hyz/gwb-plugins`：查它踩过的坑有用，结构、分层、包划分一概不抄。有一个仍然存在的
问题要避开：接口包声明成 `peerDependencies` 时 tsdown 会把它外置成包名 import——接口包要么声明进
importmap、要么强制打包进来，并配上构建产物检查。

## 实验材料放 `probes/`

实验、测量的全部材料放在仓根 `probes/<时间戳>_<目的>/`：一次实验一个目录、**自包含**（半年后照
README 第一行运行一次能得到同样结论）、**进 git**、**不进 pnpm workspace**（它自己的依赖树不
跟着仓一起变）、不进 `pnpm check`。依据类轨迹卡在依据段写相对仓根的路径指向它。

## 生成文件

仓根 `README.md` 与这份 `AGENTS.md` 都是生成文件，别手改——正本在 `docs-site/content/outputs/`
（`readme.mdx` / `agents.mdx`），改完在 `docs-site` 运行 `pnpm exec docfirst render`
重新生成，一起提交。文档站在 `docs-site/`（六个区：现状 / 轨迹 / 交接 / 未来 / 生成文件正本 / 反馈），
启动用 `pnpm --filter gwb-base-plugins-docs-site dev`，端口 4315。

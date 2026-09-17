# pnpm 12 下 plugin-manager 的每条 pnpm 调用还成不成立

```
npm i -g pnpm@12.4.2 --prefix <临时目录>\p12 ; node run-seq.mjs <临时目录>\p12\node_modules\pnpm\pnpm.exe <临时目录>\home12 seq12.json ; node run-seq.mjs %APPDATA%\npm\node_modules\pnpm\bin\pnpm.cjs <临时目录>\home11 seq11.json
```

## 问什么

pnpm 12（Rust 重写，npm 包的 bin 是原生 `pnpm.exe`、不再有 `bin/pnpm.cjs`）装上之后，
plugin-manager 从「找 pnpm」到 `add` / `outdated --json` / `add pkg@latest` / 一趟多包 `add` /
`remove` / `config get` 这整条链断在哪。

## 怎么跑

1. 上面第一行：两份 pnpm 各跑一遍 `run-seq.mjs`（零依赖，照 plugin-manager 的调用序列起子进程，
   记退出码与 stdout/stderr）。原始输出整理在 `runs/01-seq-pnpm11.txt`、`runs/02-seq-pnpm12.txt`。
2. 查找链：改动前的 `dist/pnpm.js` 喂 PATH=<p12>，结果在 `runs/03-lookup-before-fix.txt`；
   改动后 `node harness.mjs <plugin-manager/dist> <空 home> [pnpm-path 设置值]`，结果在 `runs/04-harness-after-fix.txt`。
3. 工作区兼容：`pwsh copy-ws.ps1 -Repo <仓根> -Dest <临时目录>` 导出 HEAD 清单，
   在那儿 `<p12>\node_modules\pnpm\pnpm.exe install --frozen-lockfile`，读数在 `runs/05-workspace-frozen-install.txt`。
4. 实机：隔离 home 的读数在 `runs/06-isolated-home.txt`。

## 结论

**断点只有一处：查找链。** 改动前 PATH 上只有 pnpm 12 时 `locatePnpm` 回「找不到 pnpm」，设置项填
`pnpm.exe` / `pnpm.cmd` 也回「找不到 pnpm.cjs」（03）。pnpm 自己那半在 12 下全部成立：每条调用的退出码
与 11 逐条相同，`outdated --json` 形状相同（`{ current, latest, wanted, isDeprecated, dependencyType }`，
有过期退出码 1、全新退出码 0 且 stdout `{}`），`config get @godcreator:registry` 照读用户级 `.npmrc`（01/02）。
两仓 lockfile v9 与 `pnpm-workspace.yaml` 在 12 下 `install --frozen-lockfile` 直接过（05）。
改动后 12 走原生、11 走 cjs，隔离 home 里装 / 查 / 一键热升 / 单包升 / 卸 / 检索全绿，error 日志 0 条（04/06）。

## 跑那次的环境

2026-09-17，Windows 11 Pro 10.0.26200 x64，node 与 npm 为本机全局；pnpm 11.21.0（npm 全局）、
pnpm 12.4.2（npm 全局式 `--prefix` 装进临时目录）；gwb-base-plugins 起点 commit 70c4b17；
隔离 home 内核为安装版 gwb-kernel。

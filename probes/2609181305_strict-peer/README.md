# pnpm 12 的严格 peer 检查：怎么开关、没过时长什么样、home 动没动

```
pwsh -File probe.ps1 -Pnpm <npm 全局>\node_modules\pnpm\pnpm.exe -Work <临时目录> -Out runs
```

## 问什么

plugin-manager 要「装正式版严格、装开发版不严格」。要钉三件事：pnpm 12.4.2 开 / 关严格 peer 检查的准确
写法；严格没过时的退出码与报错长相；没过之后 home（`package.json`、`pnpm-lock.yaml`、`node_modules`）
动没动。顺带问：开发版号满足不满足 peer 范围、一个已经带冲突的 home 里严格装别的包会怎样、只解析
（`--lockfile-only`）与在 home 之外预检能不能做到「什么都没动」。

## 怎么跑

`probe.ps1` 每个场景新建一个「home」（只有 `package.json` 的空目录，`pnpm install` 一趟当基线），再跑
一条 `pnpm add`，记退出码、stdout / stderr 全文，前后各取四个指纹：`package.json`、`pnpm-lock.yaml`、
顶层 `node_modules`（含 junction 指向）、`node_modules/.pnpm` 目录名单。要真冲突的场景用 registry 上的
`@godcreator/gwb-shell@0.7.2` + `@godcreator/gwb-glm-quota`（peer 要 shell `>=0.8.0`）；`^` 范围与破坏线
开发版用 `file:` 本地包造。结果：`runs/summary.jsonl` 一行一个场景，`runs/<场景>.stdout.txt` 是原文。

## 结论

- **开关写法**：命令行 `--config.strict-peer-dependencies=true` / `=false`；`--strict-peer-dependencies` /
  `--no-strict-peer-dependencies` 同样生效（a、b、c、e）。不给参数默认不严格（d：只 WARN、退出码 0）。
  **目录里放一份只写 `strictPeerDependencies: true` 的 `pnpm-workspace.yaml`，不带参数的 `pnpm add` 就严格**
  （r-override-noflag 退出码 1）；显式 `=false` 压得过它（r-override-config-false）。那份文件是逐项覆盖，
  用户级配置里的 `minimumReleaseAgeExclude` 照读（`runs/s-config-merge.txt`）
- **没过时**：退出码 **1**，错误码 **`ERR_PNPM_PEER_DEP_ISSUES`**，全在 **stdout**（stderr 空）。长相是
  `✕ unmet peer <包>` / `Installed: <版本>` / `Wanted:` / `<范围>:` / `<要它的包@版本>`，后面跟一段
  `hint:` 教人关掉严格检查（a、b、m、n）
- **没过之后 home 动了一半**：`package.json` 不动，但 `pnpm-lock.yaml` 已写进新包、`node_modules` 顶层已
  链上它（a、b、m、n）；之后再跑一趟普通 `pnpm install` 回「Already up to date」、**不收回**（j）。
  `--lockfile-only` 也照写锁文件（i）
- **在 home 之外预检能做到什么都没动**：把 home 的 `package.json` 与 `pnpm-lock.yaml` 抄进空目录，在那儿
  `pnpm add <包> --lockfile-only` 带严格跑——冲突照样退出码 1、同一段说明，home 四个指纹全不变（p）；
  不冲突时退出码 0（q）。严格来自抄过去的 `pnpm-workspace.yaml` 时同理（r-override-noflag 就是那个形状）
- **home 里已有的冲突也会拦住不相干的严格安装**（f：带着 shell 冲突的 home 里严格装 `gwb-data`，照报那条
  shell 冲突、退出码 1）
- **开发版号在 pnpm 12 的 peer 检查里满足同一线的范围**：`0.9.1-dev.x` 对 `>=0.8.0`（g）与 `^0.9.0`（k）
  严格下都过。**破坏线的开发版不满足**：`0.10.0-dev.1` 对 `^0.9.0` 严格下拒（n），不严格照装（o）。
  上游出了新线而下游还钉 `^0.8.0`：严格下 `add shell@0.9.0` 拒（m）

## 跑那次的环境

2026-09-18，Windows 11 Pro 10.0.26200 x64；pnpm 12.4.2（npm 全局原生 `pnpm.exe`），用户级 pnpm 配置里
`minimumReleaseAgeExclude` 放行 `@godcreator/*`；registry 为 gitea 个人源。

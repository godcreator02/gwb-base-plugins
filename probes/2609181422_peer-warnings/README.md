# pnpm 12 不严格时 peer 对不上长什么样、怎么读出是哪几处

```
pwsh -File probe.ps1 -Pnpm <npm 全局>\node_modules\pnpm\pnpm.exe -Work <临时目录> -Out runs
```

## 问什么

生态不再开 `strictPeerDependencies`，pnpm 走默认：peer 对不上只 WARN、照装。plugin-manager 要把对不上的那几处
放进回执（agent 只看得到 MCP 回执，看不到 pnpm 的 stdout）。要钉：默认模式下 `pnpm add` 的输出里有没有
「是哪几处」；没有的话从哪读、读出来什么形状、退出码是什么；install 与 update-all（一趟多个精确版本）两条路
是不是一样；home 里本来就有的冲突会不会一起报出来。

## 怎么跑

`probe.ps1` 每个场景新建一个「home」（只有 `package.json` 的空目录，`pnpm install` 一趟当基线），跑一条
不带任何 strict 参数的 `pnpm add`，随后 `pnpm peers check` 与 `pnpm peers check --json` 各一趟，记退出码与
stdout / stderr 全文。真冲突用 registry 上的 `@godcreator/gwb-shell@0.7.2` + `@godcreator/gwb-glm-quota`
（peer 要 shell `>=0.8.0`）；update-all 那条路用 `file:` 本地包造（上游 0.9.0 → 0.10.0，下游 peer `^0.9.0`，
同一趟另升一个不相干的包）。结果：`runs/summary.jsonl` 一行一步，`runs/<步>.stdout.txt` 是原文。
`runs/t-isolated-home.txt` 是 plugin-manager 0.5.0 改完后在隔离 home 里的实机读数（手工，不在脚本里）。

## 结论

- **`pnpm add` 不列是哪几处**：退出码 0，stdout 只有一句 `[WARN] Issues with peer dependencies found. Run "pnpm
  peers check" to list them.`（a-conflict、c-unrelated、d-update-all 的 `1-add`）；不冲突时这句没有（b-clean）
- **`pnpm peers check --json` 给全**：有问题退出码 **1**、没有 **0**，两种都在 stdout 上给同一形状的 JSON：
  `{ ".": { bad: { <peer>: [{ parents: [{ name, version }], optional, wantedRange, foundVersion, resolvedFrom }] },
  missing: {}, conflicts: [], intersections: {} } }`（a-conflict.3、b-clean.3、d-update-all.3）。文字版
  `peers check` 退出码同样 1 / 0，长相跟严格失败那段 `✕ unmet peer` 一样
- **update-all 那条路一样**：一趟多个精确版本，破坏线上游照装、WARN 那一句、`peers check` 点名下游（d-update-all）
- **查的是整棵树**：已带冲突的 home 里装一个不相干的包，WARN 照打，`peers check` 照报原来那处（c-unrelated）
- `missing` 那一格没造出来：`--config.auto-install-peers=false` 下 pnpm 12.4.2 仍把 peer 补上（e-missing，
  `+11`，`missing` 空）
- 实机（`runs/t-isolated-home.txt`）：install / update / update-all 回执都带 `peerWarnings`，装是成了的

## 跑那次的环境

2026-09-18，Windows 11 Pro 10.0.26200 x64；pnpm 12.4.2（npm 全局原生 `pnpm.exe`），用户级 pnpm 配置里
`minimumReleaseAgeExclude` 放行 `@godcreator/*`；registry 为 gitea 个人源。被测对象：gwb-base-plugins
`be6ea20` 之上的 plugin-manager 0.5.0 工作树（隔离 home 部署号 0.5.1-dev.202609181429）。

---
name: gwb-py-cli
description: 要跑这个 home 里登记的 python 命令行工具时读。讲清 venv 守卫的自愈行为、第一次跑为什么慢、回执字段与 node 那半的异同。
---

# python CLI 怎么跑

python 那半跟 node 那半同一个玩法：件在包里带一个 python 项目，登记给 `gwb-py-cli`，
每条登记的 CLI **就是命令总线上的一条命令**，`gwb_cli_run` 按名字调。

## 先看有哪些

`py-cli.list` 回此刻登记的 python CLI：名字、描述、登记它的件。

## 跟 node CLI 一样的地方

- 参数给 `{ "args": [...] }` 或裸数组，**数组不过 shell**，不用转义
- 回执同一套字段：`ok` / `exitCode` / `signal` / `timedOut` / `stdout` / `stderr` /
  `durationMs`；输出只保尾部 64KB，砍过的看 `spillPath`
- 超时杀整棵进程树

## 跟 node CLI 不一样的地方：venv 守卫

python CLI 跑在一个 uv 建的 venv 里。**每次跑之前守卫都过一遍**，幂等：

- venv 已经就绪：三次文件检查、零进程，无感
- venv 被外力抹掉了（重装包就会）：**当场重建**，这条命令不会因此失败，只是这一次慢
- 版本对不上：当场 `uv sync` 对齐

所以**第一次跑一条 python CLI 往往明显慢**（要建 venv、装依赖），不是卡死了——
看回执的 `durationMs`，几十秒都正常。之后再跑就是毫秒级的守卫加上真正的执行。

中文输出不会乱码：跑 python 子进程时强制 `PYTHONUTF8=1`，这是注进去的，不用你管。

## 起不动的时候

`exitCode: null` 且 `timedOut` 为假，多半是 venv 里的可执行文件没出现（建 venv 那步
没成）。原因在 `stderr.text` 里，把它读出来；再跑一次会触发守卫重建，多数自愈。

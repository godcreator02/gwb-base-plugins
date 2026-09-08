---
name: gwb-node-cli
description: 要跑这个 home 里登记的 node 命令行工具时读。讲清 CLI 怎么调、回执里 stdout/stderr/超时/截断这些字段怎么读、长输出去哪找。
---

# node CLI 怎么跑

件把自己编译出来的命令行工具登记给 `gwb-node-cli`，每条登记的 CLI **同时就是命令总线上
的一条命令**——不用单独的工具，`gwb_command_run` 按名字调就是了。

## 先看有哪些

`node-cli.list` 回此刻登记的 CLI：名字、描述、登记它的件。**每条 CLI 的名字就是命令名**，
直接 `gwb_command_run` 传它。

## 怎么传参数

给一串追加参数，两种形状都认：

- `{ "command": "hello.node", "args": ["--flag", "值"] }`
- 或者 `args` 直接给裸数组

**参数全程是数组、不过 shell**——引号、空格、中文原样到达，不用转义，也别自己拼命令行。

## 回执怎么读

回执是一个结构化对象（经信封的 `data`），字段：

- `ok`：退出码 0 且没超时
- `exitCode` / `signal`：怎么收的场。`exitCode: null` 多半是可执行文件本身起不来，
  原因在 `stderr.text` 里
- `timedOut` / `timeoutMs`：超时被杀没有、时限多少。**超时杀的是整棵进程树**，
  孙子进程不会留僵尸
- `stdout` / `stderr`：各一个 `{ text, truncated, spillPath? }`
- `durationMs`：耗时

## 长输出去哪找

stdout/stderr **只保尾部 64KB**。`truncated: true` 说明前面被砍过，全量落在一个临时
文件里，`spillPath` 就是那个路径——要完整输出就去读它（那是宿主机上的路径，
用 `node-cli` 之外的办法拿；通常尾部那 64KB 够判断发生了什么）。

## 第一次跑会慢吗

不会。node CLI 吃的就是编译产物，起进程就跑。第一次慢的是 python 那半（见 gwb-py-cli）。

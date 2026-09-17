---
name: gwb-node-cli
description: 要跑这个 home 里登记的 node 命令行工具时读。讲清 CLI 怎么调、回执里 stdout/stderr/超时/截断这些字段怎么读、长输出去哪找。
---

# node CLI 怎么跑

插件把自己编译出来的命令行工具登记给 `gwb-node-cli`，每条登记的 CLI **同时就是命令总线上
的一条命令**——不用单独的工具：agent 经 MCP 门的 `run` 按名字调，界面走 `window.gwb.command`。

## 先看有哪些

`node-cli.list` 回此刻登记的 CLI：名字、描述、登记它的插件。**每条 CLI 的名字就是命令名**，
直接把它当 `run` 的 `command` 传；参数形状在 `search` 里那条命令的 usage 上。

## 怎么传参数

`args` 两种形状都认：

- 一串追加参数：`{ "command": "hello.node", "args": ["--flag", "值"] }`
- 要按次给工作目录时写成对象：`{ "command": "hello.node", "args": { "args": ["--flag"], "cwd": "D:\\work\\proj" } }`
  ——`cwd` 必须是存在的目录的绝对路径，不合规不起进程，回一句说清要什么的失败原因

**参数全程是数组、不过 shell**——引号、空格、中文原样到达，不用转义，也别自己拼命令行。

## 回执怎么读

回执是一个结构化对象，**自带 `ok`，总线原样透传、不包 `data`**——字段就在顶层：

- `ok`：退出码 0 且没超时
- `exitCode` / `signal`：怎么收的场。`exitCode: null` 多半是可执行文件本身起不来，
  原因在 `stderr.text` 里
- `timedOut` / `timeoutMs`：超时被杀没有、时限多少。**超时杀的是整棵进程树**，
  孙子进程不会留僵尸
- `stdout` / `stderr`：各一个 `{ text, truncated, spillPath? }`
- `durationMs`：耗时

经 MCP 门 `run` 调时摊平成 `ok` / `exitCode` / `timedOut` / `durationMs` / `stdout` / `stderr`
六样（不带 `signal` 与 `timeoutMs`）；进程没成也不是协议错误，退出码与 `stderr` 自己读。`cwd`
不合规那种没起进程的拒绝，门上是 `isError` 的文本。界面 `window.gwb.command` 与服务面
`ctx.gwbNodeCli.run` 拿的是全量。

## 长输出去哪找

stdout/stderr **只保尾部 64KB**。`truncated: true` 说明前面被砍过，全量落在一个临时
文件里，`spillPath` 就是那个路径——要完整输出就去读它（那是宿主机上的路径，
用 `node-cli` 之外的办法拿；通常尾部那 64KB 够判断发生了什么）。

## 第一次跑会慢吗

不会。node CLI 吃的就是编译产物，起进程就跑。第一次慢的是 python 那半（见 gwb-py-cli）。

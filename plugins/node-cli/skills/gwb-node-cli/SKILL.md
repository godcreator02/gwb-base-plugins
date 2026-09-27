---
name: gwb-node-cli
description: 调 node 命令行工具的命令、读它的退出码与输出、输出被截断、在插件里登记 node 命令行工具时读。
---

# node 命令行工具

插件把自己随包带的 js 登记给 `@godcreator/gwb-node-cli`，每条登记就是命令总线上一条同名命令；`gwb-node-cli` 用运行工作台的那个 node 启动它，不经过 shell。

## 运行一条

1. 调 `node-cli.list`（无参数）看有哪些：每条带名字、描述、登记它的插件。名字就是命令名。
2. 准备参数，两种形状都认：
   - 一个数组，追加在登记时的固定参数后面：`["--flag", "值"]`
   - 要指定这一次的工作目录时写成对象：`{ "args": ["--flag"], "cwd": "D:\\work\\proj" }`，`cwd` 是存在的目录的绝对路径

   每个参数写成数组里的一个元素，引号、空格、中文原样到达，不用转义。
3. 调用：`run {"command": "<名字>", "args": <参数>}`。
4. 照「读回执」一节判断结果。

完成的判据：回执 `ok` 为 `true`（退出码 0 且没超时），要的输出已经从 `stdout.text` 里取到。

## 读回执

回执自带 `ok`，总线原样返回，字段在顶层，不在 `data` 里。

1. `ok` 为 `false` 时，按顺序判断：
   - 有 `error`、没有 `exitCode`：没启动进程，`cwd` 不合规（经 MCP 入口是 `isError` 的文本）；照 `error` 改 `cwd` 重调
   - `timedOut` 为 `true`：到了时限，整棵进程树已结束；时限是登记时定的
   - `exitCode` 为 `null` 且没超时：程序没启动起来，原因在 `stderr.text`
   - `exitCode` 不是 0：程序自己报了错，读 `stderr.text`
2. `stdout.truncated` 或 `stderr.truncated` 为 `true`：回执里只有尾部 64,000 字节，完整输出在 `spillPath` 指的文件里（宿主机的临时目录）。尾部通常够判断发生了什么；要全文就读那个文件。

完成的判据：知道了进程成功或失败的原因。

## 在插件里登记

1. 声明依赖：`export const inject = ['gwbNodeCli']`，或 `ctx.inject(['gwbNodeCli'], …)` 局部注入。
2. 算出自己构建出的 js 的绝对路径，比如 `fileURLToPath(new URL('../dist/cli.js', import.meta.url))`。
3. 调 `ctx.gwbNodeCli.register({ name, entry, description, usage?, effect?, args?, cwd?, env?, timeoutMs?, plugin? })`：
   - `name` 不带空白，同时是命令名
   - `entry` 是上一步的绝对路径
   - `description` 必须写：命令总线拒收没有 description 的命令
   - `effect` 按这个工具运行起来的实际后果写 `'read'` / `'write'` / `'external'`（含义见说明书 `gwb-commands`），原样成为总线命令的 `effect`；不写 agent 按 `write` 对待
   - `usage` 不给时自动补上参数形状那一句；`plugin` 不给时取本插件的包名，给了必须就是本插件的包名
   - `timeoutMs` 缺省 60 秒
4. 插件卸载时这条命令自动从表上和命令总线上注销，不用包 `ctx.effect`。
5. js 所在的目录写进 `package.json` 的 `files`。

登记不合规（名字为空或带空白、`entry` 不是绝对路径、时限不是正数或超过上限、没写 `description`、`plugin` 不是本插件的包名、`effect` 不是三个值之一）时 `register` 当场抛错，这条不进表。

完成的判据：`node-cli.list` 里有这一条，`plugin` 是本插件的包名；写了 `effect` 的，`search {"prefix": "<名字>"}` 那一行带着它；`run` 它回 `ok: true`。

## 规矩

- `package.json` 的 `files` 白名单列全：生命周期插件仓 `gwb-lifecycle-plugins` 的 `docs-site/content/docs/rules/deps.mdx`

## 回执字段

| 字段 | 含义 |
| --- | --- |
| `ok` | 退出码 0 且没超时 |
| `exitCode`、`signal` | 退出码与结束信号；`exitCode` 为 `null` 多半是程序没启动起来 |
| `timedOut`、`timeoutMs` | 是否因超时被结束、时限多少毫秒 |
| `stdout`、`stderr` | 各是 `{ text, truncated, spillPath? }` |
| `durationMs` | 耗时 |
| `error` | 只在没启动进程时出现，写明要什么 |

经 MCP 入口 `run` 调时只留 `ok`、`exitCode`、`timedOut`、`durationMs`、`stdout`、`stderr` 六项；页面的 commands 客户端 与服务的 `ctx.gwbNodeCli.run` 拿到全部字段。

---
name: gwb-py-cli
description: 调 python 命令行工具的命令、第一次运行很慢、回执说 venv 没就绪、在插件里登记 python 命令行工具时读。
---

# python 命令行工具

插件把自己随包带的 python 项目登记给 `@godcreator/gwb-py-cli`，每条登记就是命令总线上一条同名命令。参数、回执字段、输出截断都和 node 命令行工具相同，照说明书 `gwb-node-cli` 读；多出来的是 venv：程序运行在登记方包根下的 `py/.venv` 里，每次运行前检查一遍，不对就用 uv 重建。

## 运行一条

1. 调 `py-cli.list`（无参数）看有哪些：每条带名字、描述、登记它的插件。名字就是命令名。
2. 准备参数，形状同 `gwb-node-cli`；不给 `cwd` 时工作目录是登记方包根下的 `py/`。
3. 调用：`run {"command": "<名字>", "args": <参数>}`。
4. 等回执。第一次运行、或登记方插件重新安装之后，要先建 venv、装依赖，可能还要下载 python 解释器，几十秒是正常的（建 venv 的时限是 300 秒）；回执的 `durationMs` 能看出来。之后的运行只多三次文件检查。
5. 回执照 `gwb-node-cli` 的「读回执」判断；是失败回执、原因以 `venv 没就绪` 开头的，转到下一节。

完成的判据：回执 `ok` 为 `true`，要的输出已经从 `stdout.text` 里取到。

## venv 没就绪

venv 建不成时不启动进程，回执是失败回执：总线上 `error` 是 `Error: venv 没就绪，<名字> 无法运行：<原因>`，经 MCP 入口是 `isError` 的文本。按原因处理：

1. `启动不了 uv`：机器上没装 uv 或它不在 PATH 上。让人装好 uv，然后重调（每次运行前都重新检查 venv，不用重新加载插件）。
2. `uv sync 超时`：第一次可能在下载 python 解释器，重调一次。
3. `uv sync 失败`：原因里带着 uv 输出的尾部，多半是登记方的 python 项目有问题（缺 `uv.lock`、依赖装不上）；把原因报告给登记方插件的维护者。
4. `uv sync 运行完了，但 venv 还是不对`：登记时给的 `distName`、`version` 和 `pyproject.toml` 对不上，同样报告给登记方。

venv 就绪但回执 `exitCode` 为 `null`、`timedOut` 为 `false`：程序没启动起来，多半是登记的 `command` 在 `[project.scripts]` 里没有，原因在 `stderr.text`。

完成的判据：重调后 `ok` 为 `true`；或者原因属于登记方，已经报告给人。

## 在插件里登记

1. 在包根的 `py/` 下放 python 项目：`pyproject.toml`、`uv.lock`（重建用 `uv sync --frozen`，没有锁文件就失败）；用 `command` 时 `[project.scripts]` 里要有这个入口点。
2. `package.json` 的 `files` 里写上 `py`。
3. 声明依赖：`export const inject = ['gwbPyCli']`，或 `ctx.inject(['gwbPyCli'], …)` 局部注入。
4. 调 `ctx.gwbPyCli.register({ name, packageRoot, distName, version, command 或 module, description, usage?, args?, cwd?, env?, timeoutMs? })`：
   - `packageRoot` 是包根的绝对路径，比如 `fileURLToPath(new URL('..', import.meta.url))`
   - `distName`、`version` 与 `pyproject.toml` 的项目名、版本一致：检查 venv 时拿它们比对已装的版本
   - `command: 'x'` 运行 `Scripts/x.exe`；`module: 'x.cli'` 运行 `python -m x.cli`；两个只给一个
   - `description` 必须写：命令总线拒收没有 description 的命令，`register` 当场抛错
   - 总线命令的 `plugin` 固定是本插件的包名
5. 插件卸载时这条命令自动注销，不用包 `ctx.effect`。`register` 顺带开始建 venv，不阻塞 `apply`。

完成的判据：`py-cli.list` 里有这一条；`gwb.log` 里 `gwb-py-cli` 写了 `venv 已就绪` 或 `venv 建好了`；`run` 它回 `ok: true`。

## 规矩

- uv、python 这类机器上的外部程序不写进依赖，用的时候检测它在不在：devkit 仓 `docs-site/content/docs/rules/deps.mdx`
- `package.json` 的 `files` 白名单列全：devkit 仓 `docs-site/content/docs/rules/deps.mdx`

## venv 检查参考

三项都满足就跳过，不启动任何进程：`<包根>/py/.venv` 存在；venv 里的 `.gwb-built-for` 记的是这个包根（整个包目录被复制或搬走后对不上）；`Lib/site-packages` 下有 `distName`、`version` 对应的 `dist-info` 目录。任一项不满足就运行 `uv sync --frozen --no-dev --inexact`，同一个包根同时只运行一次。

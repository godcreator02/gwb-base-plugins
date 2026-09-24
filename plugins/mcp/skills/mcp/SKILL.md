---
name: mcp
description: 连接 gwb 工作台的 MCP 入口、MCP 工具调不通或回 401、换 token、没有 MCP 客户端要从命令行调命令时读。
---

# MCP 入口

插件 `@godcreator/gwb-mcp` 在 `http://127.0.0.1:<端口>/mcp` 开一个无状态的 streamable HTTP 入口，只收本机请求，每个请求都要带请求头 `Authorization: Bearer <token>`。default home 的端口固定是 2870；别的 home 的端口由系统分配，记在 `<home>/runtime.json` 的 `mcp` 项里（进程退出后不删，可能过时）。

## 连上一个工作台

1. 取连接片段：调 `mcp.info`（无参数）。还没有能用的 MCP 连接时，在命令行运行 `node <gwb-mcp 包目录>/bin/client.mjs run mcp.info`（default home 不用给任何参数，见「从命令行调命令」）。
2. 回执 `data.mcpServers` 是照抄就能用的片段：`{ "gwb": { "type": "http", "url": "…", "headers": { "Authorization": "Bearer <当前 token>" } } }`。把它写进客户端的 MCP 配置。
3. 重连客户端。
4. 调 `index`。

回执里是明文 token，会进你的会话记录；机器上还有别人看得到会话记录时，先和人确认再调。

完成的判据：`index` 返回了清单，清单里的 `home` 是要连的那个 home 的名字。

## 换 token

1. 调 `mcp.token {"rotate": true}`。回执 `data` 是 `{ token, file, rotated, mcpServers }`，`mcpServers` 片段里已经是新 token；新 token 立即生效。
2. 所有用旧 token 的客户端从此回 401：逐个把新片段写进它们的配置并重连。

完成的判据：每个客户端调 `index` 都成功。

## MCP 工具调不通

按顺序排查，哪一步解决了就停：

1. 工具全灰、调不通：工作台没启动，或这个 home 没装 `gwb-mcp`。启动工作台（开始菜单「gwb-kernel」，或运行 `%LOCALAPPDATA%\Programs\gwb-kernel\gwb-kernel.exe`；从内核源码启动的看 gwb-kernel 仓 AGENTS 的「怎么跑」），然后重连客户端：MCP 连接不会自动接上中途才启动的工作台。
2. 运行 `node <gwb-mcp 包目录>/bin/client.mjs index`。报连不上入口，就看 `<home>\gwb.log` 里 `gwb-mcp` 的那几行：`MCP 门就绪` 带着地址，`没开成` 带着原因。default 的 2870 被别的进程占着时入口不开、也不换端口：让人腾出 2870 再重启这个 home。
3. 回 401：token 没带、对不上，或刚换过。重新取 `mcp.info` 的片段写进配置、重连。`gwb.log` 里 `拒绝了一条请求：…` 那一行写着没过的是 token、`Host` 还是 `Origin` 哪项检查。
4. 回 403：入口只回 401，403 来自中间的代理，让客户端直连 `127.0.0.1`。
5. 返回 `isError` 的文本：入口是通的，是命令自身失败，照说明书 `gwb-commands` 的「命令失败了」处理。
6. 入口这一版本身坏了：修好发下一版，让人在插件窗格点「全部更新」；工作台窗口也打不开时，在 home 目录运行 `pnpm add @godcreator/gwb-mcp@<新版本号>`，再重启这个 home。
7. `plugin-manager.update-all` 升级到 `gwb-mcp` 自己时，进行中的回执会丢、连接断开：重连后用 `plugin-manager.list` 核对 `gwb-mcp` 那条条目的 `active` 为 `true`。

隔离 home 的基础插件集里没有 MCP 入口：对它调命令用 `devkit.cdp`（参数形状用 `search {"prefix": "devkit.cdp"}` 查）。`devkit.cdp` 只对隔离 home 用。

完成的判据：`index` 返回了清单。

## 从命令行调命令

包里带一个零依赖的单文件客户端 `bin/client.mjs`（node ≥18，复制到别处也能运行），同时登记成命令 `mcp.client`。

1. 运行：
   ```
   node <gwb-mcp 包目录>/bin/client.mjs index
   node <gwb-mcp 包目录>/bin/client.mjs search '{"prefix":"skill."}'
   node <gwb-mcp 包目录>/bin/client.mjs run skill.read '{"name":"mcp"}'
   ```
2. 连 default home 不用给参数：地址缺省是 2870，token 自动从 default home 的凭据文件读。连别的 home 要显式给 `--url` 与 `--token`（或环境变量 `GWB_MCP_URL`、`GWB_MCP_TOKEN`）：隔离 home 的端口看 `devkit.home.list` 回执里的 `mcp` 项。其余选项看 `--help`。

完成的判据：标准输出是 JSON 回执，退出码 0；命令失败时照样打印原因，退出码 1。

## 参考

- **工具只有 `index`、`search`、`run` 三个**：MCP 的工具清单是连接时的快照，插件却随时可能重新加载，所以命令一律经 `run` 按名字调，每次调用都查当前的命令表。改这个插件时：加工具、改回执形状或参数语义破坏旧协议，给现有工具加可选参数不破坏；版本号升哪一位照说明书 `gwb-release`
- **token**：每个 home 一份，存在 `<home>/mcp/secret.json`，重启不换

---
name: mcp
description: 要连一台 gwb 工作台的 MCP 门、或工具面为什么只有 index/search/run 三枚、分不清「工具全灰」与 isError 回执是谁的错时读。连接片段、封顶判据与粒度、命令行直调、台没起或门出问题时怎么办。
---

# MCP 门：怎么连一台工作台

无状态 streamableHTTP（每请求一对 server+transport），只绑 127.0.0.1，无鉴权——口不出
本机。default home 认死 `http://127.0.0.1:2870/mcp`；别的 home 端口是系统随机口，从它
`<home>/runtime.json` 的 `mcp` 格查（记录会陈旧：进程退了不删、端口会被下一个进程占走
——**对 home 干活只报名字**，devkit 那几条命令自己查口、自己核对）。

客户端配置串不用手拼：调命令 `mcp.info`，回执里的 `mcpServers` 片段照抄进 `.mcp.json`
（或等价的用户级 MCP 配置）就能连。

连不上就是三件事之一：**台没起**（起法在 gwb-kernel 仓 AGENTS「怎么跑」；起完要重连一次
——MCP 是会话态的，台半路起来不会自动接上）、**这个 home 没装本件**、**配置串不对**
（对答案走 `mcp.info`）。

## 工具面封顶于三枚

`index`（完整地图：全部命令与说明书各带一句话）、`search`（按址取详情与兜底搜索，命中行
带 usage；裸调＝全貌全用法）、`run`（按名调一切命令）。写死在件里，永不再增。为什么封顶：
MCP 的工具清单是**连接时的快照**，而工作台的件以分钟级热重挂为节拍——任何「件登记、门
渲染成顶层工具」的通道都会把快照变成重连债。封顶之后快照里没有会变的东西：命令面的多变
全在 `run` 的参数里，每次调用现打总线。

**封顶的粒度**：加一枚工具是 major 级协议变更；给现有枚加可选参数是 minor（老调用方不
受伤）；改回执形状或参数语义是 major。测试钉着 tools/list 恰好这三枚。

## 渐进式：索引 → 按址取件，搜索是兜底

- `index`（裸调）：地图，约两千 token，每会话第一调
- `search` 裸调：全貌全用法（约八千 token），陌生 home 深度进场一次
- `search {q:"装插件"}` / `{plugin}` / `{prefix:"skill."}`：命中一角带用法——忘了名字才搜
- `run`：动手；读手册正文就是 `run skill.read`（附件地址在正文里，门不投影 files）

命令与手册对称：description 恒是一句话（导航触发文本），命令的长文档住 `usage`，手册的
长文档住 SKILL.md 正文。

## 错误长相

- 工具调用回 isError 的文本 = 命令自身失败（不存在、参数不对）——业务回执，照常往下读
- 全灰、调不通 = 台没起或没装门——先起台，再重连；MCP 没有「下一发请求自动好」
- update-all 升到本件自己时在途回执丢、连接断——重连后用 `plugin-manager.list` 核对

## 命令行直调

随包发了一支零依赖单文件客户端 `bin/client.mjs`（node ≥18，连包都不用装——单文件复制走
也能跑），总线命令 `mcp.client`，给脚本和无 MCP 客户端的环境一个正式入口：

```
node <包>/bin/client.mjs index                          # 拿地图
node <包>/bin/client.mjs search '{"prefix":"skill."}'   # 找用法
node <包>/bin/client.mjs run skill.read '{"name":"mcp"}'
```

门的地址 `--url` > 环境变量 `GWB_MCP_URL` > `http://127.0.0.1:2870/mcp`（隔离 home 的口看
`devkit.home.list` 的 `mcp` 格）。它走的就是这扇门：握手按协议补全，回执约定一致（业务失败
正文照印、退出码 1），输出 JSON 可进管道。测试它不需要 MCP 客户端——一支 node 就够。

## 门出问题时

只有这一扇门，没有第二个入口可装（command-http 已退役，个人源上也从来没有它）。按症状走：

- **门在监听、只是手边的 MCP 客户端用不了**（没有客户端，或会话里工具全灰而台在跑）：用上面
  那支 `bin/client.mjs`——它只要门活着、一支 node 就够，无会话、不认客户端配置
- **门没在监听**（`client.mjs` 报「够不着门」）：看 `<home>\gwb.log` 里 `gwb-mcp` 那一行——
  「MCP 门就绪」带着地址；「没开成」带着原因。default 的 2870 被别的进程占着就是这一支：
  门不退让到别的口，腾开 2870 再重启这个 home
- **门这一版本身坏了**：往前修——修好发下一版，人在插件窗格点「全部更新」升上来（那条路走
  页面、不经门）；窗口也起不来时，在 home 目录 `pnpm add @godcreator/gwb-mcp@<新号>` 再重启
  这个 home（门是挂载时开的）
- **隔离 home**：底座件集里本来就没有门，命令经 `devkit.cdp {"args":["<home 名>","cmd","<命令名>"]}`
  走页面调——只对隔离 home 用，不打 default

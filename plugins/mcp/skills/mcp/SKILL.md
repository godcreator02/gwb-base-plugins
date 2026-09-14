---
name: mcp
description: 要连一台 gwb 工作台的 MCP 门、或工具面为什么只有 index/search/run 三枚、分不清「工具全灰」与 isError 回执是谁的错时读。连接片段、封顶判据与粒度、台没起怎么办。
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

## 逃生门

前一门 command-http 已搁置（default 卸载、registry 留 0.2.2）：MCP 门坏到没救时，手工往
home 装 `@godcreator02/gwb-command-http`（cordis.yml 加条目 + pnpm add + 重启）就有一条
无会话的 curl 道可走。判据见轨迹卡「MCP 复位」的代价段。

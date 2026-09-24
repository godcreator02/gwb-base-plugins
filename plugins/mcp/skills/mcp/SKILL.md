---
name: mcp
description: 要连一个 gwb 工作台的 MCP 入口、想知道为什么工具只有 index/search/run 三个、分不清「工具全灰」与 isError 回执是谁的错、连上了却回 401/403 时读。连接配置片段、token 从哪来、为什么只有三个工具与变更级别、命令行直接调用、工作台没启动或入口出问题时怎么办。
---

# MCP 入口：怎么连一个工作台

无状态 streamableHTTP（每个请求新建一对 server + transport），只绑 127.0.0.1，**要
`Authorization: Bearer <token>`**。只绑回环地址分得开本机与外部网络，分不开本机上的不同
主体——浏览器里的页面、别的 home 的客户端配置、随手写的脚本都能访问 127.0.0.1，而这个
入口后面是完整的命令注册表。**token 每个 home 一份、写在磁盘上、重启不换**，客户端配置
一次就不用再改。

default home 固定是 `http://127.0.0.1:2870/mcp`；别的 home 的端口是系统分配的，从它的
`<home>/runtime.json` 的 `mcp` 项查（记录会过时：进程退出不删、端口会被下一个进程占走
——**对 home 干活只报名字**，devkit 那几条命令自己查端口、自己核对）。

**token 从哪来**：命令 `mcp.info` 回 `{ url, port, mcpServers, auth }`，`mcpServers` 里已经
带好 `headers: { Authorization: 'Bearer <当前 token>' }`，照抄即连，只读不换；要换一份新的用
`mcp.token {"rotate":true}`，它回 `{ token, file, rotated, mcpServers }`，片段形状相同。凭据存在
`<home 数据目录>/mcp/secret.json`；环境变量叫 `GWB_MCP_TOKEN`。两条命令的回执都**含明文凭据、
会进你的会话记录**——机器上还有别人看得到记录时别当众调它们。

连不上就是四种情况之一：**工作台没启动**（开始菜单「gwb-kernel」，或运行
`%LOCALAPPDATA%\Programs\gwb-kernel\gwb-kernel.exe`；从内核源码启动的看 gwb-kernel 仓 AGENTS「怎么跑」；
启动后要重连一次——MCP 连接不会自动接上中途才启动的工作台）、**这个 home 没装本插件**、
**配置里的地址不对**（用 `mcp.info` 核对）、**token 不对或没带**（回 401，日志里那行
`拒绝了一条请求` 会说清是没带还是对不上；刚换过 token 就是这种）。

## 工具只有三个

`index`（全部说明书与命令名的清单：说明书带完整描述、命令按插件分组只列名字）、`search`
（按条件取命令用法，命中的每条带 usage；不带参数返回全部）、`run`（按名字调任何命令）。写死
在插件里，以后也不增加。为什么只有三个：MCP 的工具清单是**连接时的快照**，而工作台的插件
随时可能在运行中重新加载——任何「插件登记、入口把它变成顶层工具」的做法都会让快照过时、
逼客户端重连。只有三个工具之后，快照里没有会变的东西：命令的变化全在 `run` 的参数里，每次
调用都现调命令总线。

**变更的级别**：加一个工具是 major 级协议变更；给现有工具加可选参数是 minor（老调用方不
受影响）；改回执形状或参数语义是 major。测试检查 tools/list 恰好是这三个。

## 先看清单，按名字取详情，搜索是找不到名字时才用

- `index`（不带参数）：每个会话先调一次。说明书名录带**完整 description**（它是触发文本，
  不截断，只有超过 200 字的失控长文会被截断）；命令按插件分组只列名字——名字自己能说明
  用途，参数形状在 search；末尾的 hint 说下一步去哪查。「装了哪些插件」不在清单里（那是
  诊断、开发时才问的，`plugin-manager.list` 现查更准、还带是否启用）。预算 18KB（实测
  default 全部 description 约 16.5KB，最长的几个 description 精简后会回落）
- `search` 不带参数：全部命令的完整用法（约八千 token），第一次进一个陌生 home 时调一次
- `search {q:"装插件"}` / `{plugin}` / `{prefix:"skill."}`：只回命中的几条、带用法——忘了名字才搜
- `run`：执行；读说明书正文就是 `run skill.read`（附件地址写在正文里，入口不列 files）

命令与说明书写法一致：description 是触发文本（写全；命令表的规矩是一句话——把改动记录写进
description 是插件违约，入口上按 200 字截断只防失控长文），命令的长说明写在 `usage`，说明书
的长说明写在 SKILL.md 正文。

**逐字节稳定**：同一个 home、插件没动，index 的回执逐字节一致（分组顺序＝注册表里首次出现的
顺序、没有时间戳）——清单进会话的公共前缀，稳定才能命中输入缓存。回执里保留 instructions
字段：zcode 客户端不显示 initialize 里的 instructions，这个字段是它唯一的入口说明来源。

## 错误长什么样

- 工具调用回 isError 的文本 = 命令自身失败（不存在、参数不对）——这是命令的回执，照常往下读
- 工具全灰、调不通 = 工作台没启动或没装入口——先启动工作台，再重连；MCP 不会「下一个请求自动好」
- **401 = token 这一关没过**（没带、对不上、或刚换过）。401 的正文里写着 token 去哪取；
  `<home>\gwb.log` 里 `gwb-mcp` 那行 `拒绝了一条请求：…` 说清是哪一项检查没过
- **不会出现 403**：入口自己检查，一律回 401；真遇到 403，说明中间多了个不知道的代理
- update-all 升级到本插件自己时，进行中的回执会丢、连接断开——重连后用 `plugin-manager.list` 核对

## 命令行直接调用

随包带一个零依赖的单文件客户端 `bin/client.mjs`（node ≥18，不用装包——把这个文件复制走
也能运行），总线命令 `mcp.client`，给脚本和没有 MCP 客户端的环境用：

```
node <包>/bin/client.mjs index                          # 取清单
node <包>/bin/client.mjs search '{"prefix":"skill."}'   # 找用法
node <包>/bin/client.mjs run skill.read '{"name":"mcp"}'
```

入口地址依次取 `--url`、环境变量 `GWB_MCP_URL`、`http://127.0.0.1:2870/mcp`（隔离 home 的端口
看 `devkit.home.list` 的 `mcp` 项）。**token 自动读取**：依次取 `--token`、环境变量
`GWB_MCP_TOKEN`、default home 的凭据文件——default 的地址与凭据文件位置都是固定的，所以
「什么参数都不给就能用」在加了鉴权之后照样成立；隔离 home 的端口与 token 都不固定，用那两个
参数显式给。它走的就是这个入口：按协议完成握手，回执的约定相同（命令失败照样打印正文、
退出码 1），输出 JSON 可以接管道。测试它不需要 MCP 客户端——有 node 就够。

## 入口出问题时

只有这一个入口，没有第二个可装（command-http 已退役）。按症状处理：

- **入口在监听，只是手边的 MCP 客户端用不了**（没有客户端，或会话里工具全灰而工作台在运行）：
  用上面的 `bin/client.mjs`——它只要入口在监听、有 node 就行，不需要会话、不读客户端配置
- **入口没在监听**（`client.mjs` 报连不上入口）：看 `<home>\gwb.log` 里 `gwb-mcp` 那一行——
  「MCP 门就绪」带着地址；「没开成」带着原因。default 的 2870 被别的进程占着就是这种：
  入口不换端口，腾出 2870 再重启这个 home
- **这一版入口本身坏了**：修好发下一版，人在插件窗格点「全部更新」升级（那条路走页面、
  不经入口）；窗口也打不开时，在 home 目录 `pnpm add @godcreator/gwb-mcp@<新版本号>` 再重启
  这个 home（入口在插件加载时打开）
- **隔离 home**：基础插件集里本来就没有入口，命令经 `devkit.cdp {"args":["<home 名>","cmd","<命令名>"]}`
  走页面调——只对隔离 home 用，不对 default 用

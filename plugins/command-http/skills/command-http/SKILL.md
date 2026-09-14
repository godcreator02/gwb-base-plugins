---
name: command-http
description: 要连一台 gwb 工作台、或 /surface 怎么分层拿不准、分不清 connection refused 与 {"ok":false} 是谁的错时读。分层取法、什么时候必须重新全量、错误长相、为什么无鉴权。
---

# HTTP 门：怎么连一台工作台

无状态 HTTP，只绑 127.0.0.1，无鉴权——口不出本机，出不去。default home 认死
`http://127.0.0.1:2870`；别的 home 端口是系统随机口，从它 `<home>/runtime.json` 的
`command-http` 格查（记录会陈旧：进程退了不删、端口会被下一个进程占走——**对 home 干活
只报名字**，devkit 那几条命令自己查端口、自己核对）。

## 分层取法（渐进披露）

| 层 | 取法 | 大小 | 什么时候用 |
| --- | --- | --- | --- |
| L0 名字索引 | `/surface?slim=true` | 约五百 token | 只想知道这台有什么 |
| L1 定向 | `?plugin=<名>` / `?prefix=<前缀>` / `?q=<词>` | 一段 | 用某条命令前拿参数形状 |
| L2 全量 | `/surface` | 约八千 token | 陌生 home 第一次，建索引 |
| L3 说明书 | `skill.read {"name":"<名>"}` | 一份 | 动手干那类活之前 |
| L4 正本 | 各仓文档站 / 源码 | — | 说明书没讲到的为什么 |

判据：**陌生 home 全量一次就够**，此后 L1 定向；反复全量是坏味道。必须重新全量的时机：
update-all 或热重挂之后怀疑有新命令、换了 home、隔了太久不确定索引新鲜。

## 调命令

`POST /run`，body `{"command": 名字, "args": {...}}`。参数形状只在一处：`/surface` 里那条
命令的描述——门上没有 schema，描述即文档，命令自己校验。

## 错误长相

| 长相 | 谁的错 | 怎么办 |
| --- | --- | --- |
| connection refused | 台没起 | 先起台（正本在内核仓 AGENTS「怎么跑」） |
| `{"ok":false,…}` HTTP 200 | 命令层：名字不对、参数不对 | 照常读 error 字段，那不是门的错 |
| `{"error":"bad json"}` 或 400 | 请求体不是合法 JSON / 缺 command 字段 | 检查 body 形状 |
| `{"error":"not found"}` | 路径写错 | 只有 /surface 与 /run 两条路 |
| 405 | 方法不对 | GET /surface、POST /run |

## 无会话

没有会话：插件热重挂或工作台重启后，下一发请求自动就好，没有「重连」这个动作。升
gwb-command-http 自己时在途请求会断，下一发自动恢复，用 plugin-manager.list 核对。

---
name: onboard
description: 接入或修复 gwb 的 MCP 客户端、把凭据写入 Codex/Claude/ZCode/Kimi 配置、给临时连接设期限时读。连接配置在本地完成，只报告配置位置和验证结果；客户端格式见附件。
---

# onboard：把 gwb 接入 MCP 客户端

gwb 的能力经 MCP 入口进入 agent 会话，但**协议只管到建立连接为止**——客户端侧的 MCP 注册写在客户端自己的配置文件里，
没法随包分发。这份说明写给「新机器上的 agent」：判断依据在这里，客户端格式与操作流程在附件。

## 先判断环境

- **目标客户端与 home**：按用户要求和实际配置确认。目录存在只说明装过该客户端，不能证明这次要配置它；没指定 home 时用 default，并在结果里说明
- **操作系统**：Windows（`%APPDATA%`）/ macOS（`~/Library`）/ Linux（`~/.config`）——default home
  的位置由内核决定，`%APPDATA%\gwb-kernel\homes\default`（Unix 系在内核自己的 dataDir 下）

## MCP 连接配置

先读附件 `skill.read {"name":"onboard","file":"references/mcp-clients.md"}`。它写明四类客户端的配置形状、凭据原文不进入会话的本地写入方法、失败恢复与完成判据。

MCP 插件只管入口和凭据。`mcp.info` 查地址与状态；`mcp.client.issue {"expiresInSeconds":3600}` 签发临时凭据，只回编号与期限；`mcp.client.list/revoke` 查状态和撤销。换主凭据、命令行客户端与 401 排查读 `mcp` 说明书。

配置成功的判据是：文件仍可解析、原有无关配置保留、实际入口 `index.home` 正确，客户端重连后可调用。只写完文件不算接通。

有的客户端（如 zcode）会丢掉 initialize 回执里的 instructions 字段：连上以后先调 `index`，说明书清单与命令清单都在里面。

## 操作原则

- **按已授权范围配置**：用户要求接入、修复或迁移客户端，就包含对应的配置写入；只读诊断不扩大成改全部客户端
- **幂等**：已存在的先读再改，服务已登记、地址与凭据都对就什么都不动
- **装完验证**：重连客户端，调 `index`，核对回执里的 `home` 是目标 home

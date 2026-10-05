---
name: mcp
description: 连接 gwb 工作台、配置 MCP 客户端、签发或撤销临时凭据、换主凭据、排查 401、从命令行按 home 调命令时读。
---

# MCP 入口

插件 `@godcreator/gwb-mcp` 在 `http://127.0.0.1:<端口>/mcp` 开一个无状态的 streamable HTTP 入口，只收本机请求，每次请求都要带 `Authorization: Bearer <token>`。default home 固定用 2870；其他 home 的端口记在 `<home>/runtime.json` 的 `mcp` 项里，进程退出后记录可能过时。

## 配置一个客户端

读 `onboard` 说明书及其 `references/mcp-clients.md` 附件。客户端文件路径、JSON/TOML 形状、合并写入、失败恢复与重连验证由 skill 编排；MCP 插件不修改客户端配置。用户已授权接入时，在本地进程直接读取选定 home 的凭据并写入配置，只报告位置和验证结果。

还没有可用的 MCP 连接时，用本插件 CLI 对选定 home 调命令和读取说明书，见下面「从命令行调命令」。

## 临时客户端凭据

`mcp.client.issue {"expiresInSeconds":3600}` 签发一小时的独立临时 token。有效期必须是 1 到 31536000 的整数；回执只给 `{id,expiresAt}`，原文留在本 home 的凭据库。按编号安装到客户端的做法见 onboard。

临时凭据与主凭据能调用的命令相同，只限制使用时间；MCP 入口每次请求检查到期与撤销状态。签发完成的判据是回执有编号、`mcp.client.list` 中存在该编号；客户端连接完成另按 onboard 验证。

- 查状态：`mcp.client.list`，回 `[{id,expiresAt,expired}]`。
- 提前撤销：`mcp.client.revoke {"id":"<编号>"}`，回 `{id,revoked}`。撤销不删除客户端文件；不存在时 `revoked:false`。
- 接线失败：撤销本次签发的编号，保留原有主凭据和其他临时凭据。回收失败只报告编号，再用 list / revoke 核对并重试。

## 换主凭据

1. 调 `mcp.token {"rotate":true}`，回 `{configured,rotated}`。旧主凭据立即失效。
2. 按 onboard 说明书更新使用主凭据的客户端配置，然后重连。
3. 逐个调 `index` 验证。

独立临时凭据不受主凭据轮换影响，要结束它们用 `mcp.client.revoke`。

`mcp.info` 只查地址与状态，回 `{url,port,auth:{configured}}`；`mcp.token` 无参数只查主凭据状态。经 MCP 或页面调用都不回明文，插件内部调用保留兼容的旧回执。

## 从命令行调命令

包里的 `bin/client.mjs` 是零依赖单文件客户端（node ≥18），也登记成命令 `mcp.client`：

```
node <gwb-mcp 包目录>/bin/client.mjs --home <名字> index
node <gwb-mcp 包目录>/bin/client.mjs --home <名字> search '{"prefix":"skill."}'
node <gwb-mcp 包目录>/bin/client.mjs --home <名字> run skill.read '{"name":"mcp"}'
```

`--home` 默认 `default`，只接受名字。CLI 自动取该 home 的地址与凭据，不从其他 home 继承。显式 `--url` 或 `GWB_MCP_URL` 与该 home 的地址不同时，不自动发送该 home 的 token；需要显式配置凭据的其他服务仍可用 `--token` 或 `GWB_MCP_TOKEN`。其余选项看 `--help`。

完成的判据：标准输出是 JSON 回执，退出码 0。工具失败仍打印原因、退出码 1；参数写错退出码 2。

## MCP 工具调不通

按顺序排查，解决就停：

1. 工具全灰：台没启动，或这个 home 没装 `gwb-mcp`。启动工作台后重连客户端；MCP 连接不会自动接上中途启动的服务。
2. 用上面的 CLI 对目标 home 调 `index`。连不上时查该 home 的 `gwb.log` 中 `gwb-mcp` 的入口就绪或监听失败信息。default 的 2870 被占时不会换端口，要先处理占用再重启。
3. 回 401：主凭据可能已换，临时凭据可能已到期或撤销，也可能没带头。按 onboard 从目标 home 重新配置客户端，再重连；日志中的拒绝原因区分 token、Host 和 Origin。
4. 凭据文件损坏或迁移失败：按日志修复原文件，保留现有凭据；启动不会用新 token 悄悄覆盖坏文件。
5. 回 403：入口只回 401，403 来自中间代理，让客户端直连 `127.0.0.1`。
6. 回 `isError`：入口已通，按正文及 `gwb-commands` 说明书排查。超过 40000 字符时缩小查询范围；写操作已执行的，不因回执过大重复执行。
7. 升级 MCP 插件导致断连：重连后用 `plugin-manager.list` 核对它 `active:true`，再调 `shell.reload` 刷新界面。

隔离 home 的基础插件集没有 MCP 入口；未安装入口时按 `gwb-devkit` 说明书使用 `devkit.cdp`。完成的判据仍是目标入口的 `index` 成功。

## 保管与协议边界

- 每个 home 的主 token 与临时 token 表由 settings 的 secret 项保管，明文落在本 home 的 `credentials.json`。它不加密磁盘，也不隔离有文件读取能力的本机代码。
- 启动会把旧 `<home>/mcp/secret.json` 迁入 settings，确认持久化成功后才删旧文件；主凭据重启不换。凭据的复制、导入、普通随机值生成见 `gwb-settings`，MCP 有效期由本插件执行。
- 工具固定为 `index`、`search`、`run`；命令每次按当前命令表分发，装卸插件后重调 `index`。版本规则见 `gwb-release`。
- initialize 的 instructions 末尾有当前 home、说明书名、命令前缀；预算 2000 字符，超出在日志告警。

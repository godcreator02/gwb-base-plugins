# MCP 客户端接线

用户授权后由 agent 在本地执行。MCP 插件的命令只管令牌，客户端配置格式写在这份说明书里，不另做命令或适配器。

## 1. 定位并检查

选定目标 home、客户端、服务名（默认 `gwb`）和配置文件。检查现有文件时只输出字段名、文件是否存在、目标地址、鉴权是否配置；凭据内容留在本地进程内。路径是常见位置，实际客户端参数和当前文件优先：

| 客户端 | 常见位置 | 服务对象与鉴权位置 |
| --- | --- | --- |
| Codex | `~/.codex/config.toml` | `[mcp_servers.gwb]` 的 `url`；`[mcp_servers.gwb.http_headers]` 的 `Authorization` |
| Claude Code | `~/.claude.json`（用户级）或项目 `.mcp.json` | `mcpServers.gwb` 的 `type:"http"`、`url`、`headers.Authorization` |
| ZCode CLI | `~/.zcode/cli/config.json` | `mcp.servers.gwb` 的 `type:"http"`、`url`、`headers.Authorization` |
| Kimi Code | `~/.kimi-code/mcp.json` | `mcpServers.gwb` 的 `url`、`headers.Authorization`；保留客户端已有受支持字段 |

确认文件语法与实际结构；遇到不同版本的形状，查该客户端当前说明后再改。已有服务指向其他 home 时，应按本次授权决定替换或用另一个服务名，保留其他服务。

完成判据：目标 home、文件、服务名与格式已经确定，源文件可解析；错误只报字段位置，不输出原文件或解析器带出的内容片段。

## 2. 准备凭据

普通长期接入使用现有主令牌，不轮换。需要临时接入时先调用目标 home 的 `mcp.client.issue {"expiresInSeconds":3600}`，保存返回的 `id` 和 `expiresAt`；不要把 `credentials.generate` 的随机值当作已获 MCP 承认的令牌。

没有现成 MCP 连接时可用该 home 的 CLI：

```text
node <gwb-mcp 包目录>/bin/client.mjs --home <home 名> run mcp.client.issue '{"expiresInSeconds":3600}'
```

在本地进程读取 `<home>/runtime.json` 的 `mcp.url` 和 `<home>/credentials.json`，只接受本机 `http://127.0.0.1:<端口>/mcp`。凭据文件要求 `version:1`：

- 主令牌：`sections.mcp.token.value`。
- 临时令牌：解析字符串 `sections.mcp["client-tokens"].value`，按本次 `id` 选唯一记录的 `token`，确认 `expiresAt` 尚未到期。
- 尚未升级且 `credentials.json` 不存在时，主令牌可读同 home 的 `mcp/secret.json` 的 `token`。新文件存在但损坏、槽位缺失或清空时停止，不能回退旧文件或其他 home。

完成判据：本地进程取得唯一有效的值，返回给 agent 的仍只有状态、编号和到期时间。

## 3. 在本地合并并验证

用本地 Python、Node 或 PowerShell 进程把上述值直接写入目标配置。脚本源代码只包含路径与字段名，凭据在执行时读取；不放到脚本字面量、shell 参数、stdout/stderr、diff 或异常摘录中。

1. 在内存保存目标文件原始字节；JSON 接受 BOM 后解析，TOML 使用可用的 TOML 解析工具。生成临时文件并在替换前重新解析。JSON 按表中的对象层级合并；TOML 只修改选定服务的表和头字段，保留其他表、注释与字段。无法可靠保留时停止，不用正则猜整份文件结构。
2. 替换前确认目标文件字节未被其他进程改动；发生并发修改就重新读取、重新合并。以同目录临时文件原子替换，使用限制当前用户读取的文件权限，完成后清理临时文件。
3. 新配置中的 `Authorization` 由本地进程构造为 `Bearer ` 加令牌。在内存比较非目标服务的配置保持原样，检查文件可解析；验证只输出布尔结果和配置路径。
4. 从写好的服务对象取 URL 和鉴权，直接发 initialize、initialized、tools/call index 验证实际连接，核对 `index.home`。只跟本机原 URL 通信，不跟随 HTTP 重定向；回执输出剔除任何鉴权值。
5. 重连目标客户端，在该客户端调用 `index`。若必须由用户点击重连，明确报告“文件和入口验证通过，等待客户端重连”，不能把它称为全部完成。

失败时恢复本次保存的原始字节（原来不存在就删除本次创建的文件）；恢复前同样检查文件未被别人改动。撤销本次新签发的临时令牌 `mcp.client.revoke {"id":"<本次编号>"}`，已有主令牌和其他临时令牌保持原样。回收失败只报告编号，可用 `mcp.client.list` 找回后重试撤销。进程中断留下的临时文件也应按本次路径清理。

完成判据：配置可解析、无关配置保留、入口 home 正确、目标客户端重连成功；报告只给客户端、home、文件、服务名、可选临时编号/期限和验证结果。

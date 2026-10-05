# 按 home 保管凭据的装配验证

## 怎么运行

`node probes/2610051635_home-credentials/verify.mjs settings-credentials-<时间戳> settings-credentials-source-<时间戳>`

先用 `devkit.home.new` 建短名为 `settings-credentials`、`settings-credentials-source` 的两个隔离 home，再用 `devkit.dev` 安装本仓的 settings、mcp，目标 home 再安装 UI 仓的 baseui。脚本零依赖，只接受此命名的 Windows 隔离 home，会替换目标 home 的 MCP 主凭据，临时客户端配置放在该 home 的 `out/credentials-probe/`。来源 home 只读。不要用于日常 home。

## 问什么

真插件加载后，凭据是否只落入本 home 的独立文件，AI 能否不读取明文完成导入、复制、生成、客户端安装和临时凭据撤销。

## 结论

运行结果保存在 `runs/`，只含步骤名与通过状态，不记录任何凭据。独立 home 的新文件、CLI、真实 HTTP 鉴权、跨 home 复制后双方独立性和日志一起验证；迁移中断与写失败由 settings 测试覆盖。

`07-command-split.txt` 验证独立的 `credentials.*` 命令：34 项真实 CLI/HTTP 检查，以及综合设置页的查看、隐藏、保存和清除。更早记录对应拆分前的命令形态，保留为历史证据。

## 运行那次的环境

2026-10-05，Windows，Node.js（具体版本见运行记录），被测代码为本次 home 凭据改动的未提交工作树；基线提交与部署开发版本见运行记录。该基线加本提交可还原被测代码。

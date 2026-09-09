god 工作台（gwb）是一台本机桌面工作台：本体只做插件平台，一切功能皆插件。
一个 home 就是一套独立的世界（插件集、端口、数据各自分家），你连上的是其中一个。

怎么干活：
- 每条登记过的命令都是一枚工具（skill_read、node_cli_list、settings_set……），直接调
- 想一页看全部命令、或调「连接之后新装」的命令：gwb_command_list / gwb_command_run
- 命令失败（不存在、参数不对）回的是 isError 文本，不是协议错误，照常往下读
- 这道口是无状态的，发不出 list_changed：你连着的时候新装、新启的件**不会**长出新的
  顶层工具，用上面那两枚够到它们；要顶层工具刷新得重连

这台工作台鼓励你在干活途中完善它自己——改件、发版、装回 home 都在预期之内。

不用问就能做：
- 修已有命令的 bug
- 补或改件带的 SKILL.md
- 加新命令、加新件

先问人再动手：
- 改内核（gwb-kernel）
- 改这七件被别人 inject 的那一面——commands / data / skills / mcp / shell / settings /
  plugins——服务的方法签名、命令名与参数形状、事件形状，或它们的依赖

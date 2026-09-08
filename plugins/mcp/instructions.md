god 工作台（gwb）是一台本机桌面工作台：本体只做插件平台，一切功能皆插件。
一个 home 就是一套独立的世界（插件集、端口、数据各自分家），你连上的是其中一个。

怎么干活：
- 每条登记过的命令都是一枚工具（skill_read、node_cli_list、settings_set……），直接调
- 想一页看全部命令、或调「连接之后新装」的命令：gwb_command_list / gwb_command_run
- 命令失败（不存在、参数不对）回的是 isError 文本，不是协议错误，照常往下读

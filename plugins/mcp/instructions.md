god 工作台（gwb）是一台本机桌面工作台：本体只做插件平台，一切功能皆插件。
一个 home 就是一套独立的世界（插件集、端口、数据各自分家），你连上的是其中一个。

怎么干活：
- 连上先调 gwb_command_list 与 skill_list 各一次：命令面与说明书都以这两条回执为准
- 动手前用 skill_read（或 resources 里的 skill://gwb/<名>/SKILL.md）读对得上手头活的那份
- 参数怎么给看命令的描述；除顶层那几枚，其余一律经 gwb_command_run 按名调
- 命令失败（不存在、参数不对）回的是 isError 文本，不是协议错误，照常往下读
- 顶层工具清单在你连着时不刷新（这道口无状态，发不出 list_changed）：新装的件经 gwb_command_run 够到

这台工作台鼓励你在干活途中完善它自己——改件、发版、装回 home 都在预期之内。
不用问就能做：
- 修已有命令的 bug
- 补或改件带的 SKILL.md
- 加新命令、加新件
先问人再动手：
- 改内核（gwb-kernel）
- 改这七件被别人 inject 的那一面——commands / data / skills / mcp / shell / settings /
  plugins——服务的方法签名、命令名与参数形状、事件形状，或它们的依赖
- 给命令标 top: true——要上顶层就在登记时标它，桥照它渲染；标之前停下来问人

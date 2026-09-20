god 工作台（gwb）是一台本机桌面工作台：本体只做插件平台，一切功能皆插件。
一个 home 就是一套独立的世界（插件集、端口、数据各自分家），你连上的是其中一个。

怎么干活：
- 连上先调 index：完整地图——说明书名录带完整描述（触发文本）、命令按件分组只报名字
  （参数形状在 search），尾部 hint 指路，一次就够
- 要详情、找东西用 search：裸调＝不过滤＝全貌全用法（约八千 token，陌生 home 深度进场一次）；
  带 plugin / prefix / q 只回命中的一角，命令行带完整用法——参数形状就在 usage 里
- 一切命令经 run 按名调：{"command": 名字, "args": {...}}；参数怎么给看 search 里那条命令的
  usage，命令自己校验。读说明书就是 run 调 skill.read
- **命令表与说明书表靠 `plugin`（包名）对得上**：命令按包名分组、说明书带挂它的件——
  按包名筛（search 的 plugin 格）就能拿全一个件的命令与说明书；装了哪些件（含没有命令的
  纯界面件）问 plugin-manager.list
- 命令失败（不存在、参数不对）回的是 isError 的文本，不是协议错误——照常往下读，连接不断
- **default 是控制台，隔离 home 是现场**：对现场干活只报名字（devkit 那几条自己查口验活），
  别拿 default 验东西、试东西
- gwb 线的源码仓住在单元容器根的各单元里（这台机器是 D:\unitfolders）——清单与各仓落点
  现扫 unit-folder.list，出生证是各单元的 unit.json
- 工具面封顶于 index / search / run 三枚，永不再增：新装的件不长新工具，它的命令经 run
  够到——别在工具清单里干等

这些工具连不上（全灰、调不通）就是台没起或这个 home 没装门：先把台起起来（开始菜单
「gwb-kernel」，或跑 %LOCALAPPDATA%\Programs\gwb-kernel\gwb-kernel.exe；从内核源码起的看
gwb-kernel 仓 AGENTS「怎么跑」），起完重连一次——MCP 是会话态的，台半路起来不会自动接上。

这台工作台鼓励你在干活途中完善它自己——改件、发版、装回 home 都在预期之内。
发完新版本调 plugin-manager.update-all 一键热升（不重启）；升到 mcp 自己时这条回执会丢、
连接断在半路——重连后用 plugin-manager.list 核对。
不用问就能做：
- 修已有命令的 bug
- 补或改件带的 SKILL.md
- 加新命令、加新件
先问人再动手：
- 改内核（gwb-kernel）
- 改这些件被别人 inject 的那一面——commands / data / skills / mcp / settings /
  logger / plugin-manager（原 plugins，2026-09-12 断代改名）与 UI 平台仓的
  shell——服务的方法签名、命令名与参数形状，事件形状，或它们的依赖
- 破 index / search / run 这个封顶——加一枚是 major 级协议变更，给现有枚加可选参数是
  minor，改回执形状是 major

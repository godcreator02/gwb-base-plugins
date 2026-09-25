god 工作台（gwb）是一台本机桌面工作台：本体只提供插件平台，所有功能都由插件实现。
一个 home 就是一套独立的环境（插件、端口、数据各自独立），你连上的是其中一个。

怎么用：
- 连上后先调 index：返回全部说明书（带完整描述，即触发条件）和按插件分组的全部命令名
  （参数形状在 search 里），末尾的 hint 说明下一步去哪查，调一次就够
- 要详情、找东西用 search：不带参数就返回全部内容与完整用法（约八千 token，第一次接触一个 home 时调一次）；
  带 plugin / prefix / q 只返回匹配的部分，每条命令带完整用法，参数形状就在 usage 里
- 所有命令都经 run 按名字调用：{"command": 名字, "args": {...}}；参数怎么给看 search 里那条命令的
  usage，命令自己校验。读说明书就是用 run 调 skill.read
- **命令和说明书靠 `plugin`（包名）对应**：命令按包名分组，说明书带着它所属的插件——
  按包名过滤（search 的 plugin 参数）就能拿到一个插件的全部命令与说明书；装了哪些插件（包括
  没有命令的纯界面插件）问 plugin-manager.list
- 命令失败（不存在、参数不对）返回的是 isError 的文本，不是协议错误——照常读下去，连接不会断
- **default 是日常使用的 home，隔离 home 用来验证**：在隔离 home 上操作时只报它的名字（devkit 那几条命令
  会自己检查它是否在运行），别在 default 上验证、试东西
- MCP 工具只有 index / search / run 三个，以后也不会增加：新装的插件不会多出新工具，它的命令经 run
  调用——别等工具清单里出现新工具

这些工具连不上（全是灰的、调不通）就是工作台没启动，或者这个 home 没装 MCP 插件：先启动工作台
（开始菜单「gwb-kernel」，或运行 %LOCALAPPDATA%\Programs\gwb-kernel\gwb-kernel.exe；从内核源码启动的
看 gwb-kernel 仓 AGENTS 的「怎么跑」），启动后重连一次——MCP 连接不会自动接上中途才启动的工作台。

这台工作台鼓励你在工作中改进它自己——改插件、发版、重新装进 home 都在预期之内。
发完新版本调 plugin-manager.update {"all":true} 升级全部插件（不重启），升完调 shell.reload 刷新界面；
升级到 mcp 插件自己时，这次调用的返回会丢失、连接中途断开——重连后用 plugin-manager.list 核对，再调 shell.reload。
不用问就能做：
- 修已有命令的 bug
- 补充或修改插件自带的 SKILL.md
- 加新命令、加新插件
先问人再动手：
- 改内核（gwb-kernel）
- 改这些插件提供给别的插件 inject 的服务——commands / data / skills / mcp / settings /
  logger / plugin-manager（原名 plugins，2026-09-12 改名）与 UI 平台仓的
  shell——服务的方法签名、命令名与参数形状、事件形状，或它们的依赖
- 改变 index / search / run 这三个工具：加一个工具是 major 级协议变更，给现有工具加可选参数是
  minor，改返回形状是 major

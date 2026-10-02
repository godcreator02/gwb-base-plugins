god 工作台（gwb）是一台本机桌面工作台：本体只提供插件平台，所有功能都由插件实现。
一个 home 是一套独立的环境（插件、端口、数据各自独立）；default 日常用，隔离 home 用来验证，别在 default 上试东西。

MCP 工具只有 index / search / run 三个，装新插件也不会增加；客户端延迟加载工具的，三个一起加载。
- index：全部说明书（名字与描述，描述就是什么时候该读）和按插件分组的命令名
- search：按 plugin（包名）、prefix（命令名前缀）、q（子串）、effect 筛，命中的命令带 usage（参数形状）与 effect。
  总是带条件：不带就是全部，会超过单次返回的上限
- run：{"command": 名字, "args": {...}}；读说明书是 run skill.read {"name": 名字}
effect 说明命令会动到什么：read 只读，可以直接调；write 改本机的文件、设置、数据或界面；
external 影响本机以外或打扰人（推送、发到远端、弹窗）。每条命令都标了 effect；write 与 external 的调之前先读 usage。
命令失败、返回超过 40000 字符，都回 isError 的文本并写明怎么办，连接不断。

这台工作台鼓励你在工作中改进它：修命令的 bug、改插件自带的 SKILL.md、加命令、加插件都不用问。
发完新版本调 plugin-manager.update {"all":true}，再调 shell.reload；升到 mcp 插件自己时连接会断，
重连后用 plugin-manager.list 核对。
先问人再动手：改内核（gwb-kernel）；改 commands / data / skills / mcp / settings / plugin-manager / shell
这些给别的插件 inject 的服务（方法签名、命令名与参数、事件形状、依赖）；改 index / search / run 三个工具。

目录里有说明书 zcode 时：能写清范围的活（批量迁移、批量改代码）可以派给本机的 ZCode 去做、省自己的额度，先读 zcode。

god 工作台（gwb）是一台本机桌面工作台：本体只做插件平台，一切功能皆插件。
一个 home 就是一套独立的世界（插件集、端口、数据各自分家），你连上的是其中一个。

怎么干活：
- 先 GET /surface 一遍：命令面与说明书以那条回执为准——它每次现拼，装了新件下一次 GET 就包含。全量约八千 token：陌生 home 全量一次就够，此后定向取
- 过滤与瘦身：`?plugin=<插件名>` 按登记插件筛、`?prefix=<前缀>` 按命令名筛、`?q=<词>` 在名字与描述里找、`?slim=true` 只要名字索引（约五百 token）——反复全量是坏味道
- 调命令一律 POST /run，body 是 `{"command": 名字, "args": {...}}`；参数怎么给看 /surface 里那条命令的描述，命令自己校验
- 读说明书走同一条 /run：skill.list 列有哪些、skill.read 读正文，参数形状看它们在 /surface 里的描述
- 命令自身失败（不存在、参数不对）回的是 `{"ok":false,…}` 的 JSON，HTTP 状态仍是 200——照常往下读，那不是门的错
- 这道门没有会话：本件热重挂或工作台重启后，下一个请求自动就好——不用重连，重发即可
- 台没起时 curl 直接 connection refused，先把台起起来再调

这台工作台鼓励你在干活途中完善它自己——改件、发版、装回 home 都在预期之内。
发完新版本调 plugin-manager.update-all 一键热升（不重启）；升到 gwb-command-http 自己时在途请求会断，
下一个请求自动恢复，用 plugin-manager.list 核对。
不用问就能做：
- 修已有命令的 bug
- 补或改件带的 SKILL.md
- 加新命令、加新件
先问人再动手：
- 改内核（gwb-kernel）
- 改这些件被别人 inject 的那一面——commands / data / skills / command-http / settings /
  logger / plugin-manager（原 plugins，2026-09-12 断代改名）与 UI 平台仓的
  shell——服务的方法签名、命令名与参数形状、事件形状，或它们的依赖
- 给命令标 top: true——那是给将来门面留的位；这道门只是如实带出这个标记，标之前先问人

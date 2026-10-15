---
name: gwb-settings
description: 读改设置、查凭据状态、不回显地复制导入生成凭据、在插件里声明设置项或一组设置时读。
---

# 设置与凭据

每个 home 独立保存：普通值与声明在 `<home>/settings.json`，secret 值以明文放在 `<home>/credentials.json`。不继承 default，不自动读取别的 home。插件内部照常取用凭据；日常管理用不回显的命令完成，凭据不必经过聊天。

## 找到设置位置

1. 普通设置调 `settings.all`，凭据调 `credentials.list`；知道插件时带 `{"section":"<分区>"}`，避免取全部条目。分区是插件条目 id 的末段，`shared` 项是 `*`。
2. 按 `title`、`description`、`key` 找到目标，记下 `section` 与 `key`。`live:false` 表示插件此刻没有声明它。
3. 读普通项用 `settings.get`；没保存值时 MCP 回 `null`，声明中的 `default` 在 `settings.all` 那行。凭据查 `credentials.status`；`settings.get/set/delete` 遇到 secret 会报错并指向凭据命令。

完成的判据：位置与用途明确；要写凭据的目标是 `live:true`、`type:"secret"`。

## 管理凭据

先用 `search {"prefix":"credentials."}` 查当前用法。已经授权的凭据配置、复制、生成和使用，可以由工具在本机内部完成，不要为每个内部读取步骤再次索要同意，也不要先把旧凭据读进会话。

| 要做什么 | 使用的命令 |
| --- | --- |
| 查是否配置 | `credentials.status {section,key}`，或 `credentials.list` 的 `isSet` |
| 复制已有凭据 | `credentials.copy {from:{home?,section,key},to:{section,key},overwrite?}` |
| 从指定本机文件导入 | `credentials.import {from:{file,format:"text"\|"json",path?},to:{section,key},overwrite?}` |
| 生成随机值并保存 | `credentials.generate {to:{section,key},bytes?,overwrite?}` |
| 清除值 | `credentials.delete {section,key}` |

复制、导入、生成只返回目标状态，目标必须是当前 home 已启用插件声明的 secret；已有值需显式 `overwrite:true`。复制来源只读，`from.home` 不给就是当前 home，给了只能是同级 home 名。**在哪个 home 调用，就写哪个 home**；复制后各自配置、修改不同步。同一个远端 token 被复制两份后，服务端撤销仍会同时影响两边。

导入的 `file` 必须是绝对路径。JSON 用 `path` 字段数组精确选中字符串；text 去掉一个末尾换行。不要先读取文件正文再把密钥填进工具参数。人首次输入可用本地设置界面；`credentials.set {section,key,value}` 与眼睛按钮的 `credentials.reveal {section,key}` 只供本地界面和插件使用，隐藏于 agent 清单，MCP 不能调用。

`credentials.generate` **只生成随机字符串**，不签发第三方 token，也不赋予有效期。临时 MCP 凭据用 MCP 插件的 `mcp.client.issue` 签发，客户端接线读 `onboard` 说明书；其他服务的签发与撤销由对应插件处理。

完成的判据：目标 `isSet` 符合预期，再通过使用它的插件做认证检查。`isSet:true` 只代表保存过值，不能当成认证成功。

## 修改普通设置

1. 按位置调 `settings.set {section,key,value}`；按声明类型给值：`string`、`number`、`boolean`、`string-list`。清除普通设置用 `settings.delete {section,key}`。
2. 删除值后声明保留，插件内部 `get` 回到 `default`。
3. 增删一份实例就是改组名那一项的名单：`settings.set {section,key:"<组>",value:["deepseek","kimi"]}`，实例名一律 kebab-case、不重复，不合规整次拒绝。新实例的各字段随即出现在列表里（键 `<组>.<实例>.<字段>`），按位置写普通字段、用 `credentials.*` 写 secret 字段；去掉的实例值留着，成为 `live:false` 的项，要清就按位置删。
4. `description` 写了重启生效的，完成后重启指定 home。

完成的判据：普通项 `settings.get` 回新值，或删除后回 `null`；凭据只查状态并做业务验证。

## 在插件里声明与取用

1. 注入 `gwbSettings`，在 `apply` 中 `define({key,title,type,description?,default?,shared?})`；key 用 kebab-case，title 不为空。
2. `get(key)` 同步取值，没有值时回 `default`；没声明过的 key 去公共区 `*` 找。`set`、`delete` 只能操作自己声明过的项。普通值由消费插件校验类型。
3. secret 仍声明 `type:'secret'`，服务内部 `get/set/delete` 保持取值与读写能力，写入只接受字符串。插件不用另管文件或引用；跨插件按位置取用走内部 `credentials.reveal`，`settings.get` 对插件来源也拒绝 secret。不要把取到的值拼进回执、异常或日志。
4. 份数不定、字段相同的配置（如多份模型，每份是模型名、请求地址、token）用一组设置：`defineGroup({key,title,description?,fields:[{key,title,type,description?,default?},…]})`。组名那一项存实例名单，名单里每个实例的每个字段由设置插件声明成 `<组>.<实例>.<字段>`；用时调 `getGroup(key)` 现读，按名单顺序回 `[{name,values}]`，没值回 `default`，secret 回明文。名单变化不发事件，别缓存结果。组键、字段键用 kebab-case，组不能 `shared`。
5. 只需要本 home 内共享的项才写 `shared:true`；它不代表跨 home 共享。
6. `cordis.yml` 条目写固定 `id`，分区取 id 末段。分区归属冲突时先停止该 home，再核对 `settings.json` 顶层 `$owners`；迁移分区要同时处理两份文件中的对应分区，不能只移动普通设置。

完成的判据：普通设置在 `settings.all`、凭据在 `credentials.list` 有目标行且 `live:true`，插件能使用它；MCP 的凭据命令只拿状态。

## 存储边界

- 旧 `settings.json` 中的 secret 值在下次成功持久化时迁入 `credentials.json`。
- 两个文件各自原子替换，**不是跨文件事务**。先写凭据，再写元信息；删除记录阻止中断后旧凭据复活。文件损坏时报错并保留，不能当成空文件覆盖。
- 磁盘没有加密；同用户本机代码仍可读文件。这套机制避免日常工具流程回显凭据，不提供本机代码隔离。
- 插件配置一律通过 `define`，不使用 `cordis.yml` 条目的 `config`；其他业务数据用 gwb-data。

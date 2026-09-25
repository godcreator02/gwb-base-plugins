---
name: gwb-commands
description: 调命令、读回执、命令失败、装卸插件后命令对不上、在插件里登记命令时读。
---

# 命令总线

插件把能力登记成命令，页面、agent、别的插件都经同一张命令表按名字调用。命令总线由 `@godcreator/gwb-commands` 提供（服务 `ctx.gwbCommands`）。

## 调一条命令

1. 在 MCP 入口 `index` 的 `commands` 里找到命令名，命令按登记它的插件包名分组。
2. 取参数形状：`search {"prefix": "<命令名>"}` 或 `search {"plugin": "<包名>"}`，命中的那条命令的 `usage` 里写着参数形状。
3. 调用：
   - agent 经 MCP 入口：`run {"command": "<命令名>", "args": {…}}`
   - 页面：`window.gwb.command("<命令名>", 参数)`
   - 插件：`await ctx.gwbCommands.run("<命令名>", 参数)`
4. 照「读回执」一节取值。

完成的判据：回执 `ok` 为 `true`，要的值已经从回执里取到。

## 读回执

1. 先看 `ok`。`false` 就转到「命令失败了」一节。
2. `ok` 为 `true`：值在 `data` 里，取值要往 `data` 里再走一层。
3. 回执顶层除了 `ok`、`data`、`error` 还有别的字段：这是处理函数自己返回的带 `ok` 的对象，总线原样返回，字段就在顶层，按那条命令的 `usage` 读。命令行工具的命令都是这种（字段见说明书 `gwb-node-cli`）。
4. 经 MCP 入口 `run` 时回执转成文本，对应关系见「回执参考」。

完成的判据：拿到了要的字段值，或拿到了失败原因的文本。

## 命令失败了

失败都不是协议错误：总线上是 `ok: false`，MCP 入口上是 `isError` 的文本，连接不断。按原因文本判断是哪种：

1. `没有这条命令：<命令名>`：重新调 `index` 核对名字；清单里确实没有，调 `plugin-manager.list` 看登记这条命令的插件在不在、那条条目的 `active` 是不是 `true`。
2. 参数不对：原因里写着要什么形状；照 `search` 里那条命令的 `usage` 改参数，重调。
3. 业务上没成功（处理函数执行了，结果是失败）：照原因改参数或先补上前置条件，重调。

完成的判据：重调后 `ok` 为 `true`；或者确认插件没装、`active` 为 `false`，把这一点报告给人。

## 装、卸、升级插件之后

1. 调过任何 `plugin-manager.*` 命令之后，重新调一次 `index`。命令表随装了哪些插件而变，`index` 每次调用都按当前命令表重新生成。
2. 新命令一律经 `run` 调；MCP 入口的工具只有 `index`、`search`、`run` 三个，装插件不会增加工具。

完成的判据：新的 `index` 里，那个插件包名下出现（或消失）了预期的命令。

## 在插件里登记命令

1. 声明依赖：命令是插件的必需部分，写 `export const inject = ['gwbCommands']`；可有可无，用 `ctx.inject(['gwbCommands'], (ctx) => { … })` 局部注入。
2. 调 `ctx.gwbCommands.register(def, handler)`，`def` 三项必写、都是非空字符串：
   - `name`：`<插件短名>.<动作>`，登记前用 `search {"q": "<名字>"}` 确认没有重名（同名时后登记的生效并写告警）
   - `description`：一句话说命令做什么，出现在 `index` 里
   - `usage`：参数形状与注意事项，无参数写「无参数」，只在 `search` 命中时返回

   `plugin` 不用写：命令总线从调用方的 cordis 条目取包名。写了就必须是本插件的包名。
3. 写 `handler`：自己校验参数，不对就抛错，错误文本写清要什么形状；返回普通值，总线把它包进 `data`。只有要让字段出现在回执顶层时，才返回带 `ok` 的对象。`handler` 的第二个参数是 `{ via }`：请求来自页面是 `ui`，来自 MCP 入口是 `mcp`，别的插件直接调是 `plugin`；要按来源记录或区分行为时读它，总线不按它限制谁能调。
4. 注销：`register` 把注销登记在调用方的 `effect` 上，插件卸载时命令自动注销，直接调用即可；返回的注销函数只在要提前注销时用。

`register` 当场抛错、命令不进表的情况：三项里缺一项或为空串；`plugin` 与本插件的包名不同；调用方不是经 `cordis.yml` 加载的插件，取不到包名。错误文本写明哪个包、哪条命令、缺什么。

完成的判据：重新加载插件后，`index` 里本插件包名下有这条命令，`run` 它回 `ok: true`；停用插件后 `index` 里没有它。

## 规矩

- 扩展点用服务，数据读写和动作用命令，同一能力只提供一种调用方式：生命周期插件仓 `gwb-lifecycle-plugins` 的 `docs-site/content/docs/rules/services.mdx`
- 登记命令时参数形状写进 `usage`，无参数写「无参数」：`gwb-lifecycle-plugins` 仓 `docs-site/content/docs/rules/services.mdx`
- 调别的插件的能力只经服务和命令，调命令只写命令名、不 import 提供方的常量：`gwb-lifecycle-plugins` 仓 `docs-site/content/docs/rules/interaction.mdx`

## 回执参考

| 处理函数的结果 | 总线回执（`ctx.gwbCommands.run`、`window.gwb.command`） | MCP 入口 `run` 返回的文本 |
| --- | --- | --- |
| 返回普通值 `v` | `{ "ok": true, "data": v }` | `{ "ok": true, "data": v }` 的 JSON，`v` 是 `undefined` 时写成 `null` |
| 返回带 `ok` 且有别的字段的对象 | 原样返回 | 原样的 JSON；命令行工具的回执只留 `ok`、`exitCode`、`timedOut`、`durationMs`、`stdout`、`stderr` |
| 返回 `{ ok: false, error }` | 原样返回 | `isError` 的文本 `执行失败：<error>` |
| 抛错 | `{ "ok": false, "error": "<异常文本>" }` | `isError` 的文本 `执行失败：<异常文本>` |
| 没有这条命令 | `{ "ok": false, "error": "没有这条命令：<命令名>" }` | `isError` 的文本 `执行失败：没有这条命令：<命令名>` |

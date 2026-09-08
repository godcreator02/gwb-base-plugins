# 常见命令

**这份是参考不是清单**。以 `gwb_command_list` 的实时回执为准——下面这些来自哪个件，
那个件没装或没挂上，对应的命令就不在。

## 内核自己一条都没有

内核不认识任何命令名——`gwb:command` 收到什么就原样派给 `ctx.gwbCommands`，没装总线件
就是一句「认不出」。所以下面每一条都来自某个件。

摸不清状况时先问 `plugins.list`：它把 home 里装了哪些包、各自在 `cordis.yml` 里有哪些
条目、每条挂上没有（`active`）一次说清。

## 件带来的

| 命令 | 来自 | 回什么 |
| --- | --- | --- |
| `plugins.list` | `gwb-plugins` | home 里装了哪些包，各自有哪些条目、启用没有、active 没有 |
| `plugins.install` | `gwb-plugins` | pnpm add 一个包进 home，再自动加一条条目（默认启用），回 `entryId` |
| `plugins.add-entry` / `plugins.remove-entry` | `gwb-plugins` | 给已装的包加/删条目。删条目**不删包**，没有卸载 |
| `plugins.enable` / `plugins.disable` | `gwb-plugins` | 启用/停用一条条目，`{ "entryId": "..." }` |
| `plugins.set-label` | `gwb-plugins` | 改条目的显示名，空串是抹掉 |
| `plugins.shared` | `gwb-plugins` | home 里哪些包是共享包（清单里声明了 `gwb.shared`），各自提供哪些裸名 |
| `shell.env` | `gwb-shell` | 外壳浏览器半开机要的环境：home 目录与三张样式表的 `file://` 地址 |
| `logger.backlog` / `logger.where` | `gwb-logger` | 日志历史段；日志落在哪（home 与 `gwb.log`） |
| `settings.all` / `settings.get` / `settings.set` | `gwb-settings` | 设置的读与写，位置是 `{ scope, section, key }` |
| `skill.list` / `skill.read` | `gwb-skills` | 此刻挂着的说明书；读正文传 `{ name, file? }` |
| `mcp.info` | `gwb-mcp` | 这道口自己的连接串（url + 端口 + token） |
| `shell.panes` / `shell.plugins` | `gwb-shell` | 此刻注册了哪些窗格；哪些件报过自己的名字 |
| `node-cli.list` / `py-cli.list` | 两个运行器 | 登记了哪些 node / python CLI |

另外，登记给两个运行器的每条 CLI **自己就是一条总线命令**（比如 hello 件的
`hello.node`），按名字直接调；参数给 `{ "args": [...] }`。它们的玩法见各自的 skill。

## 读回执的姿势

命令回的是信封：

```json
{ "ok": true, "data": { "count": 2, "skills": [] } }
```

失败长这样，`ok` 是 false、原因在 `error`：

```json
{ "ok": false, "error": "没有这条命令：nope" }
```

`gwb_command_run` 会把这个信封原样交给你（失败时另外把 `isError` 打上）。
**别在 `data` 之外找字段。**

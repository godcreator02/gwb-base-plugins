# 常见命令

**这份是参考不是清单**。以 `gwb_cli_list` 的实时回执为准——下面这些来自哪个件，
那个件没装或没挂上，对应的命令就不在。

## 内核自带的两条

内核本体只认这两条，它们不经命令总线、任何 home 都有：

| 命令 | 参数 | 回什么 |
| --- | --- | --- |
| `kernel.info` | 无 | `pid` / `node` 版本 / `dataDir`（这个 home 的目录）/ `appVersion` / 条目表 / importmap 声明 |
| `kernel.install` | `{ specs: string[] }` | 把包装进这个 home。**装了不等于挂上**——要生效还得往条目表里加一条 |

摸不清状况时先问 `kernel.info`：它的 `entries` 一栏就是「此刻有哪些件、挂上没有」。

## 件带来的

| 命令 | 来自 | 回什么 |
| --- | --- | --- |
| `skill.list` | `gwb-skills` | 此刻挂着的说明书（名字 + 描述 + 挂它的件） |
| `mcp.info` | `gwb-mcp` | 这道口自己的连接串（url + 端口 + token） |
| `shell.panes` | `gwb-shell` | 此刻注册了哪些窗格 |
| `shell.plugins` | `gwb-shell` | 此刻有哪些件报过自己的名字 |

## 读回执的姿势

命令回的是信封：

```json
{ "ok": true, "data": { "count": 2, "skills": [] } }
```

失败长这样，`ok` 是 false、原因在 `error`：

```json
{ "ok": false, "error": "没有这条命令：nope" }
```

`gwb_cli_run` 会把这个信封原样交给你（失败时另外把 `isError` 打上）。
**别在 `data` 之外找字段。**

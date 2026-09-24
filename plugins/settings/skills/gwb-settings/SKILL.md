---
name: gwb-settings
description: 读设置、改设置、查凭据配没配、在插件里声明设置项时读。
---

# 设置

设置项由插件声明，一个 home 的全部值存在 `<home>/settings.json` 一份文件里，按分区存放。四条命令 `settings.all`、`settings.get`、`settings.set`、`settings.delete` 按「分区 + 键」定位，能读写任何分区。

## 找到一项设置的位置

1. 调 `settings.all`（无参数），回执 `data` 是全部设置项的数组。
2. 按 `title`、`description`、`key` 找到要的那一行，记下它的 `section` 与 `key`。
3. 看这一行的 `live`：`false` 表示此刻没有插件声明它（插件停用或卸载了），改了也没有插件读。

完成的判据：拿到了 `section` 与 `key`，并且这一行 `live` 为 `true`。

## 读一项

1. 先完成「找到一项设置的位置」。
2. 调 `settings.get {"section": "…", "key": "…"}`，值在回执的 `data` 里；secret 项也回明文。
3. `data` 是 `null`：这一项没设过值，生效的是 `settings.all` 那一行的 `default`（`settings.get` 只回存下的值，不回 `default`）。

完成的判据：拿到了值，或确认没设过值并知道生效的默认值。

## 查凭据配没配

1. 在 `settings.all` 里找到那一行，它带 `secret: true`。
2. 读 `isSet`：`true` 是设过值。secret 行没有 `value` 和 `default`；`mask` 是定长的 `••••`，推不出真值的长度。

只要判断配没配，用 `isSet`；`settings.get` 回的明文会进会话记录。

完成的判据：读到了这一行的 `isSet`。

## 改一项

1. 先完成「找到一项设置的位置」。
2. 调 `settings.get` 记下旧值：日志只记「哪一项已写」，不记值，改错了只能靠这份旧值恢复。
3. 调 `settings.set {"section": "…", "key": "…", "value": …}`，立即写进文件。`value` 的类型照那一行的 `type` 给：`string`、`number`、`boolean`，`secret` 给字符串，`string-list` 给字符串数组。设置插件不校验类型，类型给错了，读它的插件读到的就是错的值。
4. 要抹掉值、回到默认值：调 `settings.delete {"section": "…", "key": "…"}`，声明留着。
5. 看这一行的 `description`：写了「改了要重启才生效」的（比如 MCP 入口的 `port`），告诉人要重启这个 home。

完成的判据：对同一位置调 `settings.get`，`data` 是新值（`delete` 之后是 `null`）。

## 在插件里声明设置项

1. 声明依赖：`export const inject = ['gwbSettings']`，或 `ctx.inject(['gwbSettings'], …)` 局部注入。
2. 在 `apply` 里调 `ctx.gwbSettings.define({ key, title, type, description?, default?, shared? })`：
   - `key` 用 kebab-case，`title` 不能为空
   - 改了要重启才生效的，写进 `description`
   - `shared: true` 的项写进公共区 `*`，别的插件不用声明就能用 `get` 读到（跨插件共享凭据用这个）
3. 读写：`ctx.gwbSettings.get(key)` 同步返回，没有值时回 `default`；自己没声明过的 `key` 去公共区 `*` 找。`set(key, value)`、`delete(key)` 只能动自己声明过的项。读到的值自己校验类型。
4. 给 `cordis.yml` 里本插件那条条目写固定的 `id`：分区名取条目 id 的末段（`home:logger` 的分区是 `logger`），没写 `id` 时 id 每次启动都变，设置就对不上了。
5. `define` 抛错「设置分区 X 归 Y」：两个包算出了同一个条目 id，给本插件的条目换一个 `id`；确认是同一个插件改了包名，调 `plugin-manager.transfer-owner` 把分区改归新包名。

完成的判据：`settings.all` 里有一行 `section` 是本条目 id 的末段（`shared` 项是 `*`）、`key` 是这一项，`live` 为 `true`。

## 规矩

- 插件的配置一律用 `gwbSettings.define` 声明，`cordis.yml` 的条目上只写 `id`：devkit 仓 `docs-site/content/docs/rules/services.mdx`

## `settings.all` 一行的字段

| 字段 | 含义 |
| --- | --- |
| `section` | 分区：声明它的条目 id 的末段，公共区是 `*` |
| `key` | 设置名 |
| `title`、`description` | 声明方写的标题与说明 |
| `type` | `string`、`number`、`boolean`、`secret`、`string-list`（字符串数组） |
| `value` | 存下的值；没设过就没有这一项；secret 行没有 |
| `default` | 声明方给的默认值；只有 `live` 且声明了默认值的行带，secret 行没有 |
| `live` | 此刻有没有插件声明它 |
| `secret`、`isSet`、`mask` | 只有 secret 行带：`secret: true`；`isSet` 是否设过值；设过值时才有 `mask: "••••"` |

文件顶层的 `$owners`（分区名 → 包名）记每个分区归哪个包，四条命令不读写它。

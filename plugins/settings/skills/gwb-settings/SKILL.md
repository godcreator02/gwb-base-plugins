---
name: gwb-settings
description: 要读或改这台工作台的设置时读。讲清 settings 命令的参数形状、section 是什么、值落在哪份文件，以及 secret 项为什么在 all 里没有值、真值该走哪条路。
---

# 设置怎么读、怎么写

设置项由各插件**声明**（它说什么有什么），值落在 `<home>/settings.json` **一份文件**里，
跟 cordis.yml 并排。home 自持全部配置，没有机器级那份——跨 home 想共享就复制文件。

给你的是四条命令：`settings.all`、`settings.get`、`settings.set`、`settings.delete`。

## 先 all 后 get

**动手前先 `settings.all`**，不用参数。它回此刻所有的设置项，每条带：

- `section`：**声明它的插件那条条目的 id**——设置是按插件分区的，这就是地址
- `key`：项名
- `value` / `type` / `title` / `description`：现值和它自己的说明。`type` 五种：string /
  number / boolean / secret / string-list（字符串数组，逐行一项）
- `default`：声明方递的默认值，**只有 live 的项才带**——没设过值时生效的就是它；
  界面拿它画灰占位。它住在内存定义表里不落盘，件停了就不跟了
- `live`：此刻还有没有插件声明着它。false 的多半是插件停了或卸了，盘上的值还在

**`secret` 项是例外，`all` 里没有它的 `value`，也没有 `default`**——枚举口一调就把整个
home 的凭据摆出来，所以那一行改带三格：

- `secret: true`：这一项是 secret 型
- `isSet`：**设过值没有**（布尔）。要判断配没配，认它，别拿 `value` 在不在推——那格永远不在
- `mask`：设过值时才有，定长掩码（`••••`）。**长度不随真值变**，从它推不出值的长度

盘上照样是**明文存储**（既有设计，没改）。要真值就按位置取：`settings.get` 照旧回明文。

文件顶层还有一张 `$owners`（section → 包名），记每个分区归哪个包，不经这四条命令读写——
过户走 `plugin-manager.transfer-owner`。

`settings.get` 要 `{ "section": "...", "key": "..." }`，按位置读一项，**secret 项也回明文**：
它是按位取用（调用方先知道自己在要哪一格），不是枚举口——要收的只是「一次把全部凭据端走」
那条路。`settings.set` 同样的位置再加 `value`，写了就落盘（原子写，先临时文件再 rename）。
`settings.delete` 同样的位置，抹掉值留下定义。

## 三条纪律

1. **写之前先 all**。section 就是插件的条目 id，形状不查清楚就写，多半写进一个谁也不读的角落
2. **`settings.set` 是写口**。它直接改盘上的 JSON，没有「先试试」——想试就用现值一样的值
3. 设置的值**不进日志**（凭据纪律），日志里只有「谁改了哪一项」。所以改错了想找回，
   日志帮不了你，写之前把值想好

---
name: gwb-settings
description: 要读或改这台工作台的设置时读。讲清 settings 命令的参数形状、section 是什么、值落在哪份文件。
---

# 设置怎么读、怎么写

设置项由各件**声明**（它说什么有什么），值落在 `<home>/settings.json` **一份文件**里，
跟 cordis.yml 并排。home 自持全部配置，没有机器级那份——跨 home 想共享就复制文件。

给你的是四条命令：`settings.all`、`settings.get`、`settings.set`、`settings.delete`。

## 先 all 后 get

**动手前先 `settings.all`**，不用参数。它回此刻所有的设置项，每条带：

- `section`：**声明它的件那条条目的 id**——设置是按件分区的，这就是地址
- `key`：项名
- `value` / `type` / `title` / `description`：现值和它自己的说明。没有 `default`——
  默认值是声明方内部的事，不经命令暴露
- `live`：此刻还有没有件声明着它。false 的多半是件停了或卸了，盘上的值还在

`settings.get` 要 `{ "section": "...", "key": "..." }`，按位置读一项。
`settings.set` 同样的位置再加 `value`，写了就落盘（原子写，先临时文件再 rename）。
`settings.delete` 同样的位置，抹掉值留下定义。

## 三条纪律

1. **写之前先 all**。section 就是件的条目 id，形状不查清楚就写，多半写进一个谁也不读的角落
2. **`settings.set` 是写口**。它直接改盘上的 JSON，没有「先试试」——想试就用现值一样的值
3. 设置的值**不进日志**（凭据纪律），日志里只有「谁改了哪一项」。所以改错了想找回，
   日志帮不了你，写之前把值想好

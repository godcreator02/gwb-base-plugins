---
name: gwb-settings
description: 要读或改这台工作台的设置时读。讲清 settings 三条命令的参数形状、home 与 machine 两个 scope 的分别、section 是什么，以及 machine 区里躺着凭据这件事。
---

# 设置怎么读、怎么写

设置项由各件**声明**（它说什么有什么），值落在两份 JSON 里。给你的是三条命令：
`settings.all`、`settings.get`、`settings.set`。

## 先 all 后 get

**动手前先 `settings.all`**，不用参数。它回此刻所有的设置项，每条带：

- `scope`：`home` 或 `machine`
- `section`：**声明它的件那条条目的 id**——设置是按件分区的，这就是地址
- `key`：项名
- `value` / `default` / `type` / `title` / `description`：现值、默认值、和它自己的说明

`settings.get` 要 `{ "scope": "...", "section": "...", "key": "..." }`，按位置读一项。
`settings.set` 同样的位置再加 `value`，写了就落盘（原子写，先临时文件再 rename）。

## 两个 scope 的分别

- **`home`**：跟着这个 home 走。换一个 home 就没有这个值——大部分设置在这
- **`machine`**：全机一份，跨 home 共享。**里面躺着凭据**（比如本机 Verdaccio 的
  token 那类）。读得到不代表该外传；写也要想清楚它会影响这台机器上所有 home

## 三条纪律

1. **写之前先 all**。section 就是件的条目 id，形状不查清楚就写，多半写进一个谁也不读的角落
2. **`settings.set` 是写口**。它直接改盘上的 JSON，没有「先试试」——想试就用现值一样的值
3. 设置的值**不进日志**（凭据纪律），日志里只有「谁改了哪一项」。所以改错了想找回，
   日志帮不了你，写之前把值想好

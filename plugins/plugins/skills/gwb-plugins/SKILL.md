---
name: gwb-plugins
description: 要装插件、启用停用、或查这个 home 装了什么时读。讲清包与条目两层、装了包不等于挂上了、remove-entry 不删包、以及装完之后必须重新 gwb_cli_list。
---

# 插件怎么装、怎么管

这个 home 里装了哪些件、各自挂没挂上，归 `gwb-plugins` 管。七条命令，都走 `gwb_cli_run`。

## 先分清两层：包 与 条目

- **包**：npm 包，`pnpm add` 进 home 的 `node_modules`。装了包**什么都不会发生**——
  它只是躺在盘上
- **条目**：`cordis.yml` 里的一行，指向一个包。**挂上条目，件的代码才真的跑起来**

一个包可以挂好几条条目（各是各的实例、各存各的数据）。`plugins.list` 回的就是这两层：
每个包下面挂着哪些条目、每条启用没有、active 没有。

## 装：plugins.install

`{ "pkg": "@godcreator02/gwb-xxx" }`（可选 `spec` 指定版本）。它做两件事：pnpm add 进
home，**然后自动加一条条目（默认启用）**，回执里带新条目的 `entryId`。

- 装不下来（pnpm 没成、包名不存在）回 `ok: false`，error 带着原因和 pnpm 输出的尾巴
- **装完之后 `gwb_cli_list` 一遍**——新件的命令现在才出现在总线上

## 拆：remove-entry 只删条目，没有卸载

`{ "entryId": "..." }` 把条目从 `cordis.yml` 里删掉，件就此不跑。**包还留在 home 里**——
这里没有卸包这一说，要拿掉包得用户自己去 home 里 `pnpm remove`。删掉的条目随时可以
`plugins.add-entry` 加回来（包还在的话）。

## 启用与停用

`{ "entryId": "..." }` 调 `plugins.enable` / `plugins.disable`。停用的条目下次加载不挂，
热生效。entryId 给完整（`home:commands` 那种）或裸 id（`commands`）都认。

## 改显示名

`plugins.set-label` 传 `{ "entryId": "...", "label": "中文名也行" }`——条目 id 只能是
ASCII，给人看的名字走这里；空串是抹掉。纯粹是装饰，不影响任何行为。

## 一条顺序建议

装件 → list 一遍看 active → `gwb_cli_list` 看新命令。**「装上了」和「挂上了」是两回事**，
挂载失败的件在 `plugins.list` 里看得出（条目在、active 假）。

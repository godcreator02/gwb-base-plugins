---
name: gwb-plugins
description: 要装插件、更新插件、查 registry 上有什么可装、启用停用、或查这个 home 装了什么时读。讲清包与条目两层、装了包不等于挂上了、remove-entry 不删包、update 与 install 的区别、以及装完之后必须重新 gwb_command_list。
---

# 插件怎么装、怎么管、怎么升

这个 home 里装了哪些件、各自挂没挂上、谁有新版本、源上还有什么可装，归 `gwb-plugins`
管。十一条命令，都走 `gwb_command_run`。

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
- **装完之后 `gwb_command_list` 一遍**——新件的命令现在才出现在总线上

## 查有什么可装：plugins.search

不带参数直接调。它查 **npm registry 的标准检索接口**（基址从 pnpm 配置解析——装从哪条
源来，搜就到哪去），回 `@godcreator02` scope 下全部 `gwb-` 开头的包，每条带 registry 上
的 `version` 与 `description`。

- 回的是**字面规则**的结果：废弃线的 `gwb-api`/`gwb-cli` 等也在里头，认正线看装进 home
  的那些（`plugins.list`）或文档站
- 查不到源、网络没成回 `ok: false` 带原因；装之前先 search 一遍看有没有，别瞎猜包名

## 升：plugins.update（跟 install 差一条：不加条目）

`{ "pkg": "@godcreator02/gwb-xxx" }` 把**已装**的包升到最新。先 `plugins.outdated` 查谁
有新版本（`{ "pkg": ... }` 不用传，直接调），回 `包 → { current, latest }` 的表。

- 它跑 `pnpm add <pkg>@latest`，**不建条目**——条目引的是包名，包换版本条目原样有效。
  别拿 install 当升级用：那会给同一个包再挂一条条目
- **跑着的件还持旧代码，重启内核后才换成新的**——升完该说的这句要说
- 包没装它当场抛；pnpm 没成回 `ok: false` 带尾巴

## 拆：remove-entry 与 uninstall 的分工

**只删一条条目**走 `plugins.remove-entry`（`{ "entryId": "..." }`）：条目从 `cordis.yml`
里摘掉、fiber 当场卸下，**包留在 home 里**——随时可以 `plugins.add-entry` 加回来。
挂多条实例的件要拿掉一条，用它。

**整包走人**走 `plugins.uninstall`（`{ "pkg": "..." }`）：先把这个包的**全部条目**摘掉，
再 `pnpm remove` 掉包。设置与数据留在盘上，重装回来还是那份。依赖它的其他件会随 fiber
被 cordis 摘下、在 `plugins.list` 里落「没挂上」档。**不要拿 install 当反操作**——那是
再挂一条条目。

## 启用与停用

`{ "entryId": "..." }` 调 `plugins.enable` / `plugins.disable`。停用的条目下次加载不挂，
热生效。entryId 给完整（`home:commands` 那种）或裸 id（`commands`）都认。

## 改显示名

`plugins.set-label` 传 `{ "entryId": "...", "label": "中文名也行" }`——条目 id 只能是
ASCII，给人看的名字走这里；空串是抹掉。纯粹是装饰，不影响任何行为。

## 一条顺序建议

装件 → list 一遍看 active → `gwb_command_list` 看新命令。**「装上了」和「挂上了」是两回事**，
挂载失败的件在 `plugins.list` 里看得出（条目在、active 假）。


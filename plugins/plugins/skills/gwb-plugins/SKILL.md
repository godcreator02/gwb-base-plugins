---
name: gwb-plugins
description: 要装插件、更新插件、查 registry 上有什么可装、启用停用、或查这个 home 装了什么时读。讲清包与条目两层、装了包不等于挂上了、remove-entry 不删包、update 与 install 的区别、装件时 peer 谁装谁跳过、发完新版本怎么一键热升（update-all，不重启）、以及装完之后必须重新 gwb_command_list。
---

# 插件怎么装、怎么管、怎么升

这个 home 里装了哪些件、各自挂没挂上、谁有新版本、源上还有什么可装，归 `gwb-plugins`
管。十二条命令，都走 `gwb_command_run`。

## 先分清两层：包 与 条目

- **包**：npm 包，`pnpm add` 进 home 的 `node_modules`。装了包**什么都不会发生**——
  它只是躺在盘上
- **条目**：`cordis.yml` 里的一行，指向一个包。**挂上条目，件的代码才真的跑起来**

一个包可以挂好几条条目（各是各的实例、各存各的数据）。`plugins.list` 回的就是这两层：
每个包下面挂着哪些条目、每条启用没有、active 没有。

## 装：plugins.install

`{ "pkg": "@godcreator02/gwb-xxx" }`（可选 `spec` 指定版本）。它做三件事：pnpm add 进
home → **把该进 home 的 peer 也装成 home 的直接依赖** → **自动加一条条目（默认启用）**，
回执里带新条目的 `entryId`。

- 装不下来（pnpm 没成、包名不存在）回 `ok: false`，error 带着原因和 pnpm 输出的尾巴
- **装完之后 `gwb_command_list` 一遍**——新件的命令现在才出现在总线上

### peer 那一步：谁装、谁跳过、谁没装上

件如果依赖一个**会独立升级**的 npm 包，而且只是读它的文件、起它的进程（不 import 它的
代码），那个包就该是件的 peer、并且**装成 home 的直接依赖**——只有进了 home 的
`package.json` 才有 `<home>/node_modules/<包名>` 那条会被 pnpm 改指的 junction，件每次现查
它就拿到当前版本，升级不用重启也不用重挂。**pnpm 自动补的 peer 顶不上这个用**：它只塞进
`.pnpm/`，那条路径根本不存在，于是 `plugins.outdated`（只看 `package.json`）看不见它、
`plugins.update-all` 也永远升不到它。

所以 install 读刚装进来那个包的 `peerDependencies`，逐条判：

| 回执里的 `action` | 什么情况 |
| --- | --- |
| `installed` | 这次装成了 home 的直接依赖（装 latest；`range` 里是件清单写的范围，一律 `>=`，latest 通常都满足） |
| `present` | 本来就在 home 的 `package.json` 里，**版本一个字没动**——不降级、不改写别人钉好的版本 |
| `skipped` | 不该由这条路装：`cordis`（宿主那一份）、本生态的件（要装走 `plugins.install`，那条还落条目）。共享包（清单里有 `gwb.shared`，`gwb-shared-react` / `gwb-tokens`）与生态外的包不在此列，照装 |
| `failed` | 装不上（源上没有之类）。**件本身照样是装上了的**，回执顶层 `note` 里点名，自己去 home 里 `pnpm add` 一趟 |

回执形状：`{ ok, pkg, entryId, peers?: [{ pkg, range, action, note? }], note? }`。件一条 peer
都没声明就没有 `peers` 这一格。

**卸载不动 peer。** `plugins.uninstall` 只拿走这个包与它的条目，**不去追谁还在用那些 peer、
一条都不删**——这不是漏了，是判过的：代价不对称，残留一个没人用的包只是占磁盘，误删一个
还有件在用的包是运行时故障。真要清，人自己在 home 里 `pnpm remove`。

**只有 install 这一条路会种 peer。** `plugins.update` / `plugins.update-all` 不重读
`peerDependencies`——升级把已经在 `package.json` 里的那些一起升到最新（那正是这一步的用意），
但新版本**新加**的 peer 不会自动进来。件加了新 peer 的那一版，人得自己补一趟 `pnpm add`。

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
- **跑着的件还持旧代码，重启内核后才换成新的**——升完该说的这句要说；要热生效走下面的
  `plugins.update-all`
- 包没装它当场抛；pnpm 没成回 `ok: false` 带尾巴

## 一键热升：plugins.update-all（发完新版本就调它，不重启）

不带参数直接调（或 `{ "only": ["@godcreator02/gwb-xxx"] }` 只升点名的）。它一条命令做完
三件事：`plugins.outdated` 拿清单 → **一趟** `pnpm add` 把全部过期包升到清单上的精确版本 →
升了的每个包的**每条条目**停用再启用（loader 重新 import，跑的就是新版本；本来就停用的
保持停用）→ `shell.reload` 整页重载界面。

- 回执 `{ updated: [{ pkg, from, to, entries: [{ id, action, state }] }], selfDeferred, reload, note? }`：
  `action` 是 remounted / skipped / deferred / failed，`state` 是重挂后 fiber 到哪一步（ACTIVE 才算真起来了）
- **升到 `gwb-plugins` 自己**（`selfDeferred: true`）：它那条条目在回执发出之后才重挂，别等它出现在 `entries` 里 remounted
- **升到 `gwb-mcp` 自己**：这条命令的回执会丢（桥随件重挂，连接断了）。重连之后 `plugins.list` 核对版本与 active，再 `gwb_command_list` 一遍
- pnpm 没成回 `ok: false` 带尾巴，**一个包都没升、一条条目都没动**；`note` 里有话就读（全都最新、only 里点了名却不在清单里的、界面要手动刷新）

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


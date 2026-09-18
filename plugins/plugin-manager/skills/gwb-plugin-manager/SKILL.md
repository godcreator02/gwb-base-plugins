---
name: gwb-plugin-manager
description: 要装插件、更新插件、查 registry 上有什么可装、启用停用、重挂一条条目、或查这个 home 装了什么时读。讲清包与条目两层、装了包不等于挂上了、remove-entry 不删包、update 与 install 的区别、装插件时 peer 谁装谁跳过、peer 冲突时回执怎么读（严格与否由 home 的 pnpm-workspace.yaml 定、冲突即拒、home 原样、怎么办）、发完新版本怎么一键热升（update-all，不重启）、以及装完之后要重新调门的 index 拿地图。
---

# 插件怎么装、怎么管、怎么升

这个 home 里装了哪些插件、各自挂没挂上、谁有新版本、源上还有什么可装，归 `gwb-plugin-manager`
管。十四条命令，agent 经 MCP 门的 `run` 按名调。

## 先分清两层：包 与 条目

- **包**：npm 包，`pnpm add` 进 home 的 `node_modules`。装了包**什么都不会发生**——
  它只是躺在盘上
- **条目**：`cordis.yml` 里的一行，指向一个包。**挂上条目，插件的代码才真的跑起来**

一个包可以挂好几条条目（各是各的实例、各存各的数据）。`plugin-manager.list` 回的就是这两层：
每个包下面挂着哪些条目、每条启用没有、active 没有。

## 装：plugin-manager.install

`{ "pkg": "@godcreator/gwb-xxx" }`（可选 `spec` 指定版本）。它做三件事：pnpm add 进
home → **把该进 home 的 peer 也装成 home 的直接依赖** → **自动加一条条目（默认启用）**，
回执里带新条目的 `entryId`。

- 装不下来（pnpm 没成、包名不存在）回 `ok: false`，error 带着原因和 pnpm 输出的尾巴
- **装完之后调一遍门的 `index`**——新插件的命令现在才出现在地图上

### peer 冲突：严格与否由 home 定，插件管理只把冲突报成人话

严不严格**由 home 自己的 `pnpm-workspace.yaml` 定**（`strictPeerDependencies: true`），插件管理调 pnpm
不带任何 peer 参数：

- **default home** 由内核 `INSTALL.md` 铺这一行，peer 对不上 pnpm 就报错——有插件没跟上上游的破坏版时，
  一键更新整趟拒。这份文件只写这一行，逐项覆盖用户级 pnpm 配置（包龄豁免等照读），不是整份盖掉
- **隔离 home 不放**：开发版只进隔离 home，上游破坏线的开发版（`0.10.0-dev.x`）对还写 `^0.9.x` 的下游
  永远不满足，而隔离 home 正是要带着这些下游验它。不严格时 peer 对不上只打一句 WARN、照装

`install`、`update`、`update-all`（连同 install 顺手装 peer 的那几趟）每一趟都**先在 home 之外预检**
（把 home 的 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 抄进临时目录只解析），过了才在 home
里真装——pnpm 严格没过时会把锁文件与 `node_modules` 改掉一半、再 `pnpm install` 也收不回，所以不在 home
里试。peer 对不上时：

- 回 `ok: false`，**这一趟什么都没动**——home 的 `package.json`、`pnpm-lock.yaml`、`node_modules` 原样，
  一条条目没加、没重挂
- `data.peerConflict`（也是 `tail`）是 pnpm 那段冲突说明：`✕ unmet peer <上游>`、`Installed:` home 里
  现在那一版、`Wanted:` 下是要别的范围的插件
- 怎么办：多半是**有插件还没跟上上游的破坏版**——先把那个下游升上来（等它发追上的版本），或
  `plugin-manager.update-all {"only":[…]}` 只升别的；是 home 里的上游太旧（新装的插件要更新的上游），
  就先把上游升上来。**别去关严格检查**——pnpm 输出里教人关的那段 hint 回执里特意不带
- home 里**本来就有**一处 peer 冲突时，此后任何安装都会报那一处（pnpm 查整棵树），先把它理顺

### peer 那一步：谁装、谁跳过、谁没装上

插件如果依赖一个**会独立升级**的 npm 包，而且只是读它的文件、起它的进程（不 import 它的
代码），那个包就该是插件的 peer、并且**装成 home 的直接依赖**——只有进了 home 的
`package.json` 才有 `<home>/node_modules/<包名>` 那条会被 pnpm 改指的 junction，插件每次现查
它就拿到当前版本，升级不用重启也不用重挂。**pnpm 自动补的 peer 顶不上这个用**：它只塞进
`.pnpm/`，那条路径根本不存在，于是 `plugin-manager.outdated`（只看 `package.json`）看不见它、
`plugin-manager.update-all` 也永远升不到它。

所以 install 读刚装进来那个包的 `peerDependencies`，逐条判：

| 回执里的 `action` | 什么情况 |
| --- | --- |
| `installed` | 这次装成了 home 的直接依赖（装 latest；`range` 里是插件清单写的范围，latest 通常都满足） |
| `present` | 本来就在 home 的 `package.json` 里，**版本一个字没动**——不降级、不改写别人钉好的版本 |
| `skipped` | 不该由这条路装：`cordis`（宿主那一份）、本生态的插件（要装走 `plugin-manager.install`，那条还落条目）。共享包（清单里有 `gwb.shared`，`gwb-shared-react` / `gwb-tokens`）与生态外的包不在此列，照装 |
| `failed` | 装不上（源上没有、严格检查下 peer 对不上之类，`note` 里是原因）。**插件本身照样是装上了的**，回执顶层 `note` 里点名，自己去 home 里 `pnpm add` 一趟 |

回执形状：`{ ok, pkg, entryId, peers?: [{ pkg, range, action, note? }], note? }`。插件一条 peer
都没声明就没有 `peers` 这一格。

**卸载不动 peer。** `plugin-manager.uninstall` 只拿走这个包与它的条目，**不去追谁还在用那些 peer、
一条都不删**——这不是漏了，是判过的：代价不对称，残留一个没人用的包只是占磁盘，误删一个
还有插件在用的包是运行时故障。真要清，人自己在 home 里 `pnpm remove`。

**只有 install 这一条路会种 peer。** `plugin-manager.update` / `plugin-manager.update-all` 不重读
`peerDependencies`——升级把已经在 `package.json` 里的那些一起升到最新（那正是这一步的用意），
但新版本**新加**的 peer 不会自动进来。插件加了新 peer 的那一版，人得自己补一趟 `pnpm add`。

## 查有什么可装：plugin-manager.search

不带参数直接调。它查 **npm registry 的标准检索接口**（基址从 pnpm 配置解析——装从哪条
源来，搜就到哪去），回 `@godcreator` scope 下全部 `gwb-` 开头的包，每条带 registry 上
的 `version` 与 `description`。

- 回的是**字面规则**的结果：废弃线的 `gwb-api`/`gwb-cli` 等也在里头，认正线看装进 home
  的那些（`plugin-manager.list`）或文档站
- 查不到源、网络没成回 `ok: false` 带原因；装之前先 search 一遍看有没有，别瞎猜包名

## 升：plugin-manager.update（跟 install 差一条：不加条目）

`{ "pkg": "@godcreator/gwb-xxx" }` 把**已装**的包升到最新。先 `plugin-manager.outdated` 查谁
有新版本（`{ "pkg": ... }` 不用传，直接调），回 `包 → { current, latest }` 的表。

- 它跑 `pnpm add <pkg>@latest`，**不建条目**——条目引的是包名，包换版本条目原样有效。
  别拿 install 当升级用：那会给同一个包再挂一条条目
- **跑着的插件还持旧代码，重启内核后才换成新的**——升完该说的这句要说；要热生效走下面的
  `plugin-manager.update-all`
- 包没装它当场抛；pnpm 没成回 `ok: false` 带尾巴；严格 peer 检查没过同上一节，home 原样

## 一键热升：plugin-manager.update-all（发完新版本就调它，不重启）

不带参数直接调（或 `{ "only": ["@godcreator/gwb-xxx"] }` 只升点名的）。它一条命令做完
三件事：`plugin-manager.outdated` 拿清单 → **一趟** `pnpm add` 把全部过期包升到清单上的精确版本 →
升了的每个包的**每条条目**停用再启用（loader 重新 import，跑的就是新版本；本来就停用的
保持停用）→ `shell.reload` 整页重载界面。

- 回执 `{ updated: [{ pkg, from, to, entries: [{ id, action, state }] }], selfDeferred, reload, note? }`：
  `action` 是 remounted / skipped / deferred / failed，`state` 是重挂后 fiber 到哪一步（ACTIVE 才算真起来了）
- **升到 `gwb-plugin-manager` 自己**（`selfDeferred: true`）：它那条条目在回执发出之后才重挂，别等它出现在 `entries` 里 remounted
- **升到 `gwb-mcp` 门自己**：在途的 MCP 请求会断（门随插件重挂）。MCP 是会话态的，**要重连一次**，没有「下一发自动好」；重连后 `plugin-manager.list` 核对版本与 active，再调一遍 `index`
- pnpm 没成回 `ok: false` 带尾巴，**一个包都没升、一条条目都没动**；`note` 里有话就读（全都最新、only 里点了名却不在清单里的、界面要手动刷新）
- **有插件没跟上上游的破坏版**：home 开着严格 peer 检查（default 开着）时整趟拒、home 原样（见 install 那节），`data.peerConflict`
  点名谁要什么范围——先把那个下游升上来，或 `{ "only": [...] }` 只升别的

## 拆：remove-entry 与 uninstall 的分工

**只删一条条目**走 `plugin-manager.remove-entry`（`{ "entryId": "..." }`）：条目从 `cordis.yml`
里摘掉、fiber 当场卸下，**包留在 home 里**——随时可以 `plugin-manager.add-entry` 加回来。
挂多条实例的插件要拿掉一条，用它。

**整包走人**走 `plugin-manager.uninstall`（`{ "pkg": "..." }`）：先把这个包的**全部条目**摘掉，
再 `pnpm remove` 掉包。设置与数据留在盘上，重装回来还是那份。依赖它的其他插件会随 fiber
被 cordis 摘下、在 `plugin-manager.list` 里落「没挂上」档。**不要拿 install 当反操作**——那是
再挂一条条目。

## 启用与停用

`{ "entryId": "..." }` 调 `plugin-manager.enable` / `plugin-manager.disable`。停用的条目下次加载不挂，
热生效。entryId 给完整（`home:commands` 那种）或裸 id（`commands`）都认。

## 重挂一条：plugin-manager.remount

`{ "entryId": "..." }`。停用 → 等拆完 → 启用 → 等挂上，**一条命令做完**（本来停用的，终态是启用）。
要一条条目重 import（装了新号之后）就调它，**别拿 disable + enable 两条拼**：目标是 plugin-manager
自己或命令总线时，disable 一回来那张命令表就没了，enable 打不进去，条目卡在停用态。

- 回执 `{ id, action, state }`。`remounted`：这条命令里做完，`state` 是重挂后的 fiber 状态，ACTIVE 才算挂上。
  重挂命令总线（`commands`）也是这一支
- `deferred`：目标是 **plugin-manager 自己**。回执先发出、下一个宏任务才重挂，`state` 是动手前的状态；
  没有第二份回执，过一会儿 `plugin-manager.list` 核对 `active`
- 动条目树时抛了回 `ok: false`，`data.action` 是 `failed`；条目不在回 `ok: false` 一句话

## 改显示名

`plugin-manager.set-label` 传 `{ "entryId": "...", "label": "中文名也行" }`——条目 id 只能是
ASCII，给人看的名字走这里；空串是抹掉。纯粹是装饰，不影响任何行为。

## 一条顺序建议

装插件 → list 一遍看 active → 调门的 `index` 看新命令。**「装上了」和「挂上了」是两回事**，
挂载失败的插件在 `plugin-manager.list` 里看得出（条目在、active 假）。


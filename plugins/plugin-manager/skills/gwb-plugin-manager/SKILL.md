---
name: gwb-plugin-manager
description: 要装插件、更新插件、查 registry 上有什么可装、配第三方包源（source.*，写机器级 npmrc）、启用停用、重挂一条条目、或查这个 home 装了什么时读。讲清包与条目两层、装了包不等于挂上了、**装的是库就不落条目**（keywords 自报 gwb 不报 gwb-plugin 的那种）、remove-entry 不删包、件因「数据目录 / 设置分区归别的包」挂不上时怎么办（transfer-owner 还是换 id）、update 与 install 的区别、装插件时 peer 谁装谁跳过、peer 对不上时回执怎么读（照装不拦、peerWarnings 点名谁要什么范围、怎么办）、第三方 scope 怎么配怎么查（@j 这种个人源，owner 一条走 gitea 快捷路）、发完新版本怎么一键热升（update-all，不重启）、以及装完之后要重新调门的 index 拿地图。
---

# 插件怎么装、怎么管、怎么升

这个 home 里装了哪些插件、各自挂没挂上、谁有新版本、源上还有什么可装、第三方包源怎么配，归
`gwb-plugin-manager` 管。十七条命令，agent 经 MCP 门的 `run` 按名调。

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

**装的是「库」就不加条目**：清单 `keywords` 里自报 `gwb`、却不自报 `gwb-plugin` 的那种
（`block-note`、`gwb-tokens`、`gwb-shared-react`、`gwb-plugin-api`、`gwb-repo-kit`）。
库没有 `apply`，条目落进 `cordis.yml` 也挂不上（日志 `invalid plugin, expect function or
object with apply`），所以那条路只会在树上留一条噪声。这种回执**没有 `entryId`**，
`note` 里写着为什么；包照样是装上了的，要用它的件自己 `inject` 它提供的面。

判据只对**明确自报是库**的松手——第三方件（`@j/…` 那类）往往一枚 keywords 都不写，
把「没写」也当库会变成「装上了却不挂」，那是更难查的坏。要走另一条路显式给一个包加条目，
用 `plugin-manager.add-entry`（那边不看这枚词）。

- 装不下来（pnpm 没成、包名不存在）回 `ok: false`，error 带着原因和 pnpm 输出的尾巴
- **装完之后调一遍门的 `index`**——新插件的命令现在才出现在地图上

### peer 对不上：照装不拦，回执里点名

插件管理调 pnpm 不带任何 peer 参数，pnpm 默认不严格：peer 对不上时**照装、`ok: true`**，不拦。
`install`、`update`、`update-all` 装完都跑一趟 `pnpm peers check`，home 里对不上的每一处进回执的
`data.peerWarnings`，一处都没有就没有这一格：

```json
"peerWarnings": [
  { "peer": "@godcreator/gwb-shell", "installed": "0.7.2", "wanted": ">=0.8.0", "by": "@godcreator/gwb-glm-quota@0.1.2" }
]
```

- `peer` 是对不上的那个上游，`installed` 是 home 里现在那一版（压根没装上时没有这一格），`wanted` 是
  `by` 那个插件写的范围。`by` 隔着几层时从 home 的直接依赖一路写到它，` > ` 相连
- 查的是 **home 整棵树**：本来就有的对不上也在里头，不只这一趟新加的
- 怎么办：多半是**有插件还没跟上上游的破坏版**——`by` 那个下游该发追上的版本，追上之后升它；是 home 里的
  上游太旧（新装的插件要更新的上游），就把上游升上来。在那之前两边照常装着，跑起来对不对要自己看一眼
- `pnpm peers check` 本身没读出来时没有 `peerWarnings`，`note` 里说一句「peer 对没对上不知道」

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
| `failed` | 装不上（源上没有之类，`note` 里是原因）。**插件本身照样是装上了的**，回执顶层 `note` 里点名，自己去 home 里 `pnpm add` 一趟 |

回执形状：`{ ok, pkg, entryId, peers?: [{ pkg, range, action, note? }], note?, peerWarnings? }`。插件一条 peer
都没声明就没有 `peers` 这一格。`peers` 说的是「装了没有」，对不对得上范围看 `peerWarnings`（上一节）。

**卸载不动 peer。** `plugin-manager.uninstall` 只拿走这个包与它的条目，**不去追谁还在用那些 peer、
一条都不删**——这不是漏了，是判过的：代价不对称，残留一个没人用的包只是占磁盘，误删一个
还有插件在用的包是运行时故障。真要清，人自己在 home 里 `pnpm remove`。

**只有 install 这一条路会种 peer。** `plugin-manager.update` / `plugin-manager.update-all` 不重读
`peerDependencies`——升级把已经在 `package.json` 里的那些一起升到最新（那正是这一步的用意），
但新版本**新加**的 peer 不会自动进来。插件加了新 peer 的那一版，人得自己补一趟 `pnpm add`。

## 查有什么可装：plugin-manager.search

不带参数直接调＝查**全部配好的源**（`source.list` 认的那两层 npmrc 里的所有 scope：引导线
在前、其余按名排；市场页的「可装」表用的就是这一发）。逐源**并发**查，**一条坏不塌整表**：
好源的件并进 `packages`，坏源点名进 `note`；全部没查成才 `ok: false`。或 `{ "scope": "@j" }`
只查点名的线。

- 每条源走 **npm registry 的标准检索接口**（基址从 pnpm 配置按 scope 解析——装从哪条源来，
  搜就到哪去；源上配了凭据会自动带上），回这条线全部自报 `gwb-plugin` 的包，各带 registry
  上的 `version` 与 `description`
- 回的是**字面规则**的结果：废弃线的 `gwb-api`/`gwb-cli` 等也在里头，认正线看装进 home
  的那些（`plugin-manager.list`）或文档站；第三方源回什么看它自己
- 查不到源、网络没成回 `ok: false` 带原因；装之前先 search 一遍看有没有，别瞎猜包名

## 第三方包源：source.add / source.list / source.remove

装第三方 scope 的件（比如 `@j/gwb-daily-planner` 这种个人源），先得让 pnpm 认识那条源——
**scope 路由与凭据写进机器级 `~/.npmrc`**。为什么是机器级：`@godcreator` 的引导路由本来就
住那儿（每个 home 的出生、源码仓的装与发全指着它），包源是机器级事实；home 级 `.npmrc`
pnpm 也认（同名键还压过机器级），但那是手加的领域，这三条命令只读展示、不写它。

**`plugin-manager.source.add { "scope": "@j", "owner": "J" }`**——最短的一条路，gitea 快捷路：
源地址拼成 `<gitea base>/api/packages/J/npm/`（base 借设置里的 `gitea.base-url`，缺省
`git.tianshen02.online:28377`），token 没显式给就去设置的 `gitea` 分区借。也可以不用快捷路：
`{ "scope": "@x", "registry": "https://…/npm/", "token": "…" }` 直给。

- 幂等：同 scope 已有就是原位替换（回执 `replaced: true`），不叠行
- token 行按**源的路径**配对：同一个 token 配几条源各是各的一行，互不牵连；换源后旧源的
  凭据行成了孤儿（没有别的 scope 指着那条源）就一并收走，还有指着它的就留
- 回执 `lines` 已掩码（`_authToken=***`），凭据不进回执不进日志；`verified: true` 是
  `pnpm config get` 解析出的正是写入的地址
- **`@godcreator` 这条引导线不许经 source.add 写也不许删**——写它等于全机劫持，删它等于
  拔引导线，两条都当场拒
- 私有源借不到 token（没配 `gitea.token`、又没显式传）回 `ok: false`：与其晚点在 install
  上炸，不如现在说清。公开源可以不 token，只写路由行

**`plugin-manager.source.list`**（无参数）——两层合着看：`sources: [{ scope, registry, file, token }]`，
`file` 标出处（`user` 机器级 / `home` 本 home），token 只报有无。同一个 scope 两层都出现时，
生效的是 home 级那条（pnpm 项目级优先）。

**`plugin-manager.source.remove { "scope": "@j" }`**——从机器级拿掉一条路由；机器级没有这条时
回执说清（含「它在 home 级、自己动」的情形）。

配完源之后：不带参数的 `plugin-manager.search` 就是全景（好源并着回、坏源进 note），
`plugin-manager.install {"pkg":"@j/…"}` 装——install/update/update-all 走的都是 pnpm，源一配好它们全都认。


## 升：plugin-manager.update（跟 install 差一条：不加条目）

`{ "pkg": "@godcreator/gwb-xxx" }` 把**已装**的包升到最新。先 `plugin-manager.outdated` 查谁
有新版本（`{ "pkg": ... }` 不用传，直接调），回 `包 → { current, latest }` 的表。

- 它跑 `pnpm add <pkg>@latest`，**不建条目**——条目引的是包名，包换版本条目原样有效。
  别拿 install 当升级用：那会给同一个包再挂一条条目
- **跑着的插件还持旧代码，重启内核后才换成新的**——升完该说的这句要说；要热生效走下面的
  `plugin-manager.update-all`
- 包没装它当场抛；pnpm 没成回 `ok: false` 带尾巴；成了回 `{ ok, pkg, peerWarnings?, note? }`，peer 对不上照升、
  `peerWarnings` 点名（同 install 那节）

## 一键热升：plugin-manager.update-all（发完新版本就调它，不重启）

不带参数直接调（或 `{ "only": ["@godcreator/gwb-xxx"] }` 只升点名的）。它一条命令做完
三件事：`plugin-manager.outdated` 拿清单 → **一趟** `pnpm add` 把全部过期包升到清单上的精确版本 →
升了的每个包的**每条条目**停用再启用（loader 重新 import，跑的就是新版本；本来就停用的
保持停用）→ `shell.reload` 整页重载界面。

- 回执 `{ updated: [{ pkg, from, to, entries: [{ id, action, state }] }], selfDeferred, reload, note?, peerWarnings? }`：
  `action` 是 remounted / skipped / deferred / failed，`state` 是重挂后 fiber 到哪一步（ACTIVE 才算真起来了）
- **升到 `gwb-plugin-manager` 自己**（`selfDeferred: true`）：它那条条目在回执发出之后才重挂，别等它出现在 `entries` 里 remounted
- **升到 `gwb-mcp` 门自己**：在途的 MCP 请求会断（门随插件重挂）。MCP 是会话态的，**要重连一次**，没有「下一发自动好」；重连后 `plugin-manager.list` 核对版本与 active，再调一遍 `index`
- pnpm 没成回 `ok: false` 带尾巴，**一条条目都没动**；`note` 里有话就读（全都最新、only 里点了名却不在清单里的、界面要手动刷新）
- **有插件没跟上上游的破坏版**：照升、不拦，`data.peerWarnings` 点名谁要什么范围（见 install 那节）——
  去追那个下游；不想让上游先走就 `{ "only": [...] }` 只升别的

## 拆：remove-entry 与 uninstall 的分工

**只删一条条目**走 `plugin-manager.remove-entry`（`{ "entryId": "..." }`）：条目从 `cordis.yml`
里摘掉、fiber 当场卸下，**包留在 home 里**——随时可以 `plugin-manager.add-entry` 加回来。
挂多条实例的插件要拿掉一条，用它。

**整包走人**走 `plugin-manager.uninstall`（`{ "pkg": "..." }`）：先把这个包的**全部条目**摘掉，
再 `pnpm remove` 掉包。设置与数据留在盘上，重装回来还是那份。依赖它的其他插件会随 fiber
被 cordis 摘下、在 `plugin-manager.list` 里落「没挂上」档。**不要拿 install 当反操作**——那是
再挂一条条目。

## 条目 id 与户主：数据与设置归哪个包

数据目录与设置分区按条目 id 切，而默认 id 去掉了 scope——`@a/gwb-foo` 与 `@b/foo` 都叫 `foo`。
所以两个件各自给盘上的东西盖了户主章（包名）：

- 装与 `add-entry` 不给 id 时，**先接回本包留在盘上的旧 id**，归别的包的 id 跳过——装回来的件
  拿到的还是自己那份数据与设置
- `add-entry` 手给的 id 归别的包，当场拒，错话里点名户主
- 件挂不上、日志说「数据目录 … 归 X」「设置分区 … 归 X」：就是这条在拦。**同一个件改了包名**
  要接着用旧东西，走 `plugin-manager.transfer-owner`（`{ "id": "foo", "pkg": "<新包名>" }`），
  数据与设置一起过户，再 `remount` 那条条目；**不是同一个件**就给它换个 id（`remove-entry` 再
  `add-entry` 带 `id`），别过户——过户等于把前一个包的东西交给它

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


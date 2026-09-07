---
name: gwb-plugin-dev
description: 在这个仓里起一个新件、改一个件、发版、装进 home 实机验之前用。说清一个件的骨架、package.json 要什么、构建的两条硬要求、测什么、发版与验收的完整一趟。
---

# 写一个件

## 骨架

```
plugins/<件名>/
  package.json
  tsconfig.json     只要 extends 与 outDir/rootDir（产物一律落 dist/，别用 lib）
  src/index.ts      export const name / apply(ctx)
  tests/            纯逻辑单测 + 产物守卫
```

`tsconfig.json` 全文就这么多：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"]
}
```

## package.json 的要点

```json
{
  "name": "@godcreator02/gwb-<件名>",
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./package.json": "./package.json"
  },
  "files": ["dist", "src"],
  "gwb": { "title": "显示名" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "prepublishOnly": "pnpm build"
  }
}
```

**`prepublishOnly` 别漏**：`pnpm check` 只跑 typecheck / lint / test，**它不构建**。少了这条，
`pnpm publish` 会把上一版的 `dist/` 原样发出去，而且一声不吭——装到 home 里的是旧代码，
现象是「件挂上了但新写的东西全没生效」。

**包名加 `gwb-` 前缀**（跟废弃那批错开）。**服务名一律 `gwb` 开头小驼峰**，默认跟件名对应。

带界面的件多一条 `"./client"` 导出，外加 `gwb.styles` 指着自己那张 scope 过的表。

### 依赖写 peer 还是 dev

| 情形 | 写哪 |
| --- | --- |
| 运行时真 import 了它 | `peer` |
| **只 import type，但它出现在导出的类型里** | **`peer`**——消费方必须解析得到 |
| 只在实现内部用类型、不出现在导出面 | `dev` |

中间那档漏过两次，现场见文档站的「撞过的墙」。`cordis` 通常是 dev（只在 `apply` 的参数
类型里用）；契约包看你的导出面有没有引到它的类型。

## 构建的两条硬要求

产物给 node 直接加载（loader 不打包），所以：

1. **相对 import 必须带 `.js`** —— ESM 不做扩展名补全
2. **产物里不许有裸名 import** —— 件该是自包含的

两条都由产物守卫测试拦（照 `plugins/commands/tests/artifact.test.ts` 抄一份）。**TypeScript 不会
替你强制第一条**——`moduleResolution` 只能用 `bundler`，用不了会强制它的 `nodenext`
（cordis 的 `.d.ts` 不兼容）。为什么见文档站。

少了 `.js` 的症状：**件挂不上，而且**（在内核补上保底 error 出口之前）**日志一个字都没有**。

## 测什么

按 `gwb-tdd` 的判据：**「跑它要不要起一个 Electron 或一个子进程」**，不是「这段重不重要」。

- **纯逻辑抠出来测** —— 比如注册表：不碰 `ctx`，`warn` 由调用方给，于是可测
- **`apply` 里只剩接线** —— 那部分归实机验证
- **产物守卫** —— 缺产物时整组跳过，门禁不依赖 `build`

## 发版与实机验：完整一趟

```powershell
# 1. 门禁
pnpm check

# 2. 构建
pnpm build

# 3. 发到本机 registry（版本号先在 package.json 里抬）
cd plugins/<件名>
pnpm publish --registry http://127.0.0.1:4873/ --no-git-checks

# 4. 装进那个 home（版本要先加进它的 pnpm-workspace.yaml 的 minimumReleaseAgeExclude）
cd $env:APPDATA\gwb-kernel\homes\<home 名>
pnpm add @godcreator02/gwb-<件名>@<版本>

# 5. 在 <home>\cordis.yml 里加一条
#    - id: <短名>
#      name: "@godcreator02/gwb-<件名>"

# 6. 起内核看日志
cd <内核仓>\apps\desktop
pnpm exec electron-vite build
.\node_modules\.bin\electron.cmd .
```

**看两处**：宿主 stderr 的 `[host] 挂上 xxx` 逐条结果，渲染层的 `console`（主进程转终端）。

挂不上时看 `[loader]` 那行——内核有保底 error 出口，会报出 `ERR_MODULE_NOT_FOUND` 之类
带完整路径的原因。

### 一次验证一个干净 home

**别拿日常那个 `default` 验**。开一个新的：

```powershell
$env:GWB_HOME = 'data-2609070700'   # <被测件短名>-<yyMMddHHmm>
```

home 自动建在 `%APPDATA%\gwb-kernel\homes\<名>\`，不用先创建，日志也跟着走。复用旧 home 的
下场是：里头躺着十几个不同时刻装进去的版本快照，验什么都不算数。

完整的判断层（产物是不是新的、件进 home 只有哪一条路、哪几种「看着成了」其实没验、什么时候
清理）在**内核仓的 `gwb-test` skill**，别在这儿抄第二份。

## 内核给的面就这么大

- `ctx.gwbKernel`（`requireKernel(ctx)` 取，**不写进 `inject`**）：`dataDir` / `appVersion` /
  `install` / `emit`
- `ctx.loader`：条目树，改条目就是热挂卸。自己所在那棵是 `ctx.fiber.entry?.parent?.tree`
- `kernel.info` / `kernel.install` 两条内核命令
- `gwb://asset/plugins/<包名>/client.js`

要调别的件的能力，走 `ctx.gwbCommands`（`inject: ['gwbCommands']`）。

## 母仓那批是参考，不是模板

`26090623hyz/gwb-plugins` 里有对应的旧件。去查某处当初为什么那么做、踩过什么坑，值得；
**结构、分层、包划分一概不抄**。

明确不要的几样：`gwb.minAppVersion` 与精确 peer 号的双份准入、`platform` 分区与
`window.confirm` 拦截、为具体某个件写的硬编码分支。

# 三格窗格的设计图

`settings` / `mcp` / `skills` 三个件的浏览器半长什么样。**真 shadcn 组件、真令牌表、
真 scope、假数据**——看到的就是搬进件之后的样子。

另有一份**单文件效果图**：`logger-pane.html`（gwb-logger 的日志窗格，2026-09-08 视觉
精修用）。跟这间 React 工程不是一个路数——零构建、双击能开、交互用原生 JS 全真实现，
规矩照 26090620ufd 的 units-pane.html。已按它定稿落地进 `plugins/logger`（0.0.3）。

## 怎么看

双击 `index.html`。不用起服务：束打成 iife、样式走 `<link>`，`file://` 直接能开。

顶栏那条是脚手架（原生 CSS 写的，不属于任何一格）：切亮暗、三格并排或单看一格。

## 怎么改

```powershell
pnpm build   # node build.ts && node ../tools/build-styles.ts
pnpm typecheck
```

改 `src/client/` 下的东西，跑一次 build，刷新页面。

## 为什么不在 pnpm-workspace 里

这是设计产物不是件，不该被 `pnpm -r build` 与发版扫到；而且改仓根那两个文件会跟
并发会话撞车。依赖走 `pnpm install --ignore-workspace`，自己一份 `node_modules` 与 lock。

esbuild 与 typescript **故意不装**，借仓根那一份（`node ../node_modules/…`）：
`--ignore-workspace` 收不到 workspace 的 `allowBuilds`，自己装 esbuild 会被 pnpm 拦掉
postinstall、二进制缺失。

## 目录布局跟件一模一样

`tools/build-styles.ts` 写死扫 `<包目录>/src` 与 `src/client/styles.css`，所以这儿也用
`src/client/`。搬进件的时候整个目录原样带走，只改两处：

| | demo | 件 |
| --- | --- | --- |
| 入口 | `index.tsx` 里三次 `createRoot` | 各自导出 `mountPane(args, container)` |
| react | 打进本束 | `external`，走页面 importmap |

三样必须一起带走的东西，漏一个都是**静默**出错：

1. 容器上的 `data-gwb-plugin="<完整包名>"`——样式表整张 scope 在它之下
2. 容器的 `position: relative`——弹层用 absolute 定位，参照的是它
3. `portal.tsx` 那个 context，以及 `ui/` 下四个改过 Portal 的组件
   （`select` / `dropdown-menu` / `alert-dialog` / `tooltip`）

## 后端此刻给不出什么

`src/client/fixtures.ts` 里每个类型的头注都标了出处。**缺的集中在设置那一格的外层**：

| 要做的 | 现状 |
| --- | --- |
| 列出全部插件（`entryId`/`pkg`/`enabled`/`state`） | **缺**——条目树在 node 侧是 `ctx.loader`，没人开成命令 |
| 件的显示名与图标 | **拼**——shell 的 `plugin-registry` 有，只收主动报过名的件，且没开成命令 |
| 版本号 | **缺**——条目上没有，得读包的 `package.json` |
| 开 / 关一个件 | **缺**——改条目就是热挂卸，但没口子给界面 |
| **卸载** | **缺**得最狠——内核只有 `install(specs)`，没有 remove；内核 `CLAUDE.md` 明写「装过了就不再动它」。要真删包得先推翻那一条 |
| 一个件的设置项 | **有**——`settings.all` 按 `section` 筛，写回走 `settings.set` |
| MCP 连接串 | **有**——`mcp.info` 回 `{ url, port, token }` |
| MCP 工具表 | **拼**——工具写死在 `buildServer` 里，要动态取得加一条 `mcp.tools` |
| skill 清单与正文 | **有**——`skill.list` / `skill.read` |

前四条按准入判据该是**一个新件**（拿 `ctx.loader` 开两条命令）。卸载那条另算。

## 撞过的一堵墙（写给下一个截图的人）

`electron` 里 `show: false` 的窗口**不推进 CSS 过渡**。切了 `.dark` 之后截图，带
`transition` 的控件（按钮、开关、徽标）会被拍在过渡的**起始值**上——看着就像「暗色下
控件全发灰」，其实配色一点问题都没有。截图前先 `insertCSS` 把 transition 关掉。

另：`setZoomFactor` 是**按 origin 持久化**的，上一次脚本设过 1.7，之后每次打开都还是
1.7。要 1x 就显式设一次。

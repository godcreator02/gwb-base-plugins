import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import postcss from 'postcss'

/**
 * 浏览器半打包，外加拼那张**不 scope** 的样式表。
 *
 * react 系**外置**——它们由页面 importmap 解析到共享包，件之间拿同一份实例；
 * dockview 一律**打进本束**：它不在 importmap 里，外置成裸名就是运行期
 * 「Failed to resolve module specifier」。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/** 这四个名字由 gwb-shared-react 提供，跟它 package.json 里的 gwb.shared 一一对应 */
const SHARED = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']

await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'dist/client.js',
  external: SHARED,
  // shadcn 拉下来的组件写的是 @/… 这种别名,跟 components.json 与两份 tsconfig 的
  // paths 是同一条约定（都指 src/client）
  alias: { '@': path.join(here, 'src', 'client') },
  absWorkingDir: here,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  bundle: true,
  minify: false,
  legalComments: 'none',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
})

console.log('[shell] dist/client.js ← src/client/index.tsx')

/**
 * `dist/dockview.css` = **裁过的** dockview 基础规则 + 我们自己那套 theme。
 *
 * dockview 自带 18 套主题，我们一套都不挂——所以凡是**选择器里带 `.dockview-` 的块**
 * 整个剔掉。那不只是 18 套配色：`.dockview-spaced` 这个 modifier 也在其中，它装着圆角与
 * 间距的落地规则（我们那张 theme 表把用得上的复刻了一份）。
 *
 * **按选择器裁，不是按行猜**。第三刀写过「原表整张带上一行不裁——基础规则与主题规则
 * 交错着，裁错一条的症状是某个交互没样式」，那条判据当时成立：那时我们挂着它的
 * `dockview-theme-light`，没有可靠的切分依据。现在一个内置主题都不用了，整类可以按
 * 选择器整体剔除，风险从「猜」变成了「解析」。
 *
 * 用 postcss 解析、**不用字符串数括号**：CSS 的注释与字符串里都可能有括号。
 */
const dockviewCss = require.resolve('dockview-react/dist/styles/dockview.css')
const themeFile = path.join(here, 'src', 'client', 'dockview-theme.css')
const rawCss = fs.readFileSync(dockviewCss, 'utf8')
const themeCss = fs.readFileSync(themeFile, 'utf8')

/** 这条选择器只有挂了 dockview 自带的某个类才命中——我们只挂 `dockview-theme-gwb` */
function isTheirs(selector: string): boolean {
  return selector.includes('.dockview-')
}

const base = postcss.parse(rawCss)
base.walkRules((rule) => {
  // at-rule 底下的「规则」不是选择器（keyframes 的 `from`/`to`），别去动
  if (rule.parent?.type === 'atrule' && (rule.parent as { name?: string }).name !== 'media') return
  if (rule.selectors.every(isTheirs)) {
    rule.remove()
    return
  }
  // 一条规则挂着好几个选择器时，只摘掉属于他们的那几个
  const keep = rule.selectors.filter((s) => !isTheirs(s))
  if (keep.length !== rule.selectors.length) rule.selectors = keep
})
const baseCss = base.toString()

const head =
  `/* 由 build.ts 拼装：**裁过的** dockview 基础规则 + gwb 自己那套 theme。\n` +
  ` * 它自带的 18 套主题连同 .dockview-spaced 那个 modifier 一起裁掉了——我们一套都不挂。\n` +
  ` * 这张不 scope（.dv-* 不经我们的手，门户元素在 body 下）。\n` +
  ` * 改主题改 src/client/dockview-theme.css 重新构建，别手改这份 */\n`
const out = head + baseCss + '\n' + themeCss
const outFile = path.join(here, 'dist', 'dockview.css')
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, out, 'utf8')

const saved = Buffer.byteLength(rawCss, 'utf8') - Buffer.byteLength(baseCss, 'utf8')
console.log(
  `[shell] dist/dockview.css ← 基础规则 + gwb theme（${Buffer.byteLength(out, 'utf8').toLocaleString()} 字节，` +
    `裁掉他们的主题省了 ${saved.toLocaleString()}）`,
)

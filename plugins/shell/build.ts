import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

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
 * `dist/dockview.css` = dockview 的原表 + 我们那张皮肤。
 *
 * **原表整张带上，一行不裁**。它 150KB，其中大半是十几套内置主题（github / nord /
 * catppuccin …）我们一套都不用。裁掉它们能省一百来 KB，但基础规则与主题规则在同一个
 * 文件里交错着，裁错一条的症状是「某个交互没样式」——本地应用里那一百 KB 不值这个风险。
 *
 * 皮肤拼在**后面**：两者特异性相同，靠顺序赢。
 */
const dockviewCss = require.resolve('dockview-react/dist/styles/dockview.css')
const skinFile = path.join(here, 'src', 'client', 'dockview-skin.css')
const head = `/* 由 build.ts 拼装：dockview 原表 + gwb 皮肤。**这张不 scope**——它管的 .dv-* 类名不经我们的手，而且门户元素挂在 body 下。改皮肤改 src/client/dockview-skin.css 重新构建，别手改这份 */\n`
const out = head + fs.readFileSync(dockviewCss, 'utf8') + '\n' + fs.readFileSync(skinFile, 'utf8')
const outFile = path.join(here, 'dist', 'dockview.css')
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, out, 'utf8')

console.log(`[shell] dist/dockview.css ← dockview 原表 + 皮肤（${Buffer.byteLength(out, 'utf8').toLocaleString()} 字节）`)

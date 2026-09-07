import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/**
 * 设计图这一束。跟件的 build.ts 只差两处，两处都是「demo 是单页」带来的：
 *
 * - **react 不外置**：件那边靠页面 importmap 拿共享的一份，这儿没有页面，直接打进束
 * - **format 是 iife 不是 esm**：`<script type="module">` 在 `file://` 下会被浏览器
 *   按跨源挡掉，双击打不开。iife 配普通 `<script>` 就没这问题——设计图要的就是双击能看
 */

const here = path.dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'dist/demo.js',
  // shadcn 拉下来的组件写的是 @/… 这种别名，跟 components.json 与 tsconfig 的
  // paths 是同一条约定（都指 src/client）
  alias: { '@': path.join(here, 'src', 'client') },
  absWorkingDir: here,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  bundle: true,
  minify: false,
  legalComments: 'none',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
})

console.log('[design] dist/demo.js ← src/client/index.tsx')

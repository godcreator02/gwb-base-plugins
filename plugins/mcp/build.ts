import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/**
 * node 侧打包：MCP SDK 与 zod 打包进 dist/index.js，构建产物里只剩 node 内置模块的包名 import。
 * 类型声明随后由 tsc --emitDeclarationOnly 输出（见 package.json 的 build），这里只出 .js。
 */

const here = path.dirname(fileURLToPath(import.meta.url))

// files 白名单整个带上 dist/：旧构建留下的文件不清掉会跟着发布
fs.rmSync(path.join(here, 'dist'), { recursive: true, force: true })

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  absWorkingDir: here,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // 本插件对 cordis 只 import type，打包结果里不该出现它；真出现了就按包名留着，由发版前检查拦下（peer 里没写 cordis）
  external: ['cordis'],
  legalComments: 'none',
  logLevel: 'warning',
})

console.log('[mcp] dist/index.js ← src/index.ts（MCP SDK、zod 已打包进去）')

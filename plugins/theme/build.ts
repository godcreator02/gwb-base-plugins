import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/**
 * 浏览器半打包。react 系**外置**——它们由页面 importmap 解析到共享包，件之间拿同一份实例；
 * 本件没有别的运行时依赖，startup-css.js 是纯函数，直接打进束（预览跟存取吃同一条逻辑）。
 */

const here = path.dirname(fileURLToPath(import.meta.url))

/** 这四个名字由 gwb-shared-react 提供，跟它 package.json 里的 gwb.shared 一一对应 */
const SHARED = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']

await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'dist/client.js',
  external: SHARED,
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

console.log('[theme] dist/client.js ← src/client/index.tsx')

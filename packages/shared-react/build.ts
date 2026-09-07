import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/**
 * react 系 CJS→ESM。用 esbuild 而不是 tsdown/rolldown：rolldown 在 browser 平台对
 * 「CJS require 外置包」刻意保留 require，产物进浏览器即炸；esbuild 会把它提升成 import。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, 'dist')

/** react-dom 两份把 react 外置：它俩要跟 react.js 那份是同一个实例，由页面 importmap 钉住 */
const TARGETS = [
  { entry: 'src/react.ts', out: 'react.js', external: [] as string[] },
  { entry: 'src/react-jsx-runtime.ts', out: 'react-jsx-runtime.js', external: [] as string[] },
  { entry: 'src/react-dom.ts', out: 'react-dom.js', external: ['react'] },
  { entry: 'src/react-dom-client.ts', out: 'react-dom-client.js', external: ['react'] },
]

/**
 * require 探针修补：react-dom 系在工厂函数**内部**调 `require('react')`（不是顶层），
 * esbuild 提不出来，产物里留一个 `__require` 探针——浏览器没有 require，一跑就炸。
 * 修补 = banner 提一句 import，再把探针换成只认 react 的同步解析器。
 *
 * 认的是 esbuild 生成代码的形状，所以**匹配不上就抛**：它哪天变了要当场知道，
 * 不能把一份带探针的产物发出去——那要到页面上打开窗格才看得见。
 */
const SHIM_RE = /var __require = \/\* @__PURE__ \*\/ \(\(x\) => typeof require[\s\S]*?is not supported'\);\s*\n\}\);/

function patchRequireShim(name: string): void {
  const file = path.join(outDir, name)
  const code = fs.readFileSync(file, 'utf8')
  if (!code.includes('__require')) return
  if (!SHIM_RE.test(code)) {
    throw new Error(`${name}：产物里有 __require，但补丁认不出它的形状——esbuild 变了，去对一下 SHIM_RE`)
  }
  const patched = code.replace(
    SHIM_RE,
    'var __require = (id) => {\n' +
      // 回 default（CJS 的 module.exports 原对象）：react-dom 要摸 React 的内部件
      '  if (id === "react") return __gwb_react.default;\n' +
      '  throw new Error("gwb-shared-react：想不到的 require：" + id);\n' +
      '};',
  )
  fs.writeFileSync(file, `import * as __gwb_react from "react";\n${patched}`)
  console.log(`[vendor] ${name}：require 探针已修补`)
}

fs.mkdirSync(outDir, { recursive: true })

for (const t of TARGETS) {
  await build({
    entryPoints: [t.entry],
    outfile: path.join(outDir, t.out),
    external: t.external,
    absWorkingDir: here,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    bundle: true,
    minify: false,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning',
  })
  console.log(`[vendor] ${t.out} ← ${t.entry}`)
}

for (const t of TARGETS) if (t.external.includes('react')) patchRequireShim(t.out)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 产物守卫。这个件有两半，两半的规矩不一样：
 *
 * - **node 半**（`dist/index.js` 那几个，tsc 出的）：相对 import 带扩展名、裸名只许那两个
 * - **浏览器半**（`dist/client.js`，esbuild 打的）：**只许**那四个共享名漏出去——它们由
 *   页面 importmap 解析到共享包。多漏一个就是运行期一句
 *   `Failed to resolve module specifier`，而那要开到窗格才看得见
 *
 * node 半的名单钉死还有第二层意思：commands / data / settings / shell 四个件在这儿是
 * **可选**的，源码里只有 `import type {}`。哪天有人把它写成运行时 import，这条会当场变红——
 * 不然的话，现场是「home 里没装那四个件时这个件挂不上」，而日志里只有一句
 * ERR_MODULE_NOT_FOUND，看不出是依赖写错了档。
 *
 * 缺产物时整组跳过——门禁不依赖 build。
 */

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const built = fs.existsSync(distDir)

if (!built) console.warn('[gwb-plugins] dist/ 还没造出来，产物组跳过（pnpm build 之后再跑）')

/** node 半运行时真 import 的两个，一个都不能少、也不该多 */
const ALLOWED_BARE = new Set(['cordis', '@godcreator02/gwb-plugin-api'])

/** 页面 importmap 提供的那四个，跟 build.ts 的 SHARED 一一对应 */
const SHARED = new Set(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'])

const CLIENT = 'client.js'

function read(file: string): string {
  return fs.readFileSync(path.join(distDir, file), 'utf8')
}

function specsIn(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((m) => m[1]!)
}

/** 锚在行首：产物里顶层 import 都顶格写，字符串字面量里那种总带着缩进 */
const RELATIVE = /^import\s+(?:[^'"]*from\s*)?['"](\.[^'"]*)['"]/gm
const BARE = /^import\s+(?:[^'"]*from\s*)?['"]([^'".][^'"]*)['"]/gm

describe.skipIf(!built)('产物', () => {
  const all = built ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js')) : []
  const nodeHalf = all.filter((f) => f !== CLIENT)

  it('两半都有产物可查', () => {
    expect(nodeHalf.length).toBeGreaterThan(0)
    expect(all).toContain(CLIENT)
  })

  it('node 半：相对 import 一律带扩展名——产物给 node 直接加载，ESM 不做补全', () => {
    const bad: string[] = []
    for (const file of nodeHalf) {
      for (const spec of specsIn(read(file), RELATIVE)) {
        if (!spec.endsWith('.js')) bad.push(`${file}: ${spec}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('node 半：裸名只有钉死的那两个', () => {
    const bare = new Set<string>()
    for (const file of nodeHalf) {
      for (const spec of specsIn(read(file), BARE)) {
        if (!spec.startsWith('node:')) bare.add(spec)
      }
    }
    expect([...bare].filter((s) => !ALLOWED_BARE.has(s))).toEqual([])
  })

  it('node 半：浏览器那几个文件没被 tsc 一起编进来——它们是 esbuild 的输入，不是产物', () => {
    expect(fs.existsSync(path.join(distDir, 'client'))).toBe(false)
  })

  it('浏览器半：裸名只许那四个共享的', () => {
    const leaked = specsIn(read(CLIENT), BARE).filter((s) => !SHARED.has(s))
    expect(leaked).toEqual([])
  })

  it('样式表整张 scope 过', () => {
    const css = fs.readFileSync(path.join(distDir, 'style.css'), 'utf8')
    expect(css).toContain(':where([data-gwb-plugin="@godcreator02/gwb-plugins"])')
  })

  it('radix / cva 打进了本束——外置成裸名就是运行期一句 Failed to resolve', () => {
    // 认编译后的产物，别写 JSX 里那种原样字面量：esbuild 会把属性编成对象的键
    expect(read(CLIENT)).toContain('data-slot')
  })

  it('**卸载在界面上有入口**：`plugins.uninstall` 得打进 client 束——2026-09-08 起这个件做卸载了', () => {
    const client = read(CLIENT)
    // 只认 ASCII 标记：esbuild 默认把非 ASCII 转义成 \\uXXXX，中文在产物里搜不到
    expect(client).toContain('plugins.uninstall')
    expect(client).toContain('pnpm remove')
  })
})

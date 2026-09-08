import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 产物守卫。这个件有两半，两半的规矩不一样：
 *
 * - **node 半**（`dist/index.js`，tsc 出的）：相对 import 带扩展名、裸名只许词汇表包
 * - **浏览器半**（`dist/client.js`，esbuild 打的）：**只许**那四个共享名漏出去——它们由
 *   页面 importmap 解析到共享包。多漏一个就是运行期一句
 *   `Failed to resolve module specifier`，而那要开到窗格才看得见
 *
 * 缺产物时整组跳过——门禁不依赖 build。
 */

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const built = fs.existsSync(distDir)

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

  it('node 半：相对 import 一律带扩展名', () => {
    const bad: string[] = []
    for (const file of nodeHalf) {
      for (const spec of specsIn(read(file), RELATIVE)) {
        if (!spec.endsWith('.js')) bad.push(`${file}: ${spec}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('node 半：裸名只许词汇表包——requireKernel 是真函数，别的一条都没有', () => {
    const bare: string[] = []
    for (const file of nodeHalf) {
      for (const spec of specsIn(read(file), BARE)) {
        if (!spec.startsWith('node:') && spec !== '@godcreator02/gwb-plugin-api') bare.push(`${file}: ${spec}`)
      }
    }
    expect(bare).toEqual([])
  })

  it('浏览器半：裸名只许那四个共享的', () => {
    const leaked = specsIn(read(CLIENT), BARE).filter((s) => !SHARED.has(s))
    expect(leaked).toEqual([])
  })

  it('样式表整张 scope 过', () => {
    const css = fs.readFileSync(path.join(distDir, 'style.css'), 'utf8')
    expect(css).toContain(':where([data-gwb-plugin="@godcreator02/gwb-logger"])')
  })

  it('**没把 window.gwb 换成 args**：实时行走页面公共面 window.gwb.on，外壳不转发它', () => {
    expect(read(CLIENT)).toContain('window.gwb.on')
  })

  it('radix 打进了本束——外置成裸名就是运行期一句 Failed to resolve', () => {
    // 认编译后的产物，别写 JSX 里那种原样字面量：esbuild 会把属性编成对象的键
    expect(read(CLIENT)).toContain('select-trigger')
  })

  it('**Select 的弹层挂回本件容器**，不挂 body——挂出去样式一条都匹配不上', () => {
    expect(read(CLIENT)).toContain('usePortalContainer')
  })
})

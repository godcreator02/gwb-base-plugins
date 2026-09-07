import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 产物守卫。这个件有两半，两半的规矩不一样：
 *
 * - **node 半**（`dist/index.js`，tsc 出的）：相对 import 带扩展名、裸名只许钉死的那些
 * - **浏览器半**（`dist/client.js`，esbuild 打的）：**只许**那四个共享名漏出去——它们由
 *   页面 importmap 解析到共享包。多漏一个就是运行期一句
 *   `Failed to resolve module specifier`，而那要开到窗格才看得见
 *
 * node 半那份名单钉死还有第二层意思：**shell 件在这儿只有 `import type {}`**（激活它的
 * declare module）。哪天有人把它写成运行时 import，这条会当场变红。
 *
 * 缺产物时整组跳过——门禁不依赖 build。
 */

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const built = fs.existsSync(distDir)

if (!built) console.warn('[gwb-market] dist/ 还没造出来，产物组跳过（pnpm build 之后再跑）')

/**
 * node 半运行时真 import 的裸名：**一个都没有**。
 *
 * 这一半只做注册——契约包在这儿也只是 `import type`，shell 件同理。空名单是有意的：
 * 这个件真长出一条运行时依赖时，这条会逼着人在这儿说一句为什么。
 */
const ALLOWED_BARE = new Set<string>([])

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

  it('node 半：裸名只有钉死的那些（眼下一个都没有）', () => {
    const bare = new Set<string>()
    for (const file of nodeHalf) {
      for (const spec of specsIn(read(file), BARE)) {
        if (!spec.startsWith('node:')) bare.add(spec)
      }
    }
    expect([...bare].filter((s) => !ALLOWED_BARE.has(s))).toEqual([])
  })

  it('**清单没被 tsc 编进 node 半**——catalog.ts 只有浏览器那半在用，它跟界面一起进 esbuild', () => {
    expect(fs.existsSync(path.join(distDir, 'catalog.js'))).toBe(false)
    expect(fs.existsSync(path.join(distDir, 'client'))).toBe(false)
  })

  it('浏览器半：裸名只许那四个共享的', () => {
    const leaked = specsIn(read(CLIENT), BARE).filter((s) => !SHARED.has(s))
    expect(leaked).toEqual([])
  })

  it('样式表整张 scope 过', () => {
    const css = fs.readFileSync(path.join(distDir, 'style.css'), 'utf8')
    expect(css).toContain(':where([data-gwb-plugin="@godcreator02/gwb-market"])')
  })

  it('radix / cva 打进了本束——外置成裸名就是运行期一句 Failed to resolve', () => {
    // 认编译后的产物，别写 JSX 里那种原样字面量：esbuild 会把属性编成对象的键
    expect(read(CLIENT)).toContain('data-slot')
  })

  it('清单跟界面一起进了束——它是硬编码的数据，不经命令过桥', () => {
    expect(read(CLIENT)).toContain('@godcreator02/gwb-hello')
  })

  it('**装的动作调的是别的件的命令**，市场自己一条命令都没注册', () => {
    const client = read(CLIENT)
    expect(client).toContain('plugins.install')
    expect(client).toContain('plugins.list')
    // node 半连命令总线都不碰：注册命令这件事整个不在这个件里
    for (const file of nodeHalf) expect(read(file)).not.toContain('gwbCommands')
  })
})

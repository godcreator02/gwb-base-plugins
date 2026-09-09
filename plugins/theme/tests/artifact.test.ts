import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 产物守卫。缺产物时整组跳过——门禁不依赖 build。
 *
 * 两半的规矩照 shell / hello 那份：node 半走 tsc（`index.js` 与 `startup-css.js`），
 * 浏览器半走 esbuild（`client.js`，react 系外置给 importmap，其余打进束）。
 * node 半 = 所有 .js 减掉 client.js。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(here, '../dist')
const built = fs.existsSync(distDir)

if (!built) console.warn('[gwb-theme] dist/ 还没造出来,产物组跳过（pnpm build 之后再跑）')

const CLIENT = 'client.js'
/** node 半运行时真 import 的。契约包与那几个件都是 `import type`,整句擦除,不该出现 */
const ALLOWED_BARE = new Set(['@godcreator02/gwb-plugin-api'])
/** 外置给 importmap 的那四个，client.js 里只许它们是裸名 */
const SHARED = new Set(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'])
/** 正则锚行首:字符串字面量里的 import 总带着缩进,顶格的才是真的顶层 import */
const RELATIVE = /^import\s+(?:[^'"]*from\s*)?['"](\.[^'"]*)['"]/gm
const BARE = /^import\s+(?:[^'"]*from\s*)?['"]([^'".][^'"]*)['"]/gm

/** css 注释 */
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g
/**
 * 一条规则的选择器（或 at-rule 的头）：`{` 之前、上一个 `{` / `}` / `;` 之后的那一段。
 * **只在这一段里找类**——直接全文搜 `.xxx` 会把声明值里的小数（`0.25rem` 的 `.25rem`）
 * 也捞成类选择器
 */
const PRELUDE = /(?:^|[{};])([^{};]*)\{/g
/** 一个类选择器。转义序列（`.theme\:flex` 里那个 `\:`）整体吃掉 */
const CLASS_SELECTOR = /\.(?:\\.|[A-Za-z0-9_-])+/g
/**
 * **唯一放行的非前缀类**：`.dark` 是页面级的亮暗标志，挂在 `<html>` 上、由令牌那张表
 * 与外壳负责。它只以**祖先**的身份出现在 `theme:dark:*` 编出来的
 * `.theme\:dark\:…:is(.dark *)` 里，不是本件元素身上的类
 */
const DARK_FLAG = new Set(['.dark'])

function classSelectors(css: string): string[] {
  const found = new Set<string>()
  for (const rule of css.replaceAll(CSS_COMMENT, '').matchAll(PRELUDE)) {
    const prelude = rule[1]!.trim()
    if (prelude.startsWith('@')) continue
    for (const cls of prelude.matchAll(CLASS_SELECTOR)) found.add(cls[0])
  }
  return [...found]
}

describe.skipIf(!built)('产物', () => {
  const all = built ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js')) : []
  const nodeHalf = all.filter((f) => f !== CLIENT)

  it('两半都在——node 半的 index.js 与 startup-css.js,浏览器半的 client.js', () => {
    expect(nodeHalf.sort()).toEqual(['index.js', 'startup-css.js'])
    expect(all).toContain(CLIENT)
  })

  it('node 半:相对 import 一律带扩展名——产物给 node 直接加载,ESM 不做补全', () => {
    const bad: string[] = []
    for (const file of nodeHalf) {
      const text = fs.readFileSync(path.join(distDir, file), 'utf8')
      for (const m of text.matchAll(RELATIVE)) {
        if (!m[1]!.endsWith('.js')) bad.push(`${file}: ${m[1]!}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('node 半:裸名只有钉死的那些', () => {
    const bare = new Set<string>()
    for (const file of nodeHalf) {
      const text = fs.readFileSync(path.join(distDir, file), 'utf8')
      for (const m of text.matchAll(BARE)) {
        const spec = m[1]!
        if (!spec.startsWith('node:')) bare.add(spec)
      }
    }
    expect([...bare].filter((s) => !ALLOWED_BARE.has(s))).toEqual([])
  })

  it('client.js 的裸名 import 只有 react 系——契约包打进了束,多出一个裸名浏览器就解析不到', () => {
    const text = fs.readFileSync(path.join(distDir, CLIENT), 'utf8')
    const bare = [...text.matchAll(BARE)].map((m) => m[1]!)
    expect(bare.filter((s) => !SHARED.has(s))).toEqual([])
  })

  it('style.css 里的类选择器一律 .theme\\: 开头——围栏就是前缀本身', () => {
    const bad = classSelectors(fs.readFileSync(path.join(distDir, 'style.css'), 'utf8'))
      .filter((s) => !s.startsWith('.theme\\:') && !DARK_FLAG.has(s))
      .sort()
    expect(bad).toEqual([])
  })

  it('style.css 里没有 data-gwb-plugin——围栏换成前缀之后,这张表不再依赖任何祖先关系', () => {
    // 有它就说明构建又走回了 tools/build-styles.ts 那条选择器 scope 的路。
    // 症状是弹层（portal 到 body 的那些）当场裸奔,而构建照样绿
    expect(fs.readFileSync(path.join(distDir, 'style.css'), 'utf8')).not.toContain('data-gwb-plugin')
  })
})

describe('注册窗格时自报地址', () => {
  const source = fs.readFileSync(path.resolve(here, '../src/index.ts'), 'utf8')

  /**
   * 新契约（词汇表 0.1）：**内核不再读 exports 表**，也没有 `gwb://`。件注册窗格时自报
   * 浏览器半与样式表的 `file://` 地址，从自己的 `import.meta.url` 算。漏了这两个字段的
   * 症状是「格开出来是一句错」，而那要点开那一格才看得见——所以钉在这儿。
   */
  it('两个地址都从 import.meta.url 算', () => {
    expect(source).toContain("new URL('./client.js', import.meta.url).href")
    expect(source).toContain("new URL('./style.css', import.meta.url).href")
  })

  it('registerPane 把两个地址都报上去了', () => {
    expect(source).toContain('client: CLIENT_URL')
    expect(source).toContain('style: STYLE_URL')
  })
})

describe('包清单', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8')) as {
    exports?: Record<string, unknown>
    files?: string[]
    peerDependencies?: Record<string, string>
    peerDependenciesMeta?: Record<string, { optional?: boolean }>
  }

  it('dist 和 src 都进了 files——client 的守卫要照着 src 扫', () => {
    expect(manifest.files).toContain('dist')
    expect(manifest.files).toContain('src')
  })

  it('外壳是可选 peer——没装外壳本件照常挂,启动样式照样全局生效', () => {
    expect(manifest.peerDependencies?.['@godcreator02/gwb-shell']).toBeDefined()
    expect(manifest.peerDependenciesMeta?.['@godcreator02/gwb-shell']?.optional).toBe(true)
  })
})

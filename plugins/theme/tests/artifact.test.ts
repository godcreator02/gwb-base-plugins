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
})

describe('包清单', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8')) as {
    exports?: Record<string, unknown>
    files?: string[]
    peerDependencies?: Record<string, string>
    peerDependenciesMeta?: Record<string, { optional?: boolean }>
  }

  it('client 与 style.css 都在 exports 表里——gwb:// 只认这张表', () => {
    expect(manifest.exports?.['./client']).toBeDefined()
    expect(manifest.exports?.['./style.css']).toBeDefined()
  })

  it('dist 和 src 都进了 files——client 的守卫要照着 src 扫', () => {
    expect(manifest.files).toContain('dist')
    expect(manifest.files).toContain('src')
  })

  it('外壳是可选 peer——没装外壳本件照常挂,启动样式照样全局生效', () => {
    expect(manifest.peerDependencies?.['@godcreator02/gwb-shell']).toBeDefined()
    expect(manifest.peerDependenciesMeta?.['@godcreator02/gwb-shell']?.optional).toBe(true)
  })
})

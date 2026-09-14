import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 产物守卫：相对 import 必须带扩展名；裸名只许 `cordis` 一个。
 * 缺产物时整组跳过——门禁不依赖 build。
 *
 * 为什么偏偏 `cordis` 得留：`Service` 基类必须是**宿主跑的那一份**,两份 cordis 的
 * instanceof 对不上。契约包与 cli 件都是 `import type`,整句擦除,不该出现在产物里。
 *
 * 后半段守的是另一件事：**这个件不许再长出 python 项目来**。第一版自带过一个自检靶子,
 * 那是错的——运行器背一个跟自己职责无关的 uv 项目,而验收本来就该落在消费方件上
 * （样板见 `plugins/hello`）。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(here, '../dist')
const built = fs.existsSync(distDir)

if (!built) console.warn('[gwb-py-cli] dist/ 还没造出来,产物组跳过（pnpm build 之后再跑）')

const ALLOWED_BARE = new Set(['cordis'])

describe.skipIf(!built)('产物', () => {
  const files = built ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js')) : []

  it('有产物可查', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('相对 import 一律带扩展名——产物给 node 直接加载,ESM 不做补全', () => {
    const bad: string[] = []
    for (const file of files) {
      const text = fs.readFileSync(path.join(distDir, file), 'utf8')
      for (const m of text.matchAll(/(?:from|import)\s*['"](\.[^'"]*)['"]/g)) {
        if (!m[1]!.endsWith('.js')) bad.push(`${file}: ${m[1]!}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('裸名只有钉死的那一个', () => {
    const bare = new Set<string>()
    for (const file of files) {
      const text = fs.readFileSync(path.join(distDir, file), 'utf8')
      for (const m of text.matchAll(/(?:from|import)\s*['"]([^'".][^'"]*)['"]/g)) {
        const spec = m[1]!
        if (!spec.startsWith('node:')) bare.add(spec)
      }
    }
    expect([...bare].filter((s) => !ALLOWED_BARE.has(s))).toEqual([])
  })
})

describe('这个件只做运行器', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8')) as {
    files?: string[]
  }

  it('自己不带 python 项目——py/ 与 venv 都住在消费方件的包根下', () => {
    expect(manifest.files).toEqual(['catalog.json', 'dist', 'skills', 'src'])
    expect(fs.existsSync(path.resolve(here, '../py'))).toBe(false)
  })

  it('仓根仍然忽略 venv——消费方件建出来的那些也走这一条', () => {
    const ignore = fs.readFileSync(path.resolve(here, '../../../.gitignore'), 'utf8')
    expect(ignore).toMatch(/^\.venv\/$/m)
  })
})

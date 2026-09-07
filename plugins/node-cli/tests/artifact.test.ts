import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 产物守卫：相对 import 必须带扩展名；裸名只许 `cordis` 一个。
 * 缺产物时整组跳过——门禁不依赖 build。
 *
 * 为什么偏偏 `cordis` 得留：`Service` 基类必须是**宿主跑的那一份**,两份 cordis 的
 * instanceof 对不上。契约包与 cli 件都是 `import type`,`verbatimModuleSyntax` 下
 * 整句擦除,所以产物里不该出现——多一个就得有人解释为什么。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(here, '../dist')
const built = fs.existsSync(distDir)

if (!built) console.warn('[gwb-node-cli] dist/ 还没造出来,产物组跳过（pnpm build 之后再跑）')

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

describe('自检靶子', () => {
  it('发得出去——包清单的 files 带着 selftest', () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8')) as {
      files?: string[]
    }
    expect(manifest.files).toContain('selftest')
  })

  it('靶子文件在', () => {
    expect(fs.existsSync(path.resolve(here, '../selftest/probe.mjs'))).toBe(true)
  })
})

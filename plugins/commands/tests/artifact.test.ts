import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 产物守卫：相对 import 必须带扩展名、不许有裸名 import。
 * 缺产物时整组跳过——门禁不依赖 build。为什么要这两条，见文档站。
 */

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const built = fs.existsSync(distDir)

describe.skipIf(!built)('产物', () => {
  const files = built ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js')) : []

  it('有产物可查', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('相对 import 一律带扩展名', () => {
    const bad: string[] = []
    for (const file of files) {
      const text = fs.readFileSync(path.join(distDir, file), 'utf8')
      for (const m of text.matchAll(/(?:from|import)\s*['"](\.[^'"]*)['"]/g)) {
        const spec = m[1]!
        if (!spec.endsWith('.js')) bad.push(`${file}: ${spec}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('不许出现裸名 import——这个件该是自包含的', () => {
    const bare: string[] = []
    for (const file of files) {
      const text = fs.readFileSync(path.join(distDir, file), 'utf8')
      for (const m of text.matchAll(/(?:from|import)\s*['"]([^'".][^'"]*)['"]/g)) {
        const spec = m[1]!
        if (!spec.startsWith('node:')) bare.push(`${file}: ${spec}`)
      }
    }
    expect(bare).toEqual([])
  })
})

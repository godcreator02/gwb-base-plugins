import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 产物守卫。拦的是一个**静默失败**:产物里的相对 import 少了 `.js`,node 的 ESM 加载器
 * 找不到模块,而 loader 把那个错误整个吞掉——件就是挂不上,日志里一个字都没有。
 *
 * tsconfig 用的是 bundler 解析（不能用 nodenext,cordis 的 .d.ts 不兼容),所以 TS 不会
 * 替我们强制这一条。缺产物时整组跳过:门禁不依赖 build。
 */

const libDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib')
const built = fs.existsSync(libDir)

describe.skipIf(!built)('产物', () => {
  const files = built ? fs.readdirSync(libDir).filter((f) => f.endsWith('.js')) : []

  it('有产物可查', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('相对 import 一律带扩展名', () => {
    const bad: string[] = []
    for (const file of files) {
      const text = fs.readFileSync(path.join(libDir, file), 'utf8')
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
      const text = fs.readFileSync(path.join(libDir, file), 'utf8')
      for (const m of text.matchAll(/(?:from|import)\s*['"]([^'".][^'"]*)['"]/g)) {
        const spec = m[1]!
        if (!spec.startsWith('node:')) bare.push(`${file}: ${spec}`)
      }
    }
    expect(bare).toEqual([])
  })
})

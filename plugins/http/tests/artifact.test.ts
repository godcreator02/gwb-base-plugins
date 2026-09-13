import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 产物守卫：相对 import 必须带扩展名；裸名只许钉死的那一个。
 * 缺产物时整组跳过——门禁不依赖 build。
 *
 * 这个件自称零运行时依赖，守卫就是那句话的证据：裸名只许词汇表包（requireKernel /
 * isRecord 是真函数），多一个就得有人解释为什么。
 */

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const built = fs.existsSync(distDir)

if (!built) console.warn('[gwb-http] dist/ 还没造出来，产物组跳过（pnpm build 之后再跑）')

/** 精确匹配的那一个 */
const ALLOWED_BARE = new Set(['@godcreator02/gwb-plugin-api'])

function allowed(spec: string): boolean {
  return spec.startsWith('node:') || ALLOWED_BARE.has(spec)
}

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

  it('裸名只有钉死的那一个——零依赖不是口号，是这条守卫', () => {
    const bare = new Set<string>()
    for (const file of files) {
      const text = fs.readFileSync(path.join(distDir, file), 'utf8')
      for (const m of text.matchAll(/(?:from|import)\s*['"]([^'".][^'"]*)['"]/g)) {
        bare.add(m[1]!)
      }
    }
    expect([...bare].filter((s) => !allowed(s))).toEqual([])
  })
})

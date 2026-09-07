import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 产物守卫：相对 import 必须带扩展名；裸名只许那两个。
 * 缺产物时整组跳过——门禁不依赖 build。
 *
 * 跟 `gwb-commands` 那份不同：**这个件不可能自包含**。`Service` 基类必须是宿主跑的那一份
 * cordis（两份 cordis 的 instanceof 对不上），`requireKernel` 与 `isRecord` 也是真函数。
 * `@godcreator02/gwb-commands` **不该出现**——它是空 `import type`，只为激活对方的
 * `declare module`，`verbatimModuleSyntax` 会把那句整个删掉。它要是冒出来了，说明
 * 有人把它写成了值 import。
 */

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const built = fs.existsSync(distDir)

if (!built) console.warn('[gwb-settings] dist/ 还没造出来，产物组跳过（pnpm build 之后再跑）')

/** 运行时真 import 的两个，一个都不能少、也不该多 */
const ALLOWED_BARE = new Set(['cordis', '@godcreator02/gwb-plugin-api'])

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

  it('裸名只有钉死的那两个', () => {
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

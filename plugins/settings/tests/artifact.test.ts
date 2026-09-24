import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 构建产物的检查：相对 import 带扩展名；包名 import 除 node 内置模块外只有 `cordis`。
 * `cordis` 必须留：`Service` 基类要用宿主运行的那一份（两份 cordis 的 instanceof 对不上）。
 * 词汇表包、`@godcreator/gwb-commands`、`@godcreator/gwb-skills` 都只 import 类型（后两个是空的 `import type {}`，
 * 只为让 ctx 上的服务有类型），`verbatimModuleSyntax` 会把那几句整个删掉；它们出现在产物里，说明有人写成了按值 import。
 * 没构建时整组跳过，这组检查不依赖构建。
 */

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const built = fs.existsSync(distDir)

if (!built) console.warn('[gwb-settings] dist/ 还没构建，构建产物这组检查跳过（pnpm build 之后再运行）')

/** 运行时按值 import 的那一个，不该多 */
const ALLOWED_BARE = new Set(['cordis'])

describe.skipIf(!built)('构建产物', () => {
  const files = built ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js')) : []

  it('有构建产物可查', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('相对 import 一律带扩展名——构建产物由 node 直接加载，ESM 不补扩展名', () => {
    const bad: string[] = []
    for (const file of files) {
      const text = fs.readFileSync(path.join(distDir, file), 'utf8')
      for (const m of text.matchAll(/(?:from|import)\s*['"](\.[^'"]*)['"]/g)) {
        if (!m[1]!.endsWith('.js')) bad.push(`${file}: ${m[1]!}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('除了 node 内置模块与 cordis，一个包名 import 都没有', () => {
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

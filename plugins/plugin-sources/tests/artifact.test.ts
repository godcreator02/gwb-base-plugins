import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 构建产物检查：相对 import 带扩展名；包名 import 只能是 node 内置模块。
 *
 * 本插件对 commands、skills、plugin-api、cordis 都只取类型，源码里只有 `import type`。
 * 哪天有人把它们写成运行时 import，这里会变红——否则现场是 home 里找不到那个包时插件加载失败，
 * 日志里只有一句 ERR_MODULE_NOT_FOUND。
 *
 * 没有产物时整组跳过——检查不依赖构建。
 */

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const built = fs.existsSync(distDir)

if (!built) console.warn('[gwb-plugin-sources] dist/ 还没构建，产物检查跳过（pnpm build 之后再跑）')

function read(file: string): string {
  return fs.readFileSync(path.join(distDir, file), 'utf8')
}

function specsIn(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((m) => m[1]!)
}

/** 锚在行首：产物里顶层 import 都顶格写，字符串里出现的 import 字样总带着缩进 */
const RELATIVE = /^import\s+(?:[^'"]*from\s*)?['"](\.[^'"]*)['"]/gm
const BARE = /^import\s+(?:[^'"]*from\s*)?['"]([^'".][^'"]*)['"]/gm

describe.skipIf(!built)('产物', () => {
  const all = built ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js')) : []

  it('有产物可查', () => {
    expect(all.length).toBeGreaterThan(0)
  })

  it('相对 import 一律带扩展名——产物由 node 直接加载，ESM 不会补全', () => {
    const bad: string[] = []
    for (const file of all) {
      for (const spec of specsIn(read(file), RELATIVE)) {
        if (!spec.endsWith('.js')) bad.push(`${file}: ${spec}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('包名 import 只有 node 内置模块', () => {
    const bare = new Set<string>()
    for (const file of all) {
      for (const spec of specsIn(read(file), BARE)) {
        if (!spec.startsWith('node:')) bare.add(spec)
      }
    }
    expect([...bare]).toEqual([])
  })
})

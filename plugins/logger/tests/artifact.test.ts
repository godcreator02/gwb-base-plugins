import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 构建产物的检查：这个插件只有 node 侧（`dist/`，tsc 输出）；相对 import 带扩展名，包名 import 除 node 内置模块外只有 `cordis`。
 * 日志窗格与它的构建产物检查在 gwb-baseui。没构建时整组跳过，这组检查不依赖构建。
 */

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const built = fs.existsSync(distDir)

function read(file: string): string {
  return fs.readFileSync(path.join(distDir, file), 'utf8')
}

function specsIn(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((m) => m[1]!)
}

/** 锚在行首：产物里顶层 import 都顶格写，字符串字面量里那种总带着缩进 */
const RELATIVE = /^import\s+(?:[^'"]*from\s*)?['"](\.[^'"]*)['"]/gm
const BARE = /^import\s+(?:[^'"]*from\s*)?['"]([^'".][^'"]*)['"]/gm

describe.skipIf(!built)('构建产物', () => {
  const files = built ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js')) : []

  it('有构建产物可查', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('相对 import 一律带扩展名', () => {
    const bad: string[] = []
    for (const file of files) {
      for (const spec of specsIn(read(file), RELATIVE)) {
        if (!spec.endsWith('.js')) bad.push(`${file}: ${spec}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('除了 node 内置模块与 cordis，一个包名 import 都没有——占位服务继承的 Service 要用宿主运行的那份 cordis', () => {
    const bare: string[] = []
    for (const file of files) {
      for (const spec of specsIn(read(file), BARE)) {
        if (!spec.startsWith('node:') && spec !== 'cordis') bare.push(`${file}: ${spec}`)
      }
    }
    expect(bare).toEqual([])
  })
})

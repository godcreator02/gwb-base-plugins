import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 构建产物的检查：相对 import 带扩展名；包名 import 除 node 内置模块外只有 `cordis`。
 * `cordis` 必须留：`Service` 基类要用宿主运行的那一份。没构建时整组跳过，这组检查不依赖构建。
 */

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const built = fs.existsSync(distDir)

const ALLOWED_BARE = new Set(['cordis'])

describe.skipIf(!built)('构建产物', () => {
  it('浏览器客户端可在没有 Electron、Cordis 和 window 的环境导入，运行时没有其他模块依赖', async () => {
    const { command } = await import('../dist/client.js')
    expect(typeof command).toBe('function')
    const client = fs.readFileSync(path.join(distDir, 'client.js'), 'utf8')
    expect(client).not.toMatch(/(?:from|import)\s*['"]|import\s*\(/)
  })
  const files = built ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js')) : []

  it('有构建产物可查', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('相对 import 一律带扩展名——构建产物由 node 直接加载，ESM 不补扩展名', () => {
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

  it('除了 node 内置模块与 cordis，一个包名 import 都没有', () => {
    const bare: string[] = []
    for (const file of files) {
      const text = fs.readFileSync(path.join(distDir, file), 'utf8')
      for (const m of text.matchAll(/(?:from|import)\s*['"]([^'".][^'"]*)['"]/g)) {
        const spec = m[1]!
        if (!spec.startsWith('node:') && !ALLOWED_BARE.has(spec)) bare.push(`${file}: ${spec}`)
      }
    }
    expect(bare).toEqual([])
  })
})

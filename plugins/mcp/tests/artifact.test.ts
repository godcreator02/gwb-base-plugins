import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 构建产物的检查：dist/ 下只有打包出来的 index.js 一个 .js，里面的包名 import 只有 node 内置模块。
 * MCP SDK 与 zod 打包进了产物；本插件对 cordis 与别的插件只 import 类型，产物里出现它们就是哪里引了值。
 * 没构建时整组跳过，这组检查不依赖构建。
 */

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const built = fs.existsSync(distDir)

if (!built) console.warn('[gwb-mcp] dist/ 还没构建，构建产物这组检查跳过（pnpm build 之后再运行）')

describe.skipIf(!built)('构建产物', () => {
  const files = built ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js')) : []

  it('只有打包出来的 index.js', () => {
    expect(files).toEqual(['index.js'])
  })

  it('除了 node 内置模块，一个包名 import 都没有，也没有相对 import', () => {
    const text = fs.readFileSync(path.join(distDir, 'index.js'), 'utf8')
    const imports = [...text.matchAll(/^(?:import|export)\s*(?:[\w$*{}\s,]*?\s*from\s*)?['"]([^'"\n]+)['"]/gm)].map((m) => m[1]!)
    expect(imports.length).toBeGreaterThan(0)
    expect(imports.filter((spec) => !spec.startsWith('node:'))).toEqual([])
  })
})

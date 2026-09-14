import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 产物守卫。0.3 劈 core 后这个件只剩 node 半（`dist/`，tsc 出的）：
 *
 * - 相对 import 带扩展名、裸名只许词汇表包
 *
 * 浏览器半那几条（四个共享名、样式前缀围栏、Portal 补丁）随窗格一起搬去了
 * gwb-baseui，守卫也住那边。
 *
 * 缺产物时整组跳过——门禁不依赖 build。
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

describe.skipIf(!built)('产物', () => {
  const files = built ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js')) : []

  it('有产物可查', () => {
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

  it('裸名只许词汇表包与 cordis——requireKernel 是真函数，薄服务 extends 的是宿主那份 cordis', () => {
    const bare: string[] = []
    for (const file of files) {
      for (const spec of specsIn(read(file), BARE)) {
        if (!spec.startsWith('node:') && spec !== '@godcreator/gwb-plugin-api' && spec !== 'cordis') bare.push(`${file}: ${spec}`)
      }
    }
    expect(bare).toEqual([])
  })
})

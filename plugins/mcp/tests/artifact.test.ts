import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 产物守卫：相对 import 必须带扩展名；裸名只许钉死的那几个。
 * 缺产物时整组跳过——门禁不依赖 build。
 *
 * 这个件的裸名比别人多，因为它**真有运行时依赖**：MCP SDK 与 zod 跟着它一起装进
 * home（走 dependencies），词汇表包的 requireKernel / isRecord 也是真函数。名单钉死，
 * 多一个就得有人解释为什么——尤其别让 cli / data 两件混进来：那两个只 import type，
 * 一旦在产物里现身，就是哪里不小心引了它们的值。
 */

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const built = fs.existsSync(distDir)

if (!built) console.warn('[gwb-mcp] dist/ 还没造出来，产物组跳过（pnpm build 之后再跑）')

/** 精确匹配的那两个 */
const ALLOWED_BARE = new Set(['@godcreator02/gwb-plugin-api', 'zod'])
/** SDK 走子路径导入（`server/mcp.js` 之类），按前缀放行 */
const ALLOWED_PREFIX = '@modelcontextprotocol/sdk/'

function allowed(spec: string): boolean {
  return spec.startsWith('node:') || ALLOWED_BARE.has(spec) || spec.startsWith(ALLOWED_PREFIX)
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

  it('裸名只有钉死的那几个', () => {
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

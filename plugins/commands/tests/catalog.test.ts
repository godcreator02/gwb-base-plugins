import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * gwb-commands 的身份卡守卫：catalog.json 跟源码对不上当场红。
 * 钉四样：schema 字段不多不少；plugin 名 ═ export const name；
 * depends.hard ═ 源码 inject（export const / static inject 两种写法都认）；
 * depends.local ═ 所有 .inject([...]) 的并集。summary 与 shape 文案靠 review。
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const catalog = JSON.parse(fs.readFileSync(path.resolve(here, '../catalog.json'), 'utf8')) as Record<string, unknown>

function srcText(): string {
  const dir = path.resolve(here, '../src')
  return fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
}
const source = srcText()

function hardOf(src: string): string[] {
  const out = new Set<string>()
  for (const m of src.matchAll(/(?:export const inject|static inject)\s*=\s*\[([^\]]*)\]/g))
    for (const q of m[1]!.matchAll(/'([^']+)'/g)) out.add(q[1]!)
  return [...out].sort()
}
function localsOf(src: string): string[] {
  const out = new Set<string>()
  for (const m of src.matchAll(/\.inject\(\s*\[([^\]]*)\]/g))
    for (const q of m[1]!.matchAll(/'([^']+)'/g)) out.add(q[1]!)
  return [...out].sort()
}

describe('catalog.json：身份卡不撒谎', () => {
  it('schema：字段不多不少，类型对', () => {
    expect(Object.keys(catalog).sort()).toEqual(['depends', 'plugin', 'provides', 'summary'])
    expect(typeof catalog['plugin']).toBe('string')
    expect((catalog['summary'] as string).length).toBeGreaterThan(6)
    const provides = catalog['provides'] as unknown[]
    expect(Array.isArray(provides)).toBe(true)
    for (const p of provides) expect(Object.keys(p as object).sort()).toEqual(['service', 'shape'])
    const depends = catalog['depends'] as Record<string, string[]>
    expect(Object.keys(depends).sort()).toEqual(['hard', 'local'])
  })

  it('plugin 名 ═ export const name', () => {
    const m = /export const name = '([^']+)'/.exec(source)
    expect(catalog['plugin']).toBe(m?.[1])
  })

  it('depends.hard ═ 源码 inject（双向整组）', () => {
    expect((catalog['depends'] as Record<string, string[]>)['hard']).toEqual(hardOf(source))
  })

  it('depends.local ═ 源码所有 .inject 的并集', () => {
    expect((catalog['depends'] as Record<string, string[]>)['local']).toEqual(localsOf(source))
  })

  it('provides 的服务名一律 gwb 开头小驼峰', () => {
    for (const p of catalog['provides'] as Array<{ service: string }>) {
      expect(p.service).toMatch(/^gwb[A-Z][A-Za-z]*$|^gwb\.shared$/)
    }
  })
})

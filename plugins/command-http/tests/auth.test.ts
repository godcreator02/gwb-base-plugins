import { describe, expect, it } from 'vitest'
import { bearerMatches, generateToken, loadOrCreateToken, type TokenStore } from '../src/auth.js'

/** 内存替身：readDoc / writeDoc 两个方法就是 TokenStore 的全部 */
function memoryStore(saved: Record<string, unknown> = {}): TokenStore {
  return {
    async readDoc(doc: string) {
      return saved[doc]
    },
    async writeDoc(doc: string, value: unknown) {
      saved[doc] = value
    },
  }
}

describe('generateToken', () => {
  it('256 位 base64url，43 个字符，两次不一样', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).toMatch(/^[\w-]{43}$/)
    expect(a).not.toBe(b)
  })
})

describe('loadOrCreateToken', () => {
  it('首启生成并落盘，第二次沿用同一份', async () => {
    const saved: Record<string, unknown> = {}
    const first = await loadOrCreateToken(memoryStore(saved))
    expect(first).toMatch(/^[\w-]{43}$/)
    expect(saved['token']).toMatchObject({ token: first })
    expect(await loadOrCreateToken(memoryStore(saved))).toBe(first)
  })

  it('已有但太短的当没有——重新生成', async () => {
    const store = memoryStore({ token: { token: 'short' } })
    expect((await loadOrCreateToken(store)).length).toBeGreaterThanOrEqual(32)
  })

  it('文档读不到（undefined）当没有', async () => {
    expect((await loadOrCreateToken(memoryStore())).length).toBeGreaterThanOrEqual(32)
  })
})

describe('bearerMatches', () => {
  const token = 'T'.repeat(43)

  it('正确的 token 过；scheme 大小写不敏感', () => {
    expect(bearerMatches(`Bearer ${token}`, token)).toBe(true)
    expect(bearerMatches(`bearer ${token}`, token)).toBe(true)
    expect(bearerMatches(`BEARER   ${token} `, token)).toBe(true)
  })

  it('没给、给错、变长、scheme 不对一律 false——拒绝面不泄露信息', () => {
    expect(bearerMatches(undefined, token)).toBe(false)
    expect(bearerMatches('', token)).toBe(false)
    expect(bearerMatches(`Bearer ${'T'.repeat(42)}`, token)).toBe(false)
    expect(bearerMatches(`Bearer ${'T'.repeat(44)}`, token)).toBe(false)
    expect(bearerMatches(`Bearer ${token}x`, token)).toBe(false)
    expect(bearerMatches(`Basic ${token}`, token)).toBe(false)
  })
})

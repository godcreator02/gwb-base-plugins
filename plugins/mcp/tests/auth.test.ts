import { describe, expect, it } from 'vitest'
import { bearerMatches, generateToken, loadOrCreateToken, type TokenStore } from '../src/auth.js'

/** 记下写了什么的替身 store */
function fakeStore(initial?: unknown): TokenStore & { written: unknown } {
  return {
    written: undefined,
    async readDoc() {
      return initial
    },
    async writeDoc(_doc, value) {
      this.written = value
    },
  }
}

describe('generateToken', () => {
  it('32 字节 base64url——43 个字符,不带填充', () => {
    const token = generateToken()
    expect(token).toHaveLength(43)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('两次不一样', () => {
    expect(generateToken()).not.toBe(generateToken())
  })
})

describe('loadOrCreateToken', () => {
  it('空盘时生成一个并落盘,形状是 { token, createdAt }', async () => {
    const store = fakeStore(undefined)
    const token = await loadOrCreateToken(store)
    expect(token).toHaveLength(43)
    expect(store.written).toMatchObject({ token })
    expect((store.written as { createdAt: string }).createdAt).toBeTypeOf('string')
  })

  it('已有合法 token 就沿用,不重写', async () => {
    const existing = generateToken()
    const store = fakeStore({ token: existing, createdAt: '2026-01-01T00:00:00.000Z' })
    expect(await loadOrCreateToken(store)).toBe(existing)
    expect(store.written).toBeUndefined()
  })

  it('盘上那份太短就换一个新的', async () => {
    const store = fakeStore({ token: '短' })
    const token = await loadOrCreateToken(store)
    expect(token).toHaveLength(43)
    expect(store.written).toMatchObject({ token })
  })

  it('盘上是坏形状也不抛,照样出一个新的', async () => {
    const store = fakeStore('这不是个对象')
    expect(await loadOrCreateToken(store)).toHaveLength(43)
  })
})

describe('bearerMatches', () => {
  const token = generateToken()

  it('对上了', () => {
    expect(bearerMatches(`Bearer ${token}`, token)).toBe(true)
  })

  it('scheme 大小写不敏感（RFC 7235）', () => {
    expect(bearerMatches(`bearer ${token}`, token)).toBe(true)
    expect(bearerMatches(`BEARER ${token}`, token)).toBe(true)
  })

  it('没给头、错 scheme、空 token 一律不认', () => {
    expect(bearerMatches(undefined, token)).toBe(false)
    expect(bearerMatches(token, token)).toBe(false)
    expect(bearerMatches(`Basic ${token}`, token)).toBe(false)
    expect(bearerMatches('Bearer ', token)).toBe(false)
  })

  it('等长的错值不认——定长比较那条路要真走到', () => {
    const wrong = generateToken()
    expect(wrong).toHaveLength(token.length)
    expect(bearerMatches(`Bearer ${wrong}`, token)).toBe(false)
  })

  it('前缀对但长度不同不认——长度先判,不让时序透出前缀', () => {
    expect(bearerMatches(`Bearer ${token.slice(0, 20)}`, token)).toBe(false)
    expect(bearerMatches(`Bearer ${token}xx`, token)).toBe(false)
  })
})

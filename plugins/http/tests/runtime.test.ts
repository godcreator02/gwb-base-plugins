import { describe, expect, it } from 'vitest'
import { RUNTIME_FILE, patchRuntime } from '../src/runtime.js'

describe('patchRuntime', () => {
  it('只补自己那格，内核那几格原样保留', () => {
    const text = JSON.stringify({ pid: 72896, startedAt: 2, appDir: 'x', cdp: 9352 })
    const out = JSON.parse(patchRuntime(text, { port: 2870, url: 'http://127.0.0.1:2870' })) as Record<string, unknown>
    expect(out['pid']).toBe(72896)
    expect(out['cdp']).toBe(9352)
    expect(out['http']).toEqual({ port: 2870, url: 'http://127.0.0.1:2870' })
  })

  it('mcp 留下的旧格是认不得的字段——原样保留不碰', () => {
    const text = JSON.stringify({ pid: 1, mcp: { port: 55572, url: 'http://127.0.0.1:55572/mcp' } })
    const out = JSON.parse(patchRuntime(text, { port: 1, url: 'u' })) as Record<string, unknown>
    expect(out['mcp']).toEqual({ port: 55572, url: 'http://127.0.0.1:55572/mcp' })
  })

  it('重写同一格时新值覆盖旧值', () => {
    const first = patchRuntime(undefined, { port: 1, url: 'u1' })
    const second = JSON.parse(patchRuntime(first, { port: 2, url: 'u2' })) as Record<string, unknown>
    expect(second['http']).toEqual({ port: 2, url: 'u2' })
  })

  it('读不动、半截 JSON、根不是对象，一律当没有——从空对象起', () => {
    for (const bad of [undefined, '{ 半截', '[1,2]', '"str"']) {
      const out = JSON.parse(patchRuntime(bad, { port: 1, url: 'u' })) as Record<string, unknown>
      expect(out).toEqual({ http: { port: 1, url: 'u' } })
    }
  })

  it('记录的文件名跨仓共用，叫 runtime.json', () => {
    expect(RUNTIME_FILE).toBe('runtime.json')
  })
})

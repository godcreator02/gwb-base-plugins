import { describe, expect, it } from 'vitest'
import { patchRuntime, RUNTIME_FILE, type McpSlot } from '../src/runtime.js'

/**
 * 这份记录是**三个仓共用的契约**：内核开机整份重写，本件绑成之后补一格。所以最该钉住的
 * 不是「写得出自己那格」，是「**没把别人那几格抹掉**」——抹掉了下游就定位不到这个 home，
 * 而那种坏法在本件自己这边一点症状都没有。
 */

const MCP: McpSlot = { port: 2870, url: 'http://127.0.0.1:2870/mcp' }

/** 内核开机写的那几格 */
const KERNEL = { pid: 12345, startedAt: 1789027763798, appDir: 'D:/k/apps/desktop', cdp: 9347 }

describe('patchRuntime', () => {
  it('内核那几格原样留着,自己那格补上去', () => {
    const out = JSON.parse(patchRuntime(JSON.stringify(KERNEL), MCP)) as Record<string, unknown>
    expect(out).toMatchObject(KERNEL)
    expect(out.mcp).toEqual(MCP)
  })

  it('不认得的字段也留着——将来别人加一格,本件不该把它吃掉', () => {
    const out = JSON.parse(patchRuntime('{"谁将来加的":{"a":1}}', MCP)) as Record<string, unknown>
    expect(out['谁将来加的']).toEqual({ a: 1 })
  })

  it('重启之后端口换了,自己那格整格换新', () => {
    const first = patchRuntime(JSON.stringify(KERNEL), MCP)
    const second = patchRuntime(first, { port: 51234, url: 'http://127.0.0.1:51234/mcp' })
    const out = JSON.parse(second) as { mcp: McpSlot; pid: number }
    expect(out.mcp.port).toBe(51234)
    // 换自己那格不许碰内核那几格
    expect(out.pid).toBe(KERNEL.pid)
  })

  it('文件还不在:从空对象起', () => {
    expect(JSON.parse(patchRuntime(undefined, MCP))).toEqual({ mcp: MCP })
  })

  it('半截 JSON 当没有——写到一半崩掉留下的就是这种', () => {
    expect(JSON.parse(patchRuntime('{"pid": 12', MCP))).toEqual({ mcp: MCP })
  })

  it('根不是对象也当没有', () => {
    expect(JSON.parse(patchRuntime('[1,2,3]', MCP))).toEqual({ mcp: MCP })
    expect(JSON.parse(patchRuntime('"就一个串"', MCP))).toEqual({ mcp: MCP })
    expect(JSON.parse(patchRuntime('null', MCP))).toEqual({ mcp: MCP })
  })

  it('写出去的是人读得了的:两格缩进、末尾一个换行', () => {
    const text = patchRuntime(JSON.stringify(KERNEL), MCP)
    expect(text.endsWith('}\n')).toBe(true)
    expect(text).toContain('\n  "mcp": {')
  })
})

describe('文件名', () => {
  it('就叫 runtime.json——三个仓认的是这一个名字', () => {
    expect(RUNTIME_FILE).toBe('runtime.json')
  })
})

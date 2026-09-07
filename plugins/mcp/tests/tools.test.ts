import { describe, expect, it } from 'vitest'
import { textResult, toolResult } from '../src/tools.js'

describe('textResult', () => {
  it('包成一条文本内容,JSON 缩进两格', () => {
    expect(textResult({ a: 1 })).toEqual({ content: [{ type: 'text', text: '{\n  "a": 1\n}' }] })
  })
})

describe('toolResult', () => {
  it('成了：摊成 { ok, data },不带 isError', () => {
    const result = toolResult({ ok: true, data: { count: 2 } })
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0]!.text)).toEqual({ ok: true, data: { count: 2 } })
  })

  it('成了但没 data：给个 null,别让对面读到 undefined', () => {
    expect(JSON.parse(toolResult({ ok: true }).content[0]!.text)).toEqual({ ok: true, data: null })
  })

  it('业务失败回 isError 的文本,不是协议错误——agent 读得到原因、连接不断', () => {
    const result = toolResult({ ok: false, error: '没有这条命令：nope' })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('没有这条命令：nope')
  })

  it('失败但没写原因也有话说', () => {
    expect(toolResult({ ok: false }).content[0]!.text).toContain('未知错误')
  })
})

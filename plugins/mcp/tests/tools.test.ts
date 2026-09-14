import { describe, expect, it } from 'vitest'
import {
  cliRunResult,
  coerceArgs,
  isCliRunResult,
  textResult,
  toolResult,
  type CliRunResultView,
} from '../src/tools.js'

describe('coerceArgs', () => {
  it('对象原样过——健康的客户端不受影响', () => {
    const args = { section: 'devkit', key: 'registry-dir' }
    expect(coerceArgs(args)).toBe(args)
    expect(coerceArgs(undefined)).toBeUndefined()
  })

  it('JSON 字符串解开——客户端把对象序列化成字符串的那类调用活过来', () => {
    expect(coerceArgs('{"section":"devkit","key":"registry-dir"}')).toEqual({
      section: 'devkit',
      key: 'registry-dir',
    })
    expect(coerceArgs('{"skipBuild":true}')).toEqual({ skipBuild: true })
  })

  it('不是 JSON 的字符串原样送——让命令自己的校验说话', () => {
    expect(coerceArgs('abc')).toBe('abc')
    expect(coerceArgs('{oops')).toBe('{oops')
  })

  it('JSON 字面量是无损 round-trip——真要传字符串参数的命令不受伤', () => {
    expect(coerceArgs('"123"')).toBe('123')
    expect(coerceArgs('true')).toBe(true)
  })
})

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

  it('带 ok 但还有自己字段的回执是总线透传的原话,不当信封摊平——摊平会把字段全丢成 data:null', () => {
    const snapshot = { ok: true, at: '2026-09-13 00:40:00', configured: true, warnThreshold: 80, view: { level: 'max' } }
    expect(JSON.parse(toolResult(snapshot).content[0]!.text)).toEqual(snapshot)
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

/** 一份 CLI 运行器的回执——总线「带 ok 就透传」之后它冒充回执本体的那副样子 */
function cliResult(overrides: Partial<CliRunResultView> = {}): CliRunResultView {
  return {
    ok: true,
    exitCode: 0,
    signal: null,
    timedOut: false,
    timeoutMs: 30000,
    stdout: { text: '{"note":"中文没乱码就对了"}', truncated: false },
    stderr: { text: '', truncated: false },
    durationMs: 12,
    ...overrides,
  }
}

describe('isCliRunResult', () => {
  it('带 stdout 与 exitCode 的透传份认得出来', () => {
    expect(isCliRunResult(cliResult())).toBe(true)
  })

  it('普通命令回执（只有 ok/data）不认', () => {
    expect(isCliRunResult({ ok: true, data: { count: 2 } })).toBe(false)
    expect(isCliRunResult({ ok: false, error: 'x' })).toBe(false)
  })
})

describe('cliRunResult', () => {
  it('进程回执摊平:退出码、输出、耗时都在顶层,而不是塞在 data 里被撞没', () => {
    const parsed = JSON.parse(cliRunResult(cliResult()).content[0]!.text)
    expect(parsed).toMatchObject({ ok: true, exitCode: 0, durationMs: 12 })
    expect(parsed.stdout.text).toContain('中文没乱码')
  })

  it('失败的那一路把退出码与 stderr 原样交出去——失败不是协议错误', () => {
    const view = cliResult({ ok: false, exitCode: 1, stderr: { text: '[hello-cli] 故意失败', truncated: false } })
    expect(cliRunResult(view).isError).toBeUndefined()
    const parsed = JSON.parse(cliRunResult(view).content[0]!.text)
    expect(parsed.exitCode).toBe(1)
    expect(parsed.stderr.text).toContain('故意失败')
  })
})

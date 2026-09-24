import { describe, expect, it } from 'vitest'
import { sourceOf } from '../src/index.js'

describe('sourceOf：按 logger 名字分来源', () => {
  it('renderer 是页面', () => {
    expect(sourceOf('renderer')).toBe('renderer')
  })

  it('kernel 与 loader 是内核', () => {
    expect(sourceOf('kernel')).toBe('kernel')
    expect(sourceOf('loader')).toBe('kernel')
  })

  it('gwb 算插件：内核不用这个名字写日志', () => {
    expect(sourceOf('gwb')).toBe('plugin')
  })

  it('其余名字一律算插件', () => {
    expect(sourceOf('gwb-logger')).toBe('plugin')
    expect(sourceOf('gwb-mcp')).toBe('plugin')
    expect(sourceOf('')).toBe('plugin')
  })
})

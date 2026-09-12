import { describe, expect, it } from 'vitest'
import { DESKTOP_EVENT, defaultDesktopName, isDesktopAction, resolveDesktop } from '../src/desktops.js'
import type { DesktopRow } from '../src/layout.js'

/**
 * 桌面纯判断：事件口上认不认得出自己的记号、按 id / 名字找不找得到那口桌面。
 * 事件口上什么件的事件都有，认错一条就把别人的动作当自己的执行了。
 */

function desktop(over: Partial<DesktopRow> = {}): DesktopRow {
  return { id: 'd1', name: '桌面 1', layout: null, ...over }
}

const rows = [desktop(), desktop({ id: 'd2', name: '摸鱼' }), desktop({ id: 'd3', name: '摸鱼' })]

describe('isDesktopAction', () => {
  it('记号对得上才认，null / 原始值 / 别件的事件都不认', () => {
    expect(isDesktopAction({ t: DESKTOP_EVENT, action: 'switch', id: 'd2' })).toBe(true)
    expect(isDesktopAction({ t: DESKTOP_EVENT, action: 'new', name: '写笔记' })).toBe(true)
    expect(isDesktopAction(null)).toBe(false)
    expect(isDesktopAction('switch')).toBe(false)
    expect(isDesktopAction({ t: 'gwb-logger', line: 'x' })).toBe(false)
    expect(isDesktopAction({})).toBe(false)
  })
})

describe('resolveDesktop：id 优先于名字', () => {
  it('按 id 命中', () => {
    expect(resolveDesktop(rows, { id: 'd2' })?.id).toBe('d2')
  })

  it('id 空串 / 不是字符串不当 id 用，落到名字那条', () => {
    expect(resolveDesktop(rows, { id: '', name: '摸鱼' })?.id).toBe('d2')
    expect(resolveDesktop(rows, { id: 3, name: '摸鱼' })?.id).toBe('d2')
  })

  it('名字撞了多口取第一口——名字本来就不唯一，id 才是身份', () => {
    expect(resolveDesktop(rows, { name: '摸鱼' })?.id).toBe('d2')
  })

  it('两样都给不出（空串 / 非字符串）→ undefined：调用方什么都不做', () => {
    expect(resolveDesktop(rows, {})).toBeUndefined()
    expect(resolveDesktop(rows, { id: '', name: '' })).toBeUndefined()
    expect(resolveDesktop(rows, { id: 1, name: 2 })).toBeUndefined()
  })

  it('给得出但认不出（id / 名字都不在表里）→ undefined', () => {
    expect(resolveDesktop(rows, { id: 'd9' })).toBeUndefined()
    expect(resolveDesktop(rows, { name: '不存在' })).toBeUndefined()
  })
})

describe('defaultDesktopName', () => {
  it('跟 id 的号走', () => {
    expect(defaultDesktopName('d1')).toBe('桌面 1')
    expect(defaultDesktopName('d12')).toBe('桌面 12')
  })
})

import { describe, expect, it } from 'vitest'
import type { LogEntry } from '../../src/client/panes/logger/entries'
import { ALL_SOURCES, countBySource, groupNames, keyOf, matches, type FilterState } from '../../src/client/panes/logger/filter'

const at = (patch: Partial<LogEntry> = {}): LogEntry => ({
  seq: 1,
  ts: 0,
  source: 'plugin',
  level: 'info',
  name: 'gwb-cli',
  msg: '挂上了',
  ...patch,
})

const base: FilterState = { level: 'debug', sources: ALL_SOURCES, key: '', search: '' }

describe('级别是门限，不是等值', () => {
  it('点 Warn 是「Warn 及以上」——error 也得看得见', () => {
    const f = { ...base, level: 'warn' as const }
    expect(matches(at({ level: 'error' }), f)).toBe(true)
    expect(matches(at({ level: 'warn' }), f)).toBe(true)
    expect(matches(at({ level: 'info' }), f)).toBe(false)
    expect(matches(at({ level: 'debug' }), f)).toBe(false)
  })

  it('debug 那一档就是全都要', () => {
    for (const level of ['error', 'warn', 'info', 'debug'] as const) {
      expect(matches(at({ level }), base)).toBe(true)
    }
  })
})

describe('路是多选', () => {
  it('关掉一路，那一路就不显示', () => {
    const f = { ...base, sources: new Set(['plugin', 'kernel'] as const) }
    expect(matches(at({ source: 'plugin' }), f)).toBe(true)
    expect(matches(at({ source: 'renderer' }), f)).toBe(false)
  })

  it('一路都不留就是空表', () => {
    const f = { ...base, sources: new Set([]) }
    expect(matches(at(), f)).toBe(false)
  })
})

describe('来源名用复合键', () => {
  it('不同路的同名不撞在一起', () => {
    const kernelInstall = at({ source: 'kernel', name: 'install' })
    const pluginInstall = at({ source: 'plugin', name: 'install' })
    expect(keyOf(kernelInstall)).not.toBe(keyOf(pluginInstall))
    const f = { ...base, key: keyOf(kernelInstall) }
    expect(matches(kernelInstall, f)).toBe(true)
    expect(matches(pluginInstall, f)).toBe(false)
  })

  it('空串是全部', () => {
    expect(matches(at({ name: '随便' }), base)).toBe(true)
  })
})

describe('搜索', () => {
  it('子串、不区分大小写，name 与 msg 都匹配', () => {
    expect(matches(at({ msg: 'ERR_MODULE_NOT_FOUND' }), { ...base, search: 'module' })).toBe(true)
    expect(matches(at({ name: 'gwb-shell' }), { ...base, search: 'SHELL' })).toBe(true)
    expect(matches(at({ msg: '挂上了' }), { ...base, search: '没挂' })).toBe(false)
  })

  it('**不当正则**——写错的表达式该匹配不到，不该抛', () => {
    expect(() => matches(at({ msg: 'a(b' }), { ...base, search: '(' })).not.toThrow()
    expect(matches(at({ msg: 'a(b' }), { ...base, search: '(' })).toBe(true)
    expect(matches(at({ msg: 'abc' }), { ...base, search: '.*' })).toBe(false)
  })
})

describe('四个维度是「与」', () => {
  it('全都得满足', () => {
    const e = at({ source: 'kernel', level: 'error', name: 'kernel', msg: '起不来' })
    expect(matches(e, { level: 'error', sources: new Set(['kernel'] as const), key: 'kernel|kernel', search: '起' })).toBe(
      true,
    )
    expect(matches(e, { level: 'error', sources: new Set(['kernel'] as const), key: 'kernel|kernel', search: '别的' })).toBe(
      false,
    )
  })
})

describe('给界面的两份汇总', () => {
  it('数每一路各多少条', () => {
    const got = countBySource([at({ source: 'plugin' }), at({ source: 'plugin' }), at({ source: 'renderer' })])
    expect(got).toEqual({ plugin: 2, kernel: 0, renderer: 1 })
  })

  it('来源名按路分组、组内排序、去重', () => {
    const got = groupNames([
      at({ source: 'kernel', name: 'stdin' }),
      at({ source: 'plugin', name: 'gwb-shell' }),
      at({ source: 'kernel', name: 'kernel' }),
      at({ source: 'plugin', name: 'gwb-shell' }),
    ])
    expect(got).toEqual([
      { source: 'plugin', names: ['gwb-shell'] },
      { source: 'kernel', names: ['kernel', 'stdin'] },
    ])
  })

  it('没有的路不出现在分组里', () => {
    expect(groupNames([at({ source: 'renderer', name: 'gwb' })])).toEqual([{ source: 'renderer', names: ['gwb'] }])
  })
})

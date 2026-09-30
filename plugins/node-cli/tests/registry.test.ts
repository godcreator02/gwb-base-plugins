import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createRegistry, normalize, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from '../src/registry.js'

/** 各平台都算绝对路径的一条 */
const ENTRY = path.resolve('/tmp/whatever/dist/cli.js')

describe('收窄一条 spec', () => {
  it('该填的填上：描述空着、参数空表、超时给默认值', () => {
    const r = normalize('gwb-foo', { name: 'foo.run', entry: ENTRY, effect: 'read' })
    expect(r).toMatchObject({
      name: 'foo.run',
      description: '',
      entry: ENTRY,
      args: [],
      timeoutMs: DEFAULT_TIMEOUT_MS,
      plugin: 'gwb-foo',
    })
  })

  it('参数拷一份——消费方事后改自己那个数组,影响不到表里这条', () => {
    const mine = ['--json']
    const r = normalize('gwb-foo', { name: 'foo.run', entry: ENTRY, effect: 'read', args: mine })
    mine.push('--被偷偷加的')
    expect(r.args).toEqual(['--json'])
  })

  it('空名字不收', () => {
    expect(() => normalize('gwb-foo', { name: '  ', entry: ENTRY, effect: 'read' })).toThrow(/空/)
  })

  it('名字里有空白不收', () => {
    expect(() => normalize('gwb-foo', { name: 'foo run', entry: ENTRY, effect: 'read' })).toThrow(/空白/)
  })

  it('没给 entry 不收', () => {
    expect(() => normalize('gwb-foo', { name: 'foo.run', entry: '', effect: 'read' })).toThrow(/entry/)
  })

  it('相对路径的 entry 不收——这儿不知道该相对于谁', () => {
    expect(() => normalize('gwb-foo', { name: 'foo.run', entry: './dist/cli.js', effect: 'read' })).toThrow(/绝对路径/)
  })

  it('超时给了个负数不收', () => {
    expect(() => normalize('gwb-foo', { name: 'foo.run', entry: ENTRY, effect: 'read', timeoutMs: -1 })).toThrow(/正数/)
  })

  it('仅拒绝越过 Node 定时器范围的超时', () => {
    expect(() => normalize('gwb-foo', { name: 'foo.run', entry: ENTRY, effect: 'read', timeoutMs: MAX_TIMEOUT_MS + 1 })).toThrow(
      /超了上限/,
    )
    // 边界上那一下要收
    expect(normalize('gwb-foo', { name: 'foo.run', entry: ENTRY, effect: 'read', timeoutMs: MAX_TIMEOUT_MS }).timeoutMs).toBe(
      MAX_TIMEOUT_MS,
    )
  })

  it('显式超时可以超过 110 秒，未设置仍为一分钟', () => {
    expect(normalize('gwb-foo', { name: 'foo.run', entry: ENTRY, effect: 'read', timeoutMs: 1_200_000 }).timeoutMs).toBe(1_200_000)
    expect(normalize('gwb-foo', { name: 'foo.run', entry: ENTRY, effect: 'read' }).timeoutMs).toBe(60_000)
  })

  it.each([NaN, Infinity, -Infinity, 0, -1])('拒绝无效超时 %s', (timeoutMs) => {
    expect(() => normalize('gwb-foo', { name: 'foo.run', entry: ENTRY, effect: 'read', timeoutMs })).toThrow()
  })
})

describe('注册表', () => {
  it('登记之后查得到、列得出', () => {
    const reg = createRegistry(() => {})
    reg.register('gwb-foo', { name: 'foo.run', entry: ENTRY, effect: 'read' })
    expect(reg.get('foo.run')?.plugin).toBe('gwb-foo')
    expect(reg.list().map((r) => r.name)).toEqual(['foo.run'])
  })

  it('撞名后来者赢,而且要告警', () => {
    const warn = vi.fn()
    const reg = createRegistry(warn)
    reg.register('gwb-foo', { name: 'same', entry: ENTRY, effect: 'read' })
    reg.register('gwb-bar', { name: 'same', entry: ENTRY, effect: 'read' })
    expect(reg.get('same')?.plugin).toBe('gwb-bar')
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]![0]).toMatch(/gwb-foo → gwb-bar/)
  })

  it('注销只收自己那份——HMR 时新的先注册覆盖、旧的后 dispose', () => {
    const reg = createRegistry(() => {})
    const offOld = reg.register('gwb-foo', { name: 'same', entry: ENTRY, effect: 'read' })
    reg.register('gwb-bar', { name: 'same', entry: ENTRY, effect: 'read' })
    // 旧的这时候才收:不该把新注册的那条一起带走
    offOld()
    expect(reg.get('same')?.plugin).toBe('gwb-bar')
  })

  it('注销之后就没了', () => {
    const reg = createRegistry(() => {})
    const off = reg.register('gwb-foo', { name: 'foo.run', entry: ENTRY, effect: 'read' })
    off()
    expect(reg.get('foo.run')).toBeUndefined()
    expect(reg.list()).toEqual([])
  })

  it('收两遍不出事', () => {
    const reg = createRegistry(() => {})
    const off = reg.register('gwb-foo', { name: 'foo.run', entry: ENTRY, effect: 'read' })
    off()
    off()
    expect(reg.list()).toEqual([])
  })
})

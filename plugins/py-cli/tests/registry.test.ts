import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createRegistry, normalize, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from '../src/registry.js'

const ROOT = path.resolve('/tmp/some-plugin')
const BASE = { packageRoot: ROOT, distName: 'thing', version: '1.0.0', command: 'thing' }

describe('收窄一条 spec', () => {
  it('该填的填上：描述空着、参数空表、超时给默认值', () => {
    const r = normalize('gwb-foo', { name: 'foo.run', ...BASE })
    expect(r).toMatchObject({
      name: 'foo.run',
      description: '',
      args: [],
      command: 'thing',
      module: undefined,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      plugin: 'gwb-foo',
    })
  })

  it('参数拷一份——消费方事后改自己那个数组,影响不到表里这条', () => {
    const mine = ['--json']
    const r = normalize('gwb-foo', { name: 'foo.run', ...BASE, args: mine })
    mine.push('--被偷偷加的')
    expect(r.args).toEqual(['--json'])
  })

  it('空名字不收', () => {
    expect(() => normalize('gwb-foo', { name: '  ', ...BASE })).toThrow(/空/)
  })

  it('名字里有空白不收', () => {
    expect(() => normalize('gwb-foo', { name: 'foo run', ...BASE })).toThrow(/空白/)
  })

  it('相对路径的 packageRoot 不收——这儿不知道该相对于谁', () => {
    expect(() => normalize('gwb-foo', { name: 'foo.run', ...BASE, packageRoot: './x' })).toThrow(/绝对路径/)
  })

  it('没给 distName / version 不收——守卫拿它比对装没装对', () => {
    expect(() => normalize('gwb-foo', { name: 'foo.run', ...BASE, distName: '' })).toThrow(/distName/)
    expect(() => normalize('gwb-foo', { name: 'foo.run', ...BASE, version: '' })).toThrow(/version/)
  })

  it('command 与 module 一个都不给,不收', () => {
    expect(() => normalize('gwb-foo', { name: 'foo.run', packageRoot: ROOT, distName: 'x', version: '1' })).toThrow(
      /command（入口点垫片）或 module/,
    )
  })

  it('command 与 module 都给,也不收——跑哪个说不清', () => {
    expect(() => normalize('gwb-foo', { name: 'foo.run', ...BASE, module: 'thing' })).toThrow(/只能给一个/)
  })

  it('module 形态收得下', () => {
    const r = normalize('gwb-foo', { name: 'foo.run', packageRoot: ROOT, distName: 'x', version: '1', module: 'x.cli' })
    expect(r).toMatchObject({ module: 'x.cli', command: undefined })
  })

  it('超时越过上限当场拒——内核那条通道 120 秒就硬超时了', () => {
    expect(() => normalize('gwb-foo', { name: 'foo.run', ...BASE, timeoutMs: MAX_TIMEOUT_MS + 1 })).toThrow(/超了上限/)
    expect(normalize('gwb-foo', { name: 'foo.run', ...BASE, timeoutMs: MAX_TIMEOUT_MS }).timeoutMs).toBe(MAX_TIMEOUT_MS)
  })

  it('超时给了个负数不收', () => {
    expect(() => normalize('gwb-foo', { name: 'foo.run', ...BASE, timeoutMs: 0 })).toThrow(/正数/)
  })
})

describe('注册表', () => {
  it('登记之后查得到、列得出', () => {
    const reg = createRegistry(() => {})
    reg.register('gwb-foo', { name: 'foo.run', ...BASE })
    expect(reg.get('foo.run')?.plugin).toBe('gwb-foo')
    expect(reg.list().map((r) => r.name)).toEqual(['foo.run'])
  })

  it('撞名后来者赢,而且要告警', () => {
    const warn = vi.fn()
    const reg = createRegistry(warn)
    reg.register('gwb-foo', { name: 'same', ...BASE })
    reg.register('gwb-bar', { name: 'same', ...BASE })
    expect(reg.get('same')?.plugin).toBe('gwb-bar')
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]![0]).toMatch(/gwb-foo → gwb-bar/)
  })

  it('注销只收自己那份——HMR 时新的先注册覆盖、旧的后 dispose', () => {
    const reg = createRegistry(() => {})
    const offOld = reg.register('gwb-foo', { name: 'same', ...BASE })
    reg.register('gwb-bar', { name: 'same', ...BASE })
    offOld()
    expect(reg.get('same')?.plugin).toBe('gwb-bar')
  })

  it('注销之后就没了,收两遍也不出事', () => {
    const reg = createRegistry(() => {})
    const off = reg.register('gwb-foo', { name: 'foo.run', ...BASE })
    off()
    off()
    expect(reg.get('foo.run')).toBeUndefined()
    expect(reg.list()).toEqual([])
  })
})

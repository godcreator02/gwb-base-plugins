import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkCwd, parseInvocation } from '../src/invoke.js'

describe('parseInvocation：总线那头递来的参数', () => {
  it('给一串就是追加参数,逐项转字符串', () => {
    expect(parseInvocation(['--watch', 3])).toEqual({ args: ['--watch', '3'] })
  })

  it('给 { args, cwd } 两样都认', () => {
    expect(parseInvocation({ args: ['a'], cwd: 'D:\\x' })).toEqual({ args: ['a'], cwd: 'D:\\x' })
  })

  it('只给 cwd 也行,args 空表', () => {
    expect(parseInvocation({ cwd: '/tmp' })).toEqual({ args: [], cwd: '/tmp' })
  })

  it('cwd 原样带出不收窄——给错了要让调用方看见拒绝,不是静默当没给', () => {
    expect(parseInvocation({ cwd: 42 })).toEqual({ args: [], cwd: 42 })
    expect(parseInvocation({ args: ['a'] })).toEqual({ args: ['a'] })
  })

  it('别的当空', () => {
    expect(parseInvocation(undefined)).toEqual({ args: [] })
    expect(parseInvocation('x')).toEqual({ args: [] })
    expect(parseInvocation(null)).toEqual({ args: [] })
    expect(parseInvocation({ args: 'not-a-list' })).toEqual({ args: [] })
  })
})

describe('checkCwd：按次给的工作目录', () => {
  const yes = (): boolean => true
  const no = (): boolean => false
  const abs = path.resolve('/some/where')

  it('不给就是不给——用登记时的缺省', () => {
    expect(checkCwd(undefined, no)).toEqual({ ok: true, cwd: undefined })
  })

  it('存在的目录的绝对路径才收', () => {
    expect(checkCwd(abs, yes)).toEqual({ ok: true, cwd: abs })
  })

  it('不是字符串、空串:拒,而且说清要什么', () => {
    for (const bad of [42, null, '', {}]) {
      const res = checkCwd(bad, yes)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toMatch(/绝对路径/)
    }
  })

  it('相对路径:拒——这儿不知道该相对于谁', () => {
    const res = checkCwd('./x', yes)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/绝对路径/)
  })

  it('不存在或不是目录:拒,话里带着那个路径', () => {
    const res = checkCwd(abs, no)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain(abs)
  })

  it('真的问盘:tmpdir 在,它底下一个乱编的名字不在', () => {
    expect(checkCwd(os.tmpdir())).toEqual({ ok: true, cwd: os.tmpdir() })
    expect(checkCwd(path.join(os.tmpdir(), 'gwb-cli-no-such-dir-8f3a')).ok).toBe(false)
  })
})

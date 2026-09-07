import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../src/registry.js'

const noop = (): void => {}

describe('createRegistry', () => {
  it('注册了就调得到', async () => {
    const cli = createRegistry(noop)
    cli.register({ name: 'a.b', description: '试', plugin: 'p' }, (args) => ({ got: args }))
    expect(await cli.run('a.b', { n: 1 })).toEqual({ ok: true, data: { got: { n: 1 } } })
  })

  it('没注册的命令回 ok:false,而且说得出是哪一条', async () => {
    const cli = createRegistry(noop)
    const res = (await cli.run('nope', undefined)) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('nope')
  })

  it('handler 自己带了 ok 就原样透传,没带就包成 data', async () => {
    const cli = createRegistry(noop)
    cli.register({ name: 'raw', plugin: 'p' }, () => ({ ok: false, error: '我自己判的' }))
    cli.register({ name: 'wrapped', plugin: 'p' }, () => 42)
    expect(await cli.run('raw', undefined)).toEqual({ ok: false, error: '我自己判的' })
    expect(await cli.run('wrapped', undefined)).toEqual({ ok: true, data: 42 })
  })

  it('handler 抛出来不许炸到调用方,回成一句错', async () => {
    const cli = createRegistry(noop)
    cli.register({ name: 'boom', plugin: 'p' }, () => {
      throw new Error('炸了')
    })
    const res = (await cli.run('boom', undefined)) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('炸了')
  })

  it('异步 handler 也认', async () => {
    const cli = createRegistry(noop)
    cli.register({ name: 'slow', plugin: 'p' }, async () => 'ok了')
    expect(await cli.run('slow', undefined)).toEqual({ ok: true, data: 'ok了' })
  })

  it('list 报出注册过的条目', () => {
    const cli = createRegistry(noop)
    cli.register({ name: 'x', description: '甲', plugin: 'p1' }, noop)
    cli.register({ name: 'y', plugin: 'p2' }, noop)
    expect(cli.list()).toEqual([
      { name: 'x', description: '甲', plugin: 'p1' },
      { name: 'y', description: '', plugin: 'p2' },
    ])
  })

  it('撞名是后来者赢——但不许静默,得告警说清谁换了谁', async () => {
    const warn = vi.fn()
    const cli = createRegistry(warn)
    cli.register({ name: 'dup', plugin: '先来的' }, () => 1)
    cli.register({ name: 'dup', plugin: '后来的' }, () => 2)
    expect(await cli.run('dup', undefined)).toEqual({ ok: true, data: 2 })
    expect(warn).toHaveBeenCalledOnce()
    const msg = String(warn.mock.calls[0]?.[0])
    expect(msg).toContain('dup')
    expect(msg).toContain('先来的')
    expect(msg).toContain('后来的')
  })

  it('注销只收自己那份:撞名后先卸的不该把接手的一起带走', async () => {
    const cli = createRegistry(noop)
    const offFirst = cli.register({ name: 'dup', plugin: '先来的' }, () => 1)
    cli.register({ name: 'dup', plugin: '后来的' }, () => 2)
    offFirst()
    expect(await cli.run('dup', undefined)).toEqual({ ok: true, data: 2 })
  })

  it('注销之后就调不到了', async () => {
    const cli = createRegistry(noop)
    const off = cli.register({ name: 'gone', plugin: 'p' }, () => 1)
    off()
    expect((await cli.run('gone', undefined)) as { ok: boolean }).toMatchObject({ ok: false })
    expect(cli.list()).toEqual([])
  })
})

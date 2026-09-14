import { describe, expect, it, vi } from 'vitest'
import { createRegistry, type RegistryLog } from '../src/registry.js'

const noop = (): void => {}
/** 不出声的那张嘴。只关心告警的用例自己传 vi.fn() */
const silent: RegistryLog = { info: noop, warn: noop }

describe('createRegistry', () => {
  it('注册了就调得到', async () => {
    const cli = createRegistry(silent)
    cli.register({ name: 'a.b', description: '试', plugin: 'p' }, (args) => ({ got: args }))
    expect(await cli.run('a.b', { n: 1 })).toEqual({ ok: true, data: { got: { n: 1 } } })
  })

  it('没注册的命令回 ok:false,而且说得出是哪一条', async () => {
    const cli = createRegistry(silent)
    const res = (await cli.run('nope', undefined)) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('nope')
  })

  it('handler 自己带了 ok 就原样透传,没带就包成 data', async () => {
    const cli = createRegistry(silent)
    cli.register({ name: 'raw', plugin: 'p' }, () => ({ ok: false, error: '我自己判的' }))
    cli.register({ name: 'wrapped', plugin: 'p' }, () => 42)
    expect(await cli.run('raw', undefined)).toEqual({ ok: false, error: '我自己判的' })
    expect(await cli.run('wrapped', undefined)).toEqual({ ok: true, data: 42 })
  })

  it('handler 抛出来不许炸到调用方,回成一句错', async () => {
    const cli = createRegistry(silent)
    cli.register({ name: 'boom', plugin: 'p' }, () => {
      throw new Error('炸了')
    })
    const res = (await cli.run('boom', undefined)) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('炸了')
  })

  it('异步 handler 也认', async () => {
    const cli = createRegistry(silent)
    cli.register({ name: 'slow', plugin: 'p' }, async () => 'ok了')
    expect(await cli.run('slow', undefined)).toEqual({ ok: true, data: 'ok了' })
  })

  it('list 报出注册过的条目', () => {
    const cli = createRegistry(silent)
    cli.register({ name: 'x', description: '甲', usage: '参数 { n }', plugin: 'p1' }, noop)
    cli.register({ name: 'y', plugin: 'p2' }, noop)
    expect(cli.list()).toEqual([
      { name: 'x', description: '甲', usage: '参数 { n }', plugin: 'p1' },
      { name: 'y', description: '', usage: '', plugin: 'p2' },
    ])
  })

  it('plugin 写短名 warn 一句、照挂不拦——软守卫逮漏网,不升格失败', () => {
    const log = { info: vi.fn(), warn: vi.fn() }
    const cli = createRegistry(log)
    cli.register({ name: 'a.b', plugin: 'gwb-old' }, noop)
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('gwb-old'))
    expect(cli.list()).toHaveLength(1)
    log.warn.mockClear()
    cli.register({ name: 'c.d', plugin: '@godcreator/gwb-new' }, noop)
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('撞名之后条目整个跟着后来者走', () => {
    const cli = createRegistry(silent)
    cli.register({ name: 'dup', plugin: '@t/先来的' }, () => 1)
    cli.register({ name: 'dup', plugin: '@t/后来的' }, () => 2)
    expect(cli.list()).toEqual([{ name: 'dup', description: '', usage: '', plugin: '@t/后来的' }])
  })

  it('登记与执行都出声:成了 info,失败与不存在是 warn', async () => {
    const log = { info: vi.fn(), warn: vi.fn() }
    const cli = createRegistry(log)
    cli.register({ name: 'fine', plugin: '@t/p' }, () => 1)
    cli.register({ name: 'sad', plugin: '@t/p' }, () => ({ ok: false, error: '业务上没成' }))
    await cli.run('fine', undefined)
    await cli.run('sad', undefined)
    await cli.run('nope', undefined)
    // info 里有登记、也有「跑完了」;warn 恰好两条:业务失败与不存在
    const infos = log.info.mock.calls.map((c) => String(c[0]))
    expect(infos.some((m) => m.includes('fine') && m.includes('跑完了'))).toBe(true)
    expect(log.warn).toHaveBeenCalledTimes(2)
    const warns = log.warn.mock.calls.map((c) => String(c[0]))
    expect(warns[0]).toContain('sad')
    expect(warns[1]).toContain('nope')
  })

  it('撞名是后来者赢——但不许静默,得告警说清谁换了谁', async () => {
    const warn = vi.fn()
    const cli = createRegistry({ info: noop, warn })
    cli.register({ name: 'dup', plugin: '@t/先来的' }, () => 1)
    cli.register({ name: 'dup', plugin: '@t/后来的' }, () => 2)
    expect(await cli.run('dup', undefined)).toEqual({ ok: true, data: 2 })
    expect(warn).toHaveBeenCalledOnce()
    const msg = String(warn.mock.calls[0]?.[0])
    expect(msg).toContain('dup')
    expect(msg).toContain('先来的')
    expect(msg).toContain('后来的')
  })

  it('注销只收自己那份:撞名后先卸的不该把接手的一起带走', async () => {
    const cli = createRegistry(silent)
    const offFirst = cli.register({ name: 'dup', plugin: '@t/先来的' }, () => 1)
    cli.register({ name: 'dup', plugin: '@t/后来的' }, () => 2)
    offFirst()
    expect(await cli.run('dup', undefined)).toEqual({ ok: true, data: 2 })
  })

  it('注销之后就调不到了', async () => {
    const cli = createRegistry(silent)
    const off = cli.register({ name: 'gone', plugin: 'p' }, () => 1)
    off()
    expect((await cli.run('gone', undefined)) as { ok: boolean }).toMatchObject({ ok: false })
    expect(cli.list()).toEqual([])
  })
})

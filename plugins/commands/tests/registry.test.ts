import { describe, expect, it, vi } from 'vitest'
import { createRegistry, type RegistryLog } from '../src/registry.js'

const noop = (): void => {}
/** 不写日志的假日志函数。要检查告警的用例自己传 vi.fn() */
const silent: RegistryLog = { info: noop, warn: noop }

describe('createRegistry', () => {
  it('登记了就能调用', async () => {
    const cli = createRegistry(silent)
    cli.register({ name: 'a.b', description: '试', plugin: 'p' }, (args) => ({ got: args }))
    expect(await cli.run('a.b', { n: 1 })).toEqual({ ok: true, data: { got: { n: 1 } } })
  })

  it('没登记的命令回 ok: false，原因里带命令名', async () => {
    const cli = createRegistry(silent)
    const res = (await cli.run('nope', undefined)) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('nope')
  })

  it('处理函数返回带 ok 的对象就原样返回，否则包成 data', async () => {
    const cli = createRegistry(silent)
    cli.register({ name: 'raw', plugin: 'p' }, () => ({ ok: false, error: '我自己判的' }))
    cli.register({ name: 'wrapped', plugin: 'p' }, () => 42)
    expect(await cli.run('raw', undefined)).toEqual({ ok: false, error: '我自己判的' })
    expect(await cli.run('wrapped', undefined)).toEqual({ ok: true, data: 42 })
  })

  it('处理函数抛错不抛给调用方，回成失败回执', async () => {
    const cli = createRegistry(silent)
    cli.register({ name: 'boom', plugin: 'p' }, () => {
      throw new Error('出错了')
    })
    const res = (await cli.run('boom', undefined)) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('出错了')
  })

  it('异步的处理函数也支持', async () => {
    const cli = createRegistry(silent)
    cli.register({ name: 'slow', plugin: 'p' }, async () => 'ok了')
    expect(await cli.run('slow', undefined)).toEqual({ ok: true, data: 'ok了' })
  })

  it('list 返回登记过的命令', () => {
    const cli = createRegistry(silent)
    cli.register({ name: 'x', description: '甲', usage: '参数 { n }', plugin: 'p1' }, noop)
    cli.register({ name: 'y', plugin: 'p2' }, noop)
    expect(cli.list()).toEqual([
      { name: 'x', description: '甲', usage: '参数 { n }', plugin: 'p1' },
      { name: 'y', description: '', usage: '', plugin: 'p2' },
    ])
  })

  it('plugin 写成短名时告警一句，照常登记，不当成失败', () => {
    const log = { info: vi.fn(), warn: vi.fn() }
    const cli = createRegistry(log)
    cli.register({ name: 'a.b', plugin: 'gwb-old' }, noop)
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('gwb-old'))
    expect(cli.list()).toHaveLength(1)
    log.warn.mockClear()
    cli.register({ name: 'c.d', plugin: '@godcreator/gwb-new' }, noop)
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('同名登记后，命令表里的记录换成后登记的那条', () => {
    const cli = createRegistry(silent)
    cli.register({ name: 'dup', plugin: '@t/先来的' }, () => 1)
    cli.register({ name: 'dup', plugin: '@t/后来的' }, () => 2)
    expect(cli.list()).toEqual([{ name: 'dup', description: '', usage: '', plugin: '@t/后来的' }])
  })

  it('登记与执行都写日志：成功写 info，失败与找不到命令写 warn', async () => {
    const log = { info: vi.fn(), warn: vi.fn() }
    const cli = createRegistry(log)
    cli.register({ name: 'fine', plugin: '@t/p' }, () => 1)
    cli.register({ name: 'sad', plugin: '@t/p' }, () => ({ ok: false, error: '执行了但结果是失败' }))
    await cli.run('fine', undefined)
    await cli.run('sad', undefined)
    await cli.run('nope', undefined)
    // info 里有登记、也有「执行完成」；warn 恰好两条：返回失败与找不到命令
    const infos = log.info.mock.calls.map((c) => String(c[0]))
    expect(infos.some((m) => m.includes('fine') && m.includes('执行完成'))).toBe(true)
    expect(log.warn).toHaveBeenCalledTimes(2)
    const warns = log.warn.mock.calls.map((c) => String(c[0]))
    expect(warns[0]).toContain('sad')
    expect(warns[1]).toContain('nope')
  })

  it('同名时后登记的生效，并告警写明原来是谁、现在是谁', async () => {
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

  it('注销只删自己那条：同名被替换后，先登记的一方注销不影响接手的那条', async () => {
    const cli = createRegistry(silent)
    const offFirst = cli.register({ name: 'dup', plugin: '@t/先来的' }, () => 1)
    cli.register({ name: 'dup', plugin: '@t/后来的' }, () => 2)
    offFirst()
    expect(await cli.run('dup', undefined)).toEqual({ ok: true, data: 2 })
  })

  it('注销之后就调用不到了', async () => {
    const cli = createRegistry(silent)
    const off = cli.register({ name: 'gone', plugin: 'p' }, () => 1)
    off()
    expect((await cli.run('gone', undefined)) as { ok: boolean }).toMatchObject({ ok: false })
    expect(cli.list()).toEqual([])
  })
})

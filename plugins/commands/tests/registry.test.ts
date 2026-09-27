import { describe, expect, it, vi } from 'vitest'
import { checkedCommandDef, createRegistry, type GwbCommandDef, type RegisteredCommandDef, type RegistryLog } from '../src/registry.js'

const noop = (): void => {}
/** 不写日志的假日志函数。要检查告警的用例自己传 vi.fn() */
const silent: RegistryLog = { debug: noop, info: noop, warn: noop }

/** 检查过的定义：命令表只收这种 */
function registeredDef(name: string, plugin = '@t/p'): RegisteredCommandDef {
  return { name, description: '试', usage: '无参数', plugin }
}

describe('checkedCommandDef', () => {
  const complete: GwbCommandDef = { name: 'a.b', description: '一句话', usage: '参数 { n }' }

  it('plugin 不给就填调用方的包名', () => {
    expect(checkedCommandDef('@t/caller', complete)).toEqual({ ...complete, plugin: '@t/caller' })
  })

  it('plugin 给了且与调用方的包名相同，照常通过', () => {
    expect(checkedCommandDef('@t/caller', { ...complete, plugin: '@t/caller' })).toEqual({ ...complete, plugin: '@t/caller' })
  })

  it('plugin 与调用方的包名不同就抛错，消息里写着两者', () => {
    expect(() => checkedCommandDef('@t/caller', { ...complete, plugin: 'gwb-caller' })).toThrow(/gwb-caller.*@t\/caller/)
  })

  it.each([
    ['name', { ...complete, name: '' }, /@t\/caller.*缺 name/],
    ['name', { ...complete, name: '  ' }, /缺 name/],
    ['description', { ...complete, description: '' }, /@t\/caller 的命令 a\.b 缺 description/],
    ['usage', { ...complete, usage: '' }, /@t\/caller 的命令 a\.b 缺 usage.*无参数/],
  ])('%s 为空串被拒，消息写明包、命令、缺哪个字段、该怎么写', (_field, def, message) => {
    expect(() => checkedCommandDef('@t/caller', def)).toThrow(message)
  })

  it('effect 与 hiddenFromAgents 写了就原样留下，没写就没有这两项', () => {
    const marked = checkedCommandDef('@t/caller', { ...complete, effect: 'external', hiddenFromAgents: true })
    expect(marked).toEqual({ ...complete, plugin: '@t/caller', effect: 'external', hiddenFromAgents: true })
    const unmarked = checkedCommandDef('@t/caller', complete)
    expect('effect' in unmarked).toBe(false)
    expect('hiddenFromAgents' in unmarked).toBe(false)
  })

  it('effect 不是 read / write / external 就抛错，消息里列出能写的值', () => {
    const def = { ...complete, effect: 'readonly' } as unknown as GwbCommandDef
    expect(() => checkedCommandDef('@t/caller', def)).toThrow(/a\.b 的 effect.*readonly.*read \/ write \/ external/)
  })

  it('hiddenFromAgents 只收 true', () => {
    const def = { ...complete, hiddenFromAgents: false } as unknown as GwbCommandDef
    expect(() => checkedCommandDef('@t/caller', def)).toThrow(/hiddenFromAgents.*只能是 true/)
  })

  it.each(['name', 'description', 'usage'] as const)('%s 缺失或不是字符串被拒', (field) => {
    const missing = { ...complete } as Record<string, unknown>
    delete missing[field]
    expect(() => checkedCommandDef('@t/caller', missing as unknown as GwbCommandDef)).toThrow(`缺 ${field}`)
    const notString = { ...complete, [field]: 42 } as unknown as GwbCommandDef
    expect(() => checkedCommandDef('@t/caller', notString)).toThrow(`缺 ${field}`)
  })
})

describe('createRegistry', () => {
  it('登记了就能调用', async () => {
    const cli = createRegistry(silent)
    cli.register(registeredDef('a.b'), (args) => ({ got: args }))
    expect(await cli.run('a.b', { n: 1 })).toEqual({ ok: true, data: { got: { n: 1 } } })
  })

  it('调用时带的来源原样交给处理函数；不带就是 plugin', async () => {
    const cli = createRegistry(silent)
    const contextsSeen: unknown[] = []
    cli.register(registeredDef('a.who'), (_args, context) => {
      contextsSeen.push(context)
      return null
    })
    await cli.run('a.who', undefined, { via: 'mcp' })
    await cli.run('a.who', undefined, { via: 'ui' })
    await cli.run('a.who', undefined)
    expect(contextsSeen).toEqual([{ via: 'mcp' }, { via: 'ui' }, { via: 'plugin' }])
  })

  it('没登记的命令回 ok: false，原因里带命令名', async () => {
    const cli = createRegistry(silent)
    const res = (await cli.run('nope', undefined)) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('nope')
  })

  it('处理函数返回带 ok 的对象就原样返回，否则包成 data', async () => {
    const cli = createRegistry(silent)
    cli.register(registeredDef('raw'), () => ({ ok: false, error: '我自己判的' }))
    cli.register(registeredDef('wrapped'), () => 42)
    expect(await cli.run('raw', undefined)).toEqual({ ok: false, error: '我自己判的' })
    expect(await cli.run('wrapped', undefined)).toEqual({ ok: true, data: 42 })
  })

  it('处理函数抛错不抛给调用方，回成失败回执', async () => {
    const cli = createRegistry(silent)
    cli.register(registeredDef('boom'), () => {
      throw new Error('出错了')
    })
    const res = (await cli.run('boom', undefined)) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('出错了')
  })

  it('异步的处理函数也支持', async () => {
    const cli = createRegistry(silent)
    cli.register(registeredDef('slow'), async () => 'ok了')
    expect(await cli.run('slow', undefined)).toEqual({ ok: true, data: 'ok了' })
  })

  it('list 返回登记过的命令', () => {
    const cli = createRegistry(silent)
    cli.register({ name: 'x', description: '甲', usage: '参数 { n }', plugin: '@t/p1' }, noop)
    cli.register(registeredDef('y', '@t/p2'), noop)
    expect(cli.list()).toEqual([
      { name: 'x', description: '甲', usage: '参数 { n }', plugin: '@t/p1' },
      { name: 'y', description: '试', usage: '无参数', plugin: '@t/p2' },
    ])
  })

  it('同名登记后，命令表里的记录换成后登记的那条', () => {
    const cli = createRegistry(silent)
    cli.register(registeredDef('dup', '@t/先来的'), () => 1)
    cli.register(registeredDef('dup', '@t/后来的'), () => 2)
    expect(cli.list()).toEqual([registeredDef('dup', '@t/后来的')])
  })

  it('只读命令（effect 是 read）执行成功写 debug，不写 info；失败照旧写 warn', async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const cli = createRegistry(log)
    cli.register({ ...registeredDef('peek'), effect: 'read' }, () => 1)
    cli.register({ ...registeredDef('peek.receipt'), effect: 'read' }, () => ({ ok: true, data: 1 }))
    cli.register({ ...registeredDef('peek.sad'), effect: 'read' }, () => ({ ok: false, error: '读失败了' }))
    await cli.run('peek', undefined)
    await cli.run('peek.receipt', undefined)
    await cli.run('peek.sad', undefined)
    const debugs = log.debug.mock.calls.map((c) => String(c[0]))
    expect(debugs).toEqual(['命令 peek 执行完成', '命令 peek.receipt 执行完成'])
    expect(log.info.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('执行完成'))).toEqual([])
    expect(log.warn.mock.calls.map((c) => String(c[0]))).toEqual(['命令 peek.sad 返回失败：读失败了'])
  })

  it('改东西的与没标 effect 的命令执行成功照旧写 info', async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const cli = createRegistry(log)
    cli.register({ ...registeredDef('change'), effect: 'write' }, () => 1)
    cli.register({ ...registeredDef('notify'), effect: 'external' }, () => ({ ok: true }))
    cli.register(registeredDef('unmarked'), () => 1)
    await cli.run('change', undefined)
    await cli.run('notify', undefined)
    await cli.run('unmarked', undefined)
    const infos = log.info.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('执行完成'))
    expect(infos).toEqual(['命令 change 执行完成', '命令 notify 执行完成', '命令 unmarked 执行完成'])
    expect(log.debug).not.toHaveBeenCalled()
  })

  it('登记与执行都写日志：成功写 info，失败与找不到命令写 warn', async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const cli = createRegistry(log)
    cli.register(registeredDef('fine'), () => 1)
    cli.register(registeredDef('sad'), () => ({ ok: false, error: '执行了但结果是失败' }))
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
    const cli = createRegistry({ debug: noop, info: noop, warn })
    cli.register(registeredDef('dup', '@t/先来的'), () => 1)
    cli.register(registeredDef('dup', '@t/后来的'), () => 2)
    expect(await cli.run('dup', undefined)).toEqual({ ok: true, data: 2 })
    expect(warn).toHaveBeenCalledOnce()
    const msg = String(warn.mock.calls[0]?.[0])
    expect(msg).toContain('dup')
    expect(msg).toContain('先来的')
    expect(msg).toContain('后来的')
  })

  it('注销只删自己那条：同名被替换后，先登记的一方注销不影响接手的那条', async () => {
    const cli = createRegistry(silent)
    const offFirst = cli.register(registeredDef('dup', '@t/先来的'), () => 1)
    cli.register(registeredDef('dup', '@t/后来的'), () => 2)
    offFirst()
    expect(await cli.run('dup', undefined)).toEqual({ ok: true, data: 2 })
  })

  it('注销之后就调用不到了', async () => {
    const cli = createRegistry(silent)
    const off = cli.register(registeredDef('gone'), () => 1)
    off()
    expect((await cli.run('gone', undefined)) as { ok: boolean }).toMatchObject({ ok: false })
    expect(cli.list()).toEqual([])
  })
})

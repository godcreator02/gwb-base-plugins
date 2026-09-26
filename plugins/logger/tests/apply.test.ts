import path from 'node:path'
import { Context } from 'cordis'
import type { Plugin } from 'cordis'
import { describe, expect, it } from 'vitest'
import type { GwbResult } from '@godcreator/gwb-kernel-desktop'
import * as loggerPlugin from '../src/index.js'
import type { LogEntry } from '../src/index.js'

interface RegisteredCommand {
  def: { name: string; description?: string; usage?: string; plugin: string }
  handler: (args?: unknown) => unknown
}

/** 只记登记与注销的命令总线替身 */
function fakeCommandBus() {
  const commands = new Map<string, RegisteredCommand>()
  return {
    commands,
    register(def: RegisteredCommand['def'], handler: RegisteredCommand['handler']) {
      commands.set(def.name, { def, handler })
      return () => void commands.delete(def.name)
    },
    list: () => [...commands.values()].map((c) => c.def),
    run: async (commandName: string, args?: unknown): Promise<GwbResult> => ({ ok: true, data: await commands.get(commandName)!.handler(args) }),
  }
}

/** 真实的 cordis 根上下文，提供内核与命令总线的替身，再装上日志插件 */
async function bootLogger(options: { before?: (root: Context) => void } = {}) {
  const root = new Context()
  const emitted: unknown[] = []
  const bus = fakeCommandBus()
  root.provide('gwbKernel', { dataDir: path.join('D:', 'home-x'), version: 'test', emit: (payload: unknown) => emitted.push(payload), setShell: () => () => {} })
  root.provide('gwbCommands', bus)
  options.before?.(root)
  const plugin: Plugin = loggerPlugin as unknown as Plugin
  const fiber = await root.plugin(plugin)
  const run = (commandName: string, args?: unknown): unknown => bus.commands.get(commandName)!.handler(args)
  return { root, emitted, bus, fiber, run }
}

const linesOf = (emitted: unknown[]): LogEntry[] =>
  emitted.filter((p): p is { t: string; line: LogEntry } => (p as { t?: string }).t === loggerPlugin.EVENT).map((p) => p.line)

describe('日志插件装上之后', () => {
  it('提供服务 gwbLogger', async () => {
    const { root } = await bootLogger()
    let seen: unknown
    await root.inject(['gwbLogger'], (ctx) => {
      seen = ctx.gwbLogger
    })
    expect(seen).toBeDefined()
  })

  it('登记 logger.backlog 与 logger.where，plugin 写包名；插件卸载时两条都注销', async () => {
    const { bus, fiber } = await bootLogger()
    expect(bus.list()).toEqual([
      {
        name: 'logger.backlog',
        description: '工作台启动以来的日志，可按级别、logger 名筛、只取最近几条',
        usage: loggerPlugin.BACKLOG_USAGE,
        plugin: '@godcreator/gwb-logger',
        effect: 'read',
      },
      { name: 'logger.where', description: 'home 与日志文件在哪', usage: '无参数', plugin: '@godcreator/gwb-logger', effect: 'read' },
    ])
    await fiber.dispose()
    expect(bus.list()).toEqual([])
  })

  it('logger.where 回 home 与其下的 gwb.log', async () => {
    const { run } = await bootLogger()
    expect(run('logger.where')).toEqual({ home: path.join('D:', 'home-x'), logFile: path.join('D:', 'home-x', 'gwb.log') })
  })

  it('每条新日志经 gwbKernel.emit 推 { t: gwb-logger, line }，并进 logger.backlog', async () => {
    const { root, emitted, run } = await bootLogger()
    root.logger('some-plugin').warn('出事了 %s', 'x')
    const lines = linesOf(emitted)
    const last = lines.at(-1)!
    expect(last).toMatchObject({ source: 'plugin', level: 'warn', name: 'some-plugin' })
    expect(last.msg).toContain('出事了 x')
    expect(typeof last.ts).toBe('number')
    const backlog = run('logger.backlog') as LogEntry[]
    expect(backlog.at(-1)).toEqual(last)
  })

  it('来源按 logger 名字分，级别照 cordis 的 type', async () => {
    const { root, emitted } = await bootLogger()
    root.logger('kernel').info('k')
    root.logger('loader').warn('l')
    root.logger('renderer').error('r')
    root.logger('p').info('p')
    const lines = linesOf(emitted).slice(-4)
    expect(lines.map((l) => [l.source, l.level])).toEqual([
      ['kernel', 'info'],
      ['kernel', 'warn'],
      ['renderer', 'error'],
      ['plugin', 'info'],
    ])
  })

  it('装上之前的日志从 cordis 的缓冲补进 backlog，seq 从 1 起连续递增、不重复', async () => {
    const { root, run } = await bootLogger({ before: (r) => r.logger('early').info('装之前') })
    root.logger('late').info('装之后')
    const backlog = run('logger.backlog') as LogEntry[]
    expect(backlog.some((e) => e.name === 'early' && e.msg.includes('装之前'))).toBe(true)
    expect(backlog.at(-1)!.msg).toContain('装之后')
    expect(backlog.map((e) => e.seq)).toEqual(backlog.map((_, i) => i + 1))
  })

  it('就绪时以 gwb-logger 的名字写一条 info', async () => {
    const { run } = await bootLogger()
    const backlog = run('logger.backlog') as LogEntry[]
    expect(backlog.some((e) => e.name === 'gwb-logger' && e.level === 'info' && e.source === 'plugin')).toBe(true)
  })

  it('backlog 最多留两千条，超了从最早的丢；返回的是副本', async () => {
    const { root, run } = await bootLogger()
    for (let i = 0; i < 2100; i++) root.logger('flood').info(`第 ${i} 条`)
    const backlog = run('logger.backlog') as LogEntry[]
    expect(backlog).toHaveLength(2000)
    expect(backlog.at(-1)!.msg).toContain('第 2099 条')
    expect(backlog[0]!.msg).toContain('第 100 条')
    backlog.length = 0
    expect(run('logger.backlog') as LogEntry[]).toHaveLength(2000)
  })

  it('logger.backlog 带 minLevel、name 先筛，limit 再取筛完之后最近的几条', async () => {
    const { root, run } = await bootLogger()
    root.logger('a').info('a1')
    root.logger('a').warn('a2')
    root.logger('b').error('b1')
    root.logger('a').error('a3')
    expect((run('logger.backlog', { minLevel: 'warn', limit: 2 }) as LogEntry[]).map((e) => e.msg)).toEqual(['b1', 'a3'])
    expect((run('logger.backlog', { name: 'a', minLevel: 'warn' }) as LogEntry[]).map((e) => e.msg)).toEqual(['a2', 'a3'])
    expect(run('logger.backlog', { limit: 1 }) as LogEntry[]).toHaveLength(1)
  })

  it.each([
    [{ limit: 0 }, /limit 要是正整数/],
    [{ limit: 1.5 }, /limit 要是正整数/],
    [{ minLevel: 'warning' }, /minLevel 只能是 debug \/ info \/ warn \/ error/],
    [{ name: '' }, /name 要是非空字符串/],
    [{ lines: 5 }, /不认识参数 lines/],
    ['50', /参数要是对象/],
  ])('logger.backlog 参数不对就报错：%j', async (args, message) => {
    const { run } = await bootLogger()
    expect(() => run('logger.backlog', args)).toThrow(message)
  })
})

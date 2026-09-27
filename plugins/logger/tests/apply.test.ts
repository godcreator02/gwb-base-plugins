import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from 'cordis'
import type { Plugin } from 'cordis'
import { afterEach, describe, expect, it } from 'vitest'
import type { GwbResult } from '@godcreator/gwb-commands'
import * as loggerPlugin from '../src/index.js'
import type { LogEntry, LogQueryResult } from '../src/index.js'

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

const homesToRemove: string[] = []

afterEach(() => {
  for (const home of homesToRemove.splice(0)) fs.rmSync(home, { recursive: true, force: true })
})

function makeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-logger-'))
  homesToRemove.push(home)
  return home
}

/** 真实的 cordis 根上下文，提供内核与命令总线的替身，再装上日志插件 */
async function bootLogger(home: string) {
  const root = new Context()
  const bus = fakeCommandBus()
  root.provide('gwbKernel', { dataDir: home, version: 'test', emit: () => {}, setShell: () => () => {} })
  root.provide('gwbCommands', bus)
  const fiber = await root.plugin(loggerPlugin as unknown as Plugin)
  const query = async (args?: unknown): Promise<LogQueryResult> => (await bus.commands.get('logger.query')!.handler(args)) as LogQueryResult
  return { bus, fiber, query }
}

const LEVELS = ['debug', 'info', 'warn', 'error'] as const

/** 第 index 条：级别轮换，正文带中文，让按块读时块边界落在多字节字符中间 */
function entry(index: number, overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    ts: new Date(Date.UTC(2026, 8, 27, 0, 0, 0) + index).toISOString(),
    level: LEVELS[index % 4]!,
    source: 'plugin',
    name: `gwb-p${index % 3}`,
    msg: `第 ${index} 条：写点中文凑长度，让一行过一百字节`,
    ...overrides,
  }
}

const lineOf = ({ ts, level, source, name, msg }: LogEntry): string => `${JSON.stringify({ ts, level, source, name, msg })}\n`

function appendEntries(file: string, entries: readonly LogEntry[]): void {
  fs.appendFileSync(file, entries.map(lineOf).join(''))
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i)

describe('日志插件装上之后', () => {
  it('只登记 logger.query，plugin 写包名、effect 是 read；插件卸载时注销', async () => {
    const { bus, fiber } = await bootLogger(makeHome())
    expect(bus.list()).toEqual([
      {
        name: 'logger.query',
        description: '查内核写的日志文件 gwb.log（含轮转出的 gwb.log.1）：可按级别、logger 名、子串筛，只取最近几条，或只取某个位置之后新写的',
        usage: loggerPlugin.QUERY_USAGE,
        plugin: '@godcreator/gwb-logger',
        effect: 'read',
      },
    ])
    await fiber.dispose()
    expect(bus.list()).toEqual([])
  })
})

describe('logger.query 不给 after：从文件末尾往前取', () => {
  it('默认取最近两千条，跨过 gwb.log.1，从旧到新；file 是 gwb.log 的绝对路径，cursor 是它的字节长度', async () => {
    const home = makeHome()
    const logFile = path.join(home, 'gwb.log')
    appendEntries(`${logFile}.1`, range(0, 2500).map((i) => entry(i)))
    appendEntries(logFile, range(2500, 4000).map((i) => entry(i)))
    const { query } = await bootLogger(home)

    const result = await query()

    expect(result.file).toBe(logFile)
    expect(result.cursor).toBe(fs.statSync(logFile).size)
    expect(result.entries).toEqual(range(2000, 4000).map((i) => entry(i)))
  })

  it('没有 gwb.log.1（还没轮转过）只读 gwb.log', async () => {
    const home = makeHome()
    appendEntries(path.join(home, 'gwb.log'), range(0, 5).map((i) => entry(i)))
    const { query } = await bootLogger(home)
    expect((await query({})).entries).toEqual(range(0, 5).map((i) => entry(i)))
  })

  it('limit 只要最近几条', async () => {
    const home = makeHome()
    appendEntries(path.join(home, 'gwb.log'), range(0, 10).map((i) => entry(i)))
    const { query } = await bootLogger(home)
    expect((await query({ limit: 3 })).entries).toEqual(range(7, 10).map((i) => entry(i)))
  })

  it('minLevel、name、text 先筛，limit 再取筛完之后最近的几条', async () => {
    const home = makeHome()
    const entries = [
      entry(0, { level: 'info', name: 'a', msg: 'a1' }),
      entry(1, { level: 'warn', name: 'a', msg: 'a2 Disk Full' }),
      entry(2, { level: 'error', name: 'b', msg: 'b1' }),
      entry(3, { level: 'error', name: 'a', msg: 'a3' }),
      entry(4, { level: 'debug', name: 'disk-watch', msg: 'd1' }),
    ]
    appendEntries(path.join(home, 'gwb.log'), entries)
    const { query } = await bootLogger(home)
    const msgsOf = (result: LogQueryResult): string[] => result.entries.map((e) => e.msg)

    expect(msgsOf(await query({ minLevel: 'warn', limit: 2 }))).toEqual(['b1', 'a3'])
    expect(msgsOf(await query({ name: 'a', minLevel: 'warn' }))).toEqual(['a2 Disk Full', 'a3'])
    expect(msgsOf(await query({ text: 'DISK' }))).toEqual(['a2 Disk Full', 'd1'])
  })
})

describe('logger.query 给 after：只取那之后新写的', () => {
  it('没轮转：只回 after 之后追加的，cursor 跟到新的末尾；没有新日志就回空、cursor 不动', async () => {
    const home = makeHome()
    const logFile = path.join(home, 'gwb.log')
    appendEntries(logFile, range(0, 5).map((i) => entry(i)))
    const { query } = await bootLogger(home)
    const first = await query()

    appendEntries(logFile, range(5, 8).map((i) => entry(i)))
    const second = await query({ after: first.cursor })
    expect(second.entries).toEqual(range(5, 8).map((i) => entry(i)))
    expect(second.cursor).toBe(fs.statSync(logFile).size)

    expect(await query({ after: second.cursor })).toEqual({ file: logFile, cursor: second.cursor, entries: [] })
  })

  it('gwb.log 比 after 小就是轮转过：先读 gwb.log.1 从 after 到末尾，再读新 gwb.log 全部', async () => {
    const home = makeHome()
    const logFile = path.join(home, 'gwb.log')
    appendEntries(logFile, range(0, 20).map((i) => entry(i)))
    const { query } = await bootLogger(home)
    const before = await query()

    appendEntries(logFile, range(20, 23).map((i) => entry(i)))
    fs.renameSync(logFile, `${logFile}.1`)
    appendEntries(logFile, range(23, 25).map((i) => entry(i)))
    expect(fs.statSync(logFile).size).toBeLessThan(before.cursor)

    const after = await query({ after: before.cursor })
    expect(after.entries).toEqual(range(20, 25).map((i) => entry(i)))
    expect(after.cursor).toBe(fs.statSync(logFile).size)
  })

  it('gwb.log 末尾有内核还没写完的半行：不返回它，cursor 停在它前面；写完之后下一次读到它', async () => {
    const home = makeHome()
    const logFile = path.join(home, 'gwb.log')
    appendEntries(logFile, range(0, 3).map((i) => entry(i)))
    const completeBytes = fs.statSync(logFile).size
    const unfinishedLine = lineOf(entry(3))
    const splitAt = 20
    fs.appendFileSync(logFile, unfinishedLine.slice(0, splitAt))
    const { query } = await bootLogger(home)

    const first = await query()
    expect(first.entries).toEqual(range(0, 3).map((i) => entry(i)))
    expect(first.cursor).toBe(completeBytes)
    expect(await query({ after: first.cursor })).toEqual({ file: logFile, cursor: completeBytes, entries: [] })

    fs.appendFileSync(logFile, unfinishedLine.slice(splitAt))
    appendEntries(logFile, [entry(4)])
    const second = await query({ after: first.cursor })
    expect(second.entries).toEqual(range(3, 5).map((i) => entry(i)))
    expect(second.cursor).toBe(fs.statSync(logFile).size)
  })

  it('gwb.log 里只有没写完的半行：回空，cursor 是 0', async () => {
    const home = makeHome()
    const logFile = path.join(home, 'gwb.log')
    fs.writeFileSync(logFile, lineOf(entry(0)).slice(0, 30))
    const { query } = await bootLogger(home)
    expect(await query()).toEqual({ file: logFile, cursor: 0, entries: [] })
  })

  it('gwb.log 比 after 小、gwb.log.1 却不在：报错写明两份文件', async () => {
    const home = makeHome()
    const logFile = path.join(home, 'gwb.log')
    appendEntries(logFile, [entry(0)])
    const { query } = await bootLogger(home)
    const failure = query({ after: 100_000 })
    await expect(failure).rejects.toThrow(`${logFile}.1 打不开`)
  })

  it('after 比 gwb.log 与 gwb.log.1 都大：不是这两份文件里的位置，报错', async () => {
    const home = makeHome()
    const logFile = path.join(home, 'gwb.log')
    appendEntries(`${logFile}.1`, [entry(0)])
    appendEntries(logFile, [entry(1)])
    const { query } = await bootLogger(home)
    await expect(query({ after: 100_000 })).rejects.toThrow(/不是这两份日志文件里的位置/)
  })

  it('筛选同样作用在新写的日志上', async () => {
    const home = makeHome()
    const logFile = path.join(home, 'gwb.log')
    appendEntries(logFile, [entry(0)])
    const { query } = await bootLogger(home)
    const first = await query()
    appendEntries(logFile, [entry(1, { level: 'info' }), entry(2, { level: 'error', msg: '新错' })])
    expect((await query({ after: first.cursor, minLevel: 'error' })).entries.map((e) => e.msg)).toEqual(['新错'])
  })
})

describe('logger.query 读到坏行、找不到文件就报错', () => {
  it('不是 JSON 的行：报错写明文件与行首几十个字符', async () => {
    const home = makeHome()
    const logFile = path.join(home, 'gwb.log')
    appendEntries(logFile, [entry(0)])
    fs.appendFileSync(logFile, `2026-09-27T00:00:00.000Z info kernel 这是旧的文本格式${'，很长'.repeat(40)}\n`)
    const { query } = await bootLogger(home)
    const failure = query()
    await expect(failure).rejects.toThrow(logFile)
    await expect(failure).rejects.toThrow('2026-09-27T00:00:00.000Z info kernel 这是旧的文本格式')
    await expect(failure).rejects.not.toThrow('很长'.repeat(40))
  })

  it.each([
    ['少了 source', { ts: 't', level: 'info', name: 'n', msg: 'm' }],
    ['多了一个键', { ts: 't', level: 'info', source: 'plugin', name: 'n', msg: 'm', seq: 1 }],
    ['顺序不对', { level: 'info', ts: 't', source: 'plugin', name: 'n', msg: 'm' }],
    ['level 不是四级之一', { ts: 't', level: 'fatal', source: 'plugin', name: 'n', msg: 'm' }],
    ['source 不是三种之一', { ts: 't', level: 'info', source: 'other', name: 'n', msg: 'm' }],
    ['msg 不是字符串', { ts: 't', level: 'info', source: 'plugin', name: 'n', msg: 1 }],
    ['ts 是数字', { ts: 1, level: 'info', source: 'plugin', name: 'n', msg: 'm' }],
  ])('五个键类型或顺序不对就报错：%s', async (_, record) => {
    const home = makeHome()
    const logFile = path.join(home, 'gwb.log')
    fs.writeFileSync(logFile, `${JSON.stringify(record)}\n`)
    const { query } = await bootLogger(home)
    await expect(query()).rejects.toThrow(logFile)
  })

  it('空行也报错', async () => {
    const home = makeHome()
    const logFile = path.join(home, 'gwb.log')
    appendEntries(logFile, [entry(0)])
    fs.appendFileSync(logFile, '\n')
    appendEntries(logFile, [entry(1)])
    const { query } = await bootLogger(home)
    await expect(query()).rejects.toThrow(`${logFile} 里有一行不是 JSON`)
  })

  it('gwb.log.1 不再有人写，它的末行没有以换行结尾就报错', async () => {
    const home = makeHome()
    const logFile = path.join(home, 'gwb.log')
    appendEntries(`${logFile}.1`, [entry(0)])
    fs.appendFileSync(`${logFile}.1`, lineOf(entry(1)).trimEnd())
    appendEntries(logFile, [entry(2)])
    const { query } = await bootLogger(home)
    await expect(query()).rejects.toThrow(`${logFile}.1 的最后一行没有以换行结尾`)
  })

  it('gwb.log 不在就报错，写明路径', async () => {
    const home = makeHome()
    const { query } = await bootLogger(home)
    await expect(query()).rejects.toThrow(path.join(home, 'gwb.log'))
  })
})

describe('logger.query 参数不对就报错', () => {
  it.each([
    [{ limit: 0 }, /limit 要是正整数/],
    [{ limit: 1.5 }, /limit 要是正整数/],
    [{ limit: '5' }, /limit 要是正整数/],
    [{ minLevel: 'warning' }, /minLevel 只能是 debug \/ info \/ warn \/ error/],
    [{ name: '' }, /name 要是非空字符串/],
    [{ text: '' }, /text 要是非空字符串/],
    [{ text: 5 }, /text 要是非空字符串/],
    [{ after: -1 }, /after 要是非负整数/],
    [{ after: 1.5 }, /after 要是非负整数/],
    [{ after: '10' }, /after 要是非负整数/],
    [{ lines: 5 }, /不认识参数 lines/],
    ['50', /参数要是对象/],
    [[1], /参数要是对象/],
  ])('%j', async (args, message) => {
    const home = makeHome()
    appendEntries(path.join(home, 'gwb.log'), [entry(0)])
    const { query } = await bootLogger(home)
    await expect(query(args)).rejects.toThrow(message)
  })
})

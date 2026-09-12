import { describe, expect, it } from 'vitest'
import { acceptEntries, clockOf, isLogEntry, mergeEntries, type LogEntry } from '../../src/client/panes/logger/entries'

const at = (seq: number, patch: Partial<LogEntry> = {}): LogEntry => ({
  seq,
  ts: 1000 + seq,
  source: 'plugin',
  level: 'info',
  name: 'gwb-cli',
  msg: `第 ${String(seq)} 条`,
  ...patch,
})

describe('判形', () => {
  it('认得出一条正经条目', () => {
    expect(isLogEntry(at(1))).toBe(true)
  })

  it('少一样就不认', () => {
    for (const key of ['seq', 'ts', 'source', 'level', 'name', 'msg']) {
      const partial: Record<string, unknown> = { ...at(1) }
      delete partial[key]
      expect(isLogEntry(partial)).toBe(false)
    }
  })

  it('source 与 level 只认那两张表里的', () => {
    expect(isLogEntry({ ...at(1), source: 'host' })).toBe(false)
    expect(isLogEntry({ ...at(1), level: 'trace' })).toBe(false)
  })

  it('不是对象一律不认', () => {
    for (const v of [null, undefined, 7, 'x', []]) expect(isLogEntry(v)).toBe(false)
  })

  it('空串名字与 0 时刻是合法的', () => {
    expect(isLogEntry(at(1, { name: '', msg: '', ts: 0 }))).toBe(true)
  })
})

describe('收一批', () => {
  it('挑出认得出的，坏的丢掉不崩', () => {
    const got = acceptEntries([at(1), { 不是: '条目' }, at(2), null])
    expect(got.map((e) => e.seq)).toEqual([1, 2])
  })

  it('不是数组就当空', () => {
    expect(acceptEntries(undefined)).toEqual([])
    expect(acceptEntries({ seq: 1 })).toEqual([])
  })
})

describe('两段归并', () => {
  it('接在后面', () => {
    expect(mergeEntries([at(1)], [at(2), at(3)], 10).map((e) => e.seq)).toEqual([1, 2, 3])
  })

  it('交叠那一截靠 seq 挡住——历史段与实时必然重一小段', () => {
    const live = [at(3), at(4)]
    const history = [at(1), at(2), at(3)]
    expect(mergeEntries(live, history, 10).map((e) => e.seq)).toEqual([1, 2, 3, 4])
  })

  it('**内容一样但 seq 不同的是两条**——拿 ts|name|msg 当键会吃掉一句', () => {
    const a = at(1, { ts: 500, msg: '同一句' })
    const b = at(2, { ts: 500, msg: '同一句' })
    expect(mergeEntries([a], [b], 10)).toHaveLength(2)
  })

  it('乱序进来按 seq 排好', () => {
    expect(mergeEntries([], [at(3), at(1), at(2)], 10).map((e) => e.seq)).toEqual([1, 2, 3])
  })

  it('超了从头切，留最新那些', () => {
    const got = mergeEntries([], [at(1), at(2), at(3), at(4)], 2)
    expect(got.map((e) => e.seq)).toEqual([3, 4])
  })

  it('没有新的就原样返回，不白造一个数组', () => {
    const prev = [at(1)]
    expect(mergeEntries(prev, [], 10)).toBe(prev)
    expect(mergeEntries(prev, [at(1)], 10)).toBe(prev)
  })
})

describe('时刻', () => {
  it('到毫秒，补零', () => {
    expect(clockOf(new Date(2026, 8, 7, 9, 5, 3, 7).getTime())).toBe('09:05:03.007')
  })
})

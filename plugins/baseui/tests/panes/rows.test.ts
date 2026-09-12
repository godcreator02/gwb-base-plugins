import { describe, expect, it } from 'vitest'
import {
  acceptPackages,
  asResult,
  stateOf,
  summarize,
  toRows,
  type EntryView,
  type PackageView,
} from '../../src/client/panes/plugin-manager/rows'

const entry = (patch: Partial<EntryView> = {}): EntryView => ({
  id: 'data',
  entryId: 'home:data',
  pkg: '@godcreator02/gwb-data',
  disabled: false,
  active: true,
  group: false,
  ...patch,
})

const pkg = (patch: Partial<PackageView> = {}): PackageView => ({
  pkg: '@godcreator02/gwb-data',
  spec: '0.0.2',
  installed: true,
  entries: [entry()],
  ...patch,
})

describe('判形', () => {
  it('一份正经的表原样收下', () => {
    const got = acceptPackages([pkg()])
    expect(got).toHaveLength(1)
    expect(got[0]!.entries[0]!.id).toBe('data')
  })

  it('不是数组、不是对象、没有 pkg 的都丢掉，不崩', () => {
    expect(acceptPackages(undefined)).toEqual([])
    expect(acceptPackages({ pkg: 'x' })).toEqual([])
    expect(acceptPackages([null, 7, { 没有: 'pkg' }])).toEqual([])
  })

  it('坏的那条条目丢掉，同一个包里好的那条留着', () => {
    const got = acceptPackages([{ ...pkg(), entries: [entry(), { id: 7 }, null] }])
    expect(got[0]!.entries.map((e) => e.id)).toEqual(['data'])
  })

  it('entryId 缺了拿裸 id 顶上——命令收的是 entryId，空着等于这条条目操作不了', () => {
    const got = acceptPackages([{ ...pkg(), entries: [{ id: 'data', entryId: '' }] }])
    expect(got[0]!.entries[0]!.entryId).toBe('data')
  })

  it('disabled / active / group 只认 true，别的一律当 false', () => {
    const got = acceptPackages([{ ...pkg(), entries: [{ id: 'x', disabled: 'yes', active: 1, group: 'true' }] }])
    expect(got[0]!.entries[0]).toMatchObject({ disabled: false, active: false, group: false })
  })

  it('spec 没有就是没有（那种包 installed 也是 false）', () => {
    const got = acceptPackages([{ pkg: 'a', installed: false, entries: [] }])
    expect(got[0]).toEqual({ pkg: 'a', installed: false, entries: [] })
  })

  it('空 label 当没有——显示名回落到 id', () => {
    const got = acceptPackages([{ ...pkg(), entries: [{ id: 'x', label: '' }] }])
    expect(got[0]!.entries[0]!.label).toBeUndefined()
  })
})

describe('条目的状态：active 与 disabled 是两回事', () => {
  it('没停用 + 跑着 = 挂上了', () => {
    expect(stateOf({ disabled: false, active: true })).toBe('active')
  })

  it('**没停用 + 没跑起来 = 没挂上**，不是「已停用」', () => {
    expect(stateOf({ disabled: false, active: false })).toBe('stalled')
  })

  it('停用了 + 没跑 = 已停用', () => {
    expect(stateOf({ disabled: true, active: false })).toBe('disabled')
  })

  it('停用了却还跑着也说得出话来——两格不合成一个状态', () => {
    expect(stateOf({ disabled: true, active: true })).toBe('disabled-running')
  })
})

describe('三种文案', () => {
  const rowFor = (patch: Partial<EntryView>) => toRows([pkg({ entries: [entry(patch)] })])[0]!.entries[0]!

  it('挂上了：不抢眼', () => {
    const row = rowFor({ active: true })
    expect(row.text).toBe('挂上了')
    expect(row.attention).toBe(false)
  })

  it('**没挂上：最该被看见**，而且文案里不许出现「停用」', () => {
    const row = rowFor({ active: false })
    expect(row.text).toBe('没挂上')
    expect(row.attention).toBe(true)
    expect(row.text).not.toContain('停用')
    // 一句话说清多半是为什么——不然人只知道它没起来
    expect(row.hint).toContain('inject')
  })

  it('已停用：是人要它停的，不抢眼', () => {
    const row = rowFor({ disabled: true, active: false })
    expect(row.text).toBe('已停用')
    expect(row.attention).toBe(false)
  })

  it('**没有条目 ≠ 未启用**：共享包本来就不该有条目，说成「未启用」是冤枉', () => {
    const row = toRows([pkg({ pkg: '@godcreator02/gwb-shared-react', entries: [] })])[0]!
    expect(row.note).toBe('没有条目')
    expect(row.note).not.toContain('启用')
    expect(row.noteHint).toContain('共享包')
  })

  it('有条目的包不带这句话', () => {
    expect(toRows([pkg()])[0]!.note).toBeUndefined()
  })
})

describe('两层行', () => {
  it('一个包挂两条条目就是两行，各自一份状态', () => {
    const row = toRows([
      pkg({ entries: [entry(), entry({ id: 'data-2', entryId: 'home:data-2', disabled: true, active: false, label: '第二份数据件' })] }),
    ])[0]!
    expect(row.entries.map((e) => [e.id, e.text, e.label])).toEqual([
      ['data', '挂上了', undefined],
      ['data-2', '已停用', '第二份数据件'],
    ])
  })

  it('启停那颗按钮看的是 disabled 不是 active——没挂上的条目照样能「停用」', () => {
    const row = toRows([pkg({ entries: [entry({ active: false })] })])[0]!
    expect(row.entries[0]!.disabled).toBe(false)
  })

  it('包不在 home 里时如实报出来，条目还在', () => {
    const row = toRows([{ pkg: '@godcreator02/gwb-x', installed: false, entries: [entry({ id: 'x' })] }])[0]!
    expect(row.installed).toBe(false)
    expect(row.entries).toHaveLength(1)
  })

  it('顺序照收，不重排——node 半已经按包名排好了', () => {
    const rows = toRows([pkg({ pkg: 'b', entries: [] }), pkg({ pkg: 'a', entries: [] })])
    expect(rows.map((r) => r.pkg)).toEqual(['b', 'a'])
  })

  it('cordis 的分组条目不是件，不显示', () => {
    const row = toRows([pkg({ entries: [entry(), entry({ id: 'g', group: true })] })])[0]!
    expect(row.entries.map((e) => e.id)).toEqual(['data'])
  })

  it('只剩分组条目、连包名都没有的那个「包」整条丢掉', () => {
    expect(toRows([{ pkg: '', installed: false, entries: [entry({ id: 'g', pkg: '', group: true })] }])).toEqual([])
  })

  it('包名是空串但条目不是分组的，留着并说清楚', () => {
    const rows = toRows([{ pkg: '', installed: false, entries: [entry({ id: 'x', pkg: '' })] }])
    expect(rows[0]!.title).toBe('（条目没写 name）')
  })
})

describe('汇总', () => {
  it('数包、数条目、数「没挂上」那几条', () => {
    const rows = toRows([
      pkg({ entries: [entry(), entry({ id: 'b', active: false })] }),
      pkg({ pkg: '@godcreator02/gwb-tokens', entries: [] }),
    ])
    expect(summarize(rows)).toEqual({ packages: 2, entries: 2, attention: 1 })
  })

  it('空表是三个零', () => {
    expect(summarize([])).toEqual({ packages: 0, entries: 0, attention: 0 })
  })
})

describe('命令回执', () => {
  it('成了就把 data 交出来', () => {
    expect(asResult({ ok: true, data: [1] })).toEqual({ ok: true, data: [1] })
  })

  it('**error 一个字都不吞**——set-label 在没装数据件时全靠这一句', () => {
    const got = asResult({ ok: false, error: '没装数据件（@godcreator02/gwb-data），显示名存不下来。' })
    expect(got.ok).toBe(false)
    expect(got.error).toContain('没装数据件')
  })

  it('没成却没给话时也得有句话——空提示跟没提示一样', () => {
    expect(asResult({ ok: false }).error).not.toBe('')
    expect(asResult({ ok: false, error: '' }).error).not.toBe('')
  })

  it('回了个认不出的东西也当没成，不崩', () => {
    expect(asResult(undefined).ok).toBe(false)
    expect(asResult('炸了').ok).toBe(false)
  })

  it('没有 ok 那格的一律当没成——缺了它这份回执本来就不算数', () => {
    expect(asResult({ data: [1] }).ok).toBe(false)
  })
})

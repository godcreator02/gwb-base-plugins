import { describe, expect, it } from 'vitest'
import {
  LAYOUT_VERSION,
  defaultDoc,
  nextDesktopId,
  nextLayoutId,
  parseLayoutDoc,
  upsertSaved,
  type DesktopRow,
  type SavedLayout,
} from '../src/layout.js'

/**
 * 布局档的纯判断：档认不认得出、v2 迁不迁得过、新条目叫什么、同名重存盖不盖。档是机器
 * 写的，但「人手改坏」「版本升了」（含多桌面时代 0.0.14 的 v1）都真会发生，认不出的那条
 * 路得钉住；v2 是昨天还在写的形状，迁移丢东西等于每次升档把人的井洗回默认，也得钉住。
 */

const grid = { grid: { root: { type: 'branch', data: [] } }, panels: {} }

function row(over: Partial<SavedLayout> = {}): SavedLayout {
  return { id: 'l1', name: '干活', layout: grid, ...over }
}

function desktop(over: Partial<DesktopRow> = {}): DesktopRow {
  return { id: 'd1', name: '桌面 1', layout: null, ...over }
}

describe('parseLayoutDoc：认得出才收，认不出整档当没有', () => {
  it('一份好档原样过（layout 对象与 null 都收，saved 可空）', () => {
    const full = {
      v: LAYOUT_VERSION,
      active: 'd1',
      desktops: [desktop({ layout: grid }), desktop({ id: 'd2', name: '摸鱼', layout: null })],
      saved: [row(), row({ id: 'l2', name: '摸鱼' })],
    }
    expect(parseLayoutDoc(full)).toEqual(full)
    expect(parseLayoutDoc(defaultDoc())).toEqual(defaultDoc())
  })

  it('版本不认识 → null（多桌面时代的 v1、将来升版本都走这条）', () => {
    expect(parseLayoutDoc({ v: 1, active: 'd1', desktops: [{ id: 'd1', name: '桌面 1', layout: null }] })).toBeNull()
    expect(parseLayoutDoc({ v: 4, active: 'd1', desktops: [] })).toBeNull()
    expect(parseLayoutDoc({ active: 'd1', desktops: [], saved: [] })).toBeNull()
  })

  it('v2 当场迁成 v3：current 变第一口「主桌面」，saved 原样带走；current null 也收', () => {
    expect(parseLayoutDoc({ v: 2, current: grid, saved: [row()] })).toEqual({
      v: LAYOUT_VERSION,
      active: 'd1',
      desktops: [{ id: 'd1', name: '主桌面', layout: grid }],
      saved: [row()],
    })
    expect(parseLayoutDoc({ v: 2, current: null, saved: [] })).toEqual({
      v: LAYOUT_VERSION,
      active: 'd1',
      desktops: [{ id: 'd1', name: '主桌面', layout: null }],
      saved: [],
    })
  })

  it('v2 的坏档照旧整档当没有（current 坏、saved 坏）', () => {
    expect(parseLayoutDoc({ v: 2, current: 'oops', saved: [] })).toBeNull()
    expect(parseLayoutDoc({ v: 2, current: [], saved: [] })).toBeNull()
    expect(parseLayoutDoc({ v: 2, current: null, saved: [{ ...row(), id: '' }] })).toBeNull()
    expect(parseLayoutDoc({ v: 2, current: null, saved: [row(), row()] })).toBeNull()
    expect(parseLayoutDoc({ v: 2, current: null, saved: 'nope' })).toBeNull()
  })

  it('desktops 坏（空表、空 id/空名、layout 坏、id 撞车）→ 整档当没有；**同名是合法的**（id 才是身份）', () => {
    expect(parseLayoutDoc({ v: LAYOUT_VERSION, active: 'd1', desktops: [], saved: [] })).toBeNull()
    expect(parseLayoutDoc({ v: LAYOUT_VERSION, active: 'd1', desktops: [{ ...desktop(), id: '' }], saved: [] })).toBeNull()
    expect(parseLayoutDoc({ v: LAYOUT_VERSION, active: 'd1', desktops: [{ ...desktop(), name: '' }], saved: [] })).toBeNull()
    expect(parseLayoutDoc({ v: LAYOUT_VERSION, active: 'd1', desktops: [{ ...desktop(), layout: 'oops' }], saved: [] })).toBeNull()
    expect(parseLayoutDoc({ v: LAYOUT_VERSION, active: 'd1', desktops: [desktop(), desktop()], saved: [] })).toBeNull()
    // 两口同名、不同 id：收。名字是人看的标签，id 才是档内部认人的键
    const sameName = { v: LAYOUT_VERSION, active: 'd1', desktops: [desktop(), desktop({ id: 'd2' })], saved: [] }
    expect(parseLayoutDoc(sameName)).toEqual(sameName)
  })

  it('active 指着一口不存在的桌面 → null（猜一口的话「重启回到哪」就取决于谁写的档）', () => {
    expect(parseLayoutDoc({ v: LAYOUT_VERSION, active: 'd9', desktops: [desktop()], saved: [] })).toBeNull()
    expect(parseLayoutDoc({ v: LAYOUT_VERSION, active: '', desktops: [desktop()], saved: [] })).toBeNull()
  })

  it('saved 不是数组 / 里面坏 → null（v3 与 v2 同一条规矩）', () => {
    expect(parseLayoutDoc({ v: LAYOUT_VERSION, active: 'd1', desktops: [desktop()] })).toBeNull()
    expect(parseLayoutDoc({ v: LAYOUT_VERSION, active: 'd1', desktops: [desktop()], saved: 'nope' })).toBeNull()
    expect(
      parseLayoutDoc({ v: LAYOUT_VERSION, active: 'd1', desktops: [desktop()], saved: [{ ...row(), layout: null }] }),
    ).toBeNull()
  })
})

describe('defaultDoc：头一回的那份', () => {
  it('一口「桌面 1」，layout 是 null（null 才轮得到默认铺格），saved 是空表', () => {
    expect(defaultDoc()).toEqual({
      v: LAYOUT_VERSION,
      active: 'd1',
      desktops: [{ id: 'd1', name: '桌面 1', layout: null }],
      saved: [],
    })
  })
})

describe('nextDesktopId / nextLayoutId', () => {
  it('id 取最小没占用的：删了 d2 再建，复用 d2', () => {
    expect(nextDesktopId([])).toBe('d1')
    expect(nextDesktopId([desktop()])).toBe('d2')
    expect(nextDesktopId([desktop(), desktop({ id: 'd3', name: '摸鱼' })])).toBe('d2')
    expect(nextLayoutId([row()])).toBe('l2')
  })
})

describe('upsertSaved', () => {
  it('同名覆盖：重存「干活」还是一条，layout 换成新的', () => {
    const first = upsertSaved([], '干活', grid)
    expect(first).toHaveLength(1)
    const secondGrid = { ...grid, panels: { a: 1 } }
    const second = upsertSaved(first, '干活', secondGrid)
    expect(second).toHaveLength(1)
    expect(second[0]?.name).toBe('干活')
    expect(second[0]?.layout).toBe(secondGrid)
    // 别名的原样保留
    const both = upsertSaved(first, '摸鱼', grid)
    expect(both).toHaveLength(2)
  })

  it('覆盖后 id 不漂：原条目的 id 保住（id 是档内部认人的键，换了就成另一条）', () => {
    const first = upsertSaved([], '干活', grid)
    const second = upsertSaved(first, '干活', { ...grid, panels: { b: 2 } })
    expect(second[0]?.id).toBe(first[0]?.id)
  })
})

import { describe, expect, it } from 'vitest'
import {
  LAYOUT_VERSION,
  defaultDoc,
  nextLayoutId,
  parseLayoutDoc,
  upsertSaved,
  type SavedLayout,
} from '../src/layout.js'

/**
 * 布局档的纯判断：档认不认得出、新条目叫什么、同名重存盖不盖。档是机器写的，
 * 但「人手改坏」「版本升了」（含多桌面时代的 v1）都真会发生，认不出的那条路得钉住。
 */

const grid = { grid: { root: { type: 'branch', data: [] } }, panels: {} }

function row(over: Partial<SavedLayout> = {}): SavedLayout {
  return { id: 'l1', name: '干活', layout: grid, ...over }
}

describe('parseLayoutDoc：认得出才收，认不出整档当没有', () => {
  it('一份好档原样过（current 对象与 null 都收，saved 可空）', () => {
    const full = { v: LAYOUT_VERSION, current: grid, saved: [row(), row({ id: 'l2', name: '摸鱼' })] }
    expect(parseLayoutDoc(full)).toEqual(full)
    expect(parseLayoutDoc({ v: LAYOUT_VERSION, current: null, saved: [] })).toEqual(defaultDoc())
  })

  it('版本不认识 → null（第一次开机 v 缺失、多桌面时代的 v1、将来升版本都走这条）', () => {
    expect(parseLayoutDoc({ v: 1, active: 'd1', desktops: [{ id: 'd1', name: '桌面 1', layout: null }] })).toBeNull()
    expect(parseLayoutDoc({ v: 3, current: null, saved: [] })).toBeNull()
    expect(parseLayoutDoc({ current: null, saved: [] })).toBeNull()
  })

  it('current 坏（字符串 / 数组）→ null', () => {
    expect(parseLayoutDoc({ v: 2, current: 'oops', saved: [] })).toBeNull()
    expect(parseLayoutDoc({ v: 2, current: [], saved: [] })).toBeNull()
  })

  it('saved 里一条坏（空 id、空名、layout 为 null、id 撞车）→ 整档当没有', () => {
    expect(parseLayoutDoc({ v: 2, current: null, saved: [{ ...row(), id: '' }] })).toBeNull()
    expect(parseLayoutDoc({ v: 2, current: null, saved: [{ ...row(), name: '' }] })).toBeNull()
    expect(parseLayoutDoc({ v: 2, current: null, saved: [{ ...row(), layout: null }] })).toBeNull()
    expect(parseLayoutDoc({ v: 2, current: null, saved: [row(), row()] })).toBeNull()
  })

  it('saved 不是数组 → null', () => {
    expect(parseLayoutDoc({ v: 2, current: null })).toBeNull()
    expect(parseLayoutDoc({ v: 2, current: null, saved: 'nope' })).toBeNull()
  })
})

describe('defaultDoc：头一回的那份', () => {
  it('current 是 null（null 才轮得到默认铺格），saved 是空表', () => {
    expect(defaultDoc()).toEqual({ v: LAYOUT_VERSION, current: null, saved: [] })
  })
})

describe('nextLayoutId / upsertSaved', () => {
  it('id 取最小没占用的：删了 l2 再存，复用 l2', () => {
    expect(nextLayoutId([])).toBe('l1')
    expect(nextLayoutId([row()])).toBe('l2')
    expect(nextLayoutId([row(), row({ id: 'l3', name: '摸鱼' })])).toBe('l2')
  })

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

  it('中间号删过也保住：覆盖不漂去复用空号', () => {
    const base = upsertSaved(upsertSaved([], '摸鱼', grid), '干活', grid)
    const rest = base.filter((s) => s.name !== '摸鱼')
    const updated = upsertSaved(rest, '干活', grid)
    // 干活原本是 l2，删了 l1 之后覆盖——还是 l2，不是复用的 l1
    expect(updated[0]?.id).toBe(base[1]?.id)
  })
})

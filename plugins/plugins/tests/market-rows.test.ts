import { describe, expect, it } from 'vitest'
import { acceptPackages, installedIndex, matchesQuery, NO_INDEX, summarize, toRows, type SearchRow } from '../src/client/market-rows'

/**
 * 「可装」那段的纯逻辑。原先筛一份手工白名单，2026-09-08 起筛的是 **registry 检索结果**
 * ——`plugins.search` 一把抓回全量，搜索框纯本地筛。acceptPackages 的判形也在这一组里。
 */

const row = (pkg: string, patch: Partial<SearchRow> = {}): SearchRow => ({
  pkg,
  version: '0.0.1',
  description: `${pkg} 的一句话`,
  ...patch,
})

/** `plugins.list` 已取的包行 → 索引。只收 installed === true 的 */
const index = (...pkgs: { pkg: string; installed: boolean; spec?: string }[]) => installedIndex(pkgs)
const installed = (pkg: string, spec?: string) => ({ pkg, installed: true, spec })

describe('acceptPackages：plugins.search 的 data 收窄', () => {
  it('一份正经的表原样收下', () => {
    expect(acceptPackages([{ pkg: 'a', version: '0.0.2', description: '甲' }])).toEqual([
      { pkg: 'a', version: '0.0.2', description: '甲' },
    ])
  })

  it('不是数组、不是对象、没有 pkg 的都丢掉，不崩', () => {
    expect(acceptPackages(undefined)).toEqual([])
    expect(acceptPackages({ pkg: 'x' })).toEqual([])
    expect(acceptPackages([null, 7, { pkg: '' }, { pkg: 'a' }])).toEqual([{ pkg: 'a' }])
  })

  it('version / description 不是非空字符串就当没有', () => {
    expect(acceptPackages([{ pkg: 'a', version: '', description: 7 }])).toEqual([{ pkg: 'a' }])
  })
})

describe('已装索引：从窗格已取的那份表推导', () => {
  it('installed 是 true 的收下（spec 有则带），不是 true 的一概当没装', () => {
    const got = installedIndex([
      { pkg: 'a', installed: true, spec: '^0.0.2' },
      { pkg: 'b', installed: false, spec: '^0.0.1' },
    ])
    expect(got.get('a')).toBe('^0.0.2')
    expect(got.has('b')).toBe(false)
  })

  it('装了但没版本范围的，用 undefined 占位——**在表里**跟不在表里是两回事', () => {
    const got = installedIndex([{ pkg: 'a', installed: true }])
    expect(got.has('a')).toBe(true)
    expect(got.get('a')).toBeUndefined()
  })
})

describe('搜索框：检索结果的本地筛，包名与那句话一起筛', () => {
  it('空串（和只有空白的）不筛，全过', () => {
    expect(matchesQuery(row('a'), '')).toBe(true)
    expect(matchesQuery(row('a'), '   ')).toBe(true)
  })

  it('包名、描述两处都能命中，不区分大小写', () => {
    expect(matchesQuery(row('@godcreator02/gwb-logger'), 'logger')).toBe(true)
    expect(matchesQuery(row('a', { description: '脱离终端查日志' }), '日志')).toBe(true)
    expect(matchesQuery(row('a'), '  A  ')).toBe(true)
  })

  it('没描述的行只拿包名筛，匹配不上就是匹配不上', () => {
    expect(matchesQuery({ pkg: 'a' }, 'b')).toBe(false)
  })
})

describe('对账：检索结果 + 已装的那份 → 要画的行', () => {
  const catalog = [row('a'), row('b')]

  it('装了的带 installed 与版本范围，没装的不带', () => {
    const rows = toRows(catalog, index(installed('a', '^0.0.3')), '')
    expect(rows[0]).toMatchObject({ pkg: 'a', installed: true, spec: '^0.0.3' })
    expect(rows[1]!.installed).toBe(false)
    expect(rows[1]!.spec).toBeUndefined()
  })

  it('装了但没版本号：照样是「已装」', () => {
    expect(toRows(catalog, index(installed('a')), '')[0]).toEqual({ ...catalog[0], installed: true })
  })

  it('**顺序照检索结果**，装没装不参与排序——列表跳来跳去人会找不到刚才那一行', () => {
    expect(toRows(catalog, index(installed('b')), '').map((r) => r.pkg)).toEqual(['a', 'b'])
  })

  it('home 里多出来的包不摆进这段——它只认检索结果', () => {
    const rows = toRows(catalog, index(installed('@godcreator02/gwb-api')), '')
    expect(rows.map((r) => r.pkg)).toEqual(['a', 'b'])
  })

  it('筛了之后只剩匹配的那几行', () => {
    expect(toRows(catalog, NO_INDEX, 'b').map((r) => r.pkg)).toEqual(['b'])
  })
})

describe('汇总', () => {
  const catalog = [row('a'), row('b'), row('c')]

  it('**已装的数量数的是筛选之前的全量**，筛出来几行单独一格', () => {
    const idx = index(installed('a'), installed('c'))
    expect(summarize(catalog, idx, toRows(catalog, idx, 'b'))).toEqual({ total: 3, installed: 2, shown: 1 })
  })

  it('一个都没装时是 0，不是空', () => {
    expect(summarize(catalog, NO_INDEX, toRows(catalog, NO_INDEX, ''))).toEqual({ total: 3, installed: 0, shown: 3 })
  })
})

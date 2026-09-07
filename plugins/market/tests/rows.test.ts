import { describe, expect, it } from 'vitest'
import type { CatalogItem } from '../src/catalog'
import {
  acceptInstalled,
  asResult,
  checkManual,
  installedIndex,
  isMissingPlugins,
  matchesQuery,
  NO_INDEX,
  summarize,
  toRows,
} from '../src/client/rows'

const item = (patch: Partial<CatalogItem> = {}): CatalogItem => ({
  pkg: '@godcreator02/gwb-logger',
  title: '日志',
  why: '脱离终端跑的时候，出了事还有地方查',
  ...patch,
})

const index = (...pkgs: { pkg: string; spec?: string }[]) => installedIndex(pkgs)

describe('已装的那份：plugins.list 的 data 收窄', () => {
  it('一份正经的表原样收下', () => {
    const got = acceptInstalled([{ pkg: 'a', spec: '0.0.2', installed: true, entries: [] }])
    expect(got).toEqual([{ pkg: 'a', spec: '0.0.2' }])
  })

  it('**installed 不是 true 的一概当没装**——「yml 里有条目、可包不在 home 里」在市场这一格就是该装', () => {
    const got = acceptInstalled([
      { pkg: 'a', installed: false, entries: [{ id: 'a' }] },
      { pkg: 'b', installed: 'yes' },
    ])
    expect(got).toEqual([])
  })

  it('不是数组、不是对象、没有 pkg 的都丢掉，不崩', () => {
    expect(acceptInstalled(undefined)).toEqual([])
    expect(acceptInstalled({ pkg: 'x', installed: true })).toEqual([])
    expect(acceptInstalled([null, 7, { installed: true }, { pkg: '', installed: true }])).toEqual([])
  })

  it('spec 不是字符串或者是空串就当没有——装了但没版本号，跟没装分得开', () => {
    const got = acceptInstalled([{ pkg: 'a', spec: '', installed: true }, { pkg: 'b', spec: 7, installed: true }])
    expect(got).toEqual([{ pkg: 'a' }, { pkg: 'b' }])
    expect(installedIndex(got).has('a')).toBe(true)
  })

  it('条目一概不看：挂了几条、挂上没有归插件那一格', () => {
    const got = acceptInstalled([{ pkg: 'a', installed: true, entries: [{ id: 'a', active: false }] }])
    expect(got).toEqual([{ pkg: 'a' }])
  })
})

describe('缺件那一档认得出来', () => {
  it('命令总线在、可没人注册过这条', () => {
    expect(isMissingPlugins('没有这条命令：plugins.list')).toBe(true)
  })

  it('连命令总线都没装（内核 dispatch 直接回的那句）', () => {
    expect(isMissingPlugins('没有命令服务（ctx.gwbCommands），认不出 plugins.list')).toBe(true)
  })

  it('**别的错不许被当成缺件**——pnpm 炸了跟件没装是两回事，混了就把真事故说成「没装」', () => {
    expect(isMissingPlugins('ENOENT: 找不到 pnpm')).toBe(false)
    expect(isMissingPlugins('')).toBe(false)
  })
})

describe('搜索：只筛本地这份清单，三个字段一起筛', () => {
  it('空串（和只有空白的）不筛，全过', () => {
    expect(matchesQuery(item(), '')).toBe(true)
    expect(matchesQuery(item(), '   ')).toBe(true)
  })

  it('短名、包名、why 三处都能命中', () => {
    expect(matchesQuery(item(), '日志')).toBe(true)
    expect(matchesQuery(item(), 'gwb-log')).toBe(true)
    expect(matchesQuery(item(), '终端')).toBe(true)
  })

  it('不区分大小写，两头空白不算数', () => {
    expect(matchesQuery(item(), '  GWB-LOGGER ')).toBe(true)
  })

  it('匹配不上就是匹配不上', () => {
    expect(matchesQuery(item(), '数据库')).toBe(false)
  })
})

describe('对账：清单 + 已装的那份 → 要画的行', () => {
  const catalog = [item({ pkg: 'a', title: '甲' }), item({ pkg: 'b', title: '乙' })]

  it('装了的带 installed 与版本范围，没装的不带', () => {
    const rows = toRows(catalog, index({ pkg: 'a', spec: '0.0.3' }), '')
    expect(rows[0]).toMatchObject({ pkg: 'a', installed: true, spec: '0.0.3' })
    expect(rows[1]!.installed).toBe(false)
    expect(rows[1]!.spec).toBeUndefined()
  })

  it('装了但没版本号：照样是「已装」', () => {
    expect(toRows(catalog, index({ pkg: 'a' }), '')[0]).toEqual({ ...catalog[0], installed: true })
  })

  it('**顺序照清单**，装没装不参与排序——列表跳来跳去人会找不到刚才那一行', () => {
    expect(toRows(catalog, index({ pkg: 'b' }), '').map((r) => r.pkg)).toEqual(['a', 'b'])
  })

  it('home 里多出来的包不摆进市场——清单是白名单，那才是它的第一职责', () => {
    const rows = toRows(catalog, index({ pkg: '@godcreator02/gwb-api' }), '')
    expect(rows.map((r) => r.pkg)).toEqual(['a', 'b'])
  })

  it('筛了之后只剩匹配的那几行', () => {
    expect(toRows(catalog, NO_INDEX, '乙').map((r) => r.pkg)).toEqual(['b'])
  })
})

describe('汇总', () => {
  const catalog = [item({ pkg: 'a' }), item({ pkg: 'b', title: '乙' }), item({ pkg: 'c' })]

  it('**已装的数量数的是筛选之前的全量**，筛出来几行单独一格', () => {
    const idx = index({ pkg: 'a' }, { pkg: 'c' })
    expect(summarize(catalog, idx, toRows(catalog, idx, '乙'))).toEqual({ total: 3, installed: 2, shown: 1 })
  })

  it('一个都没装时是 0，不是空', () => {
    expect(summarize(catalog, NO_INDEX, toRows(catalog, NO_INDEX, ''))).toEqual({ total: 3, installed: 0, shown: 3 })
  })
})

describe('直接输包名装：四道判，每道给一句能照着改的话', () => {
  it('合法的放行，两头空白剪掉', () => {
    expect(checkManual('  @scope/name ', NO_INDEX)).toEqual({ ok: true, pkg: '@scope/name' })
    expect(checkManual('lodash', NO_INDEX)).toEqual({ ok: true, pkg: 'lodash' })
  })

  it('空的说一句「先填一个」', () => {
    const got = checkManual('   ', NO_INDEX)
    expect(got.ok).toBe(false)
    expect(got.ok ? '' : got.error).toContain('先填')
  })

  it('**带版本号单独说一句**——市场不钉版本，那是清单里刻意没有 spec 的同一条判据', () => {
    const got = checkManual('@godcreator02/gwb-hello@0.0.2', NO_INDEX)
    expect(got.ok).toBe(false)
    expect(got.ok ? '' : got.error).toContain('不钉版本')
  })

  it('scope 那个 @ 不算版本号', () => {
    expect(checkManual('@godcreator02/gwb-hello', NO_INDEX).ok).toBe(true)
  })

  it('不合规的包名当场拦——大写、开头的 -（那正好长得像个开关）', () => {
    expect(checkManual('Lodash', NO_INDEX).ok).toBe(false)
    expect(checkManual('-r', NO_INDEX).ok).toBe(false)
    expect(checkManual('a b', NO_INDEX).ok).toBe(false)
  })

  it('**已经装了的不再装一份**，还得说清真要第二条条目该走哪儿', () => {
    const got = checkManual('a', index({ pkg: 'a' }))
    expect(got.ok).toBe(false)
    expect(got.ok ? '' : got.error).toContain('plugins.add-entry')
  })
})

describe('命令回执', () => {
  it('成了就把 data 交出来', () => {
    expect(asResult({ ok: true, data: [1] })).toEqual({ ok: true, data: [1] })
  })

  it('**error 一个字都不吞**——pnpm 输出的尾巴就在这一句里', () => {
    const got = asResult({ ok: false, error: 'pnpm add x 没成（退出码 1）\nERR_PNPM_FETCH_404' })
    expect(got.error).toContain('ERR_PNPM_FETCH_404')
  })

  it('没成却没给话时也得有句话——空提示跟没提示一样', () => {
    expect(asResult({ ok: false }).error).not.toBe('')
    expect(asResult({ ok: false, error: '' }).error).not.toBe('')
  })

  it('回了个认不出的东西也当没成，不崩', () => {
    expect(asResult(undefined).ok).toBe(false)
    expect(asResult('炸了').ok).toBe(false)
  })

  it('没有 ok 那格的一律当没成', () => {
    expect(asResult({ data: [1] }).ok).toBe(false)
  })
})

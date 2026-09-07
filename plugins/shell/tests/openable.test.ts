import { describe, expect, it } from 'vitest'
import {
  NAV_COMPONENT,
  NAV_ID,
  listOpenable,
  panelIdOf,
  planOpen,
  specForOwnPane,
  specForPane,
  titleForOrdinal,
  uniquePanelId,
} from '../src/openable.js'
import { PLUGIN_COMPONENT } from '../src/panels.js'
import type { RegisteredPane } from '../src/pane-registry.js'

/**
 * 注册表快照 → 井里能开的那几格。默认布局、状态栏的＋列表、导航行项吃的是同一份，
 * 所以这份判据是纯的、在 node 里直接跑。
 */

const echo: RegisteredPane = {
  entryId: 'echo',
  pkg: '@godcreator02/gwb-echo',
  id: 'main',
  title: '回声',
  icon: 'megaphone',
}

/** 同一个包挂的第二条条目 */
const echo2: RegisteredPane = { ...echo, entryId: 'echo-2', title: '回声（二号）' }

/** 同一条条目的第二格 */
const echoLog: RegisteredPane = { ...echo, id: 'log', title: '日志', icon: 'scroll-text' }

function panes(list: readonly RegisteredPane[]) {
  return listOpenable(list).filter((s) => s.id !== NAV_ID)
}

describe('listOpenable：表里一条摊成井里一格', () => {
  it('导航永远排第一，它自己也是可开可关的一格', () => {
    expect(listOpenable([echo])[0]).toMatchObject({ id: NAV_ID, component: NAV_COMPONENT, title: '导航' })
  })

  it('一条注册出一条：id 两段，params 三样都带着', () => {
    expect(panes([echo])).toEqual([
      {
        id: 'plugin:echo:main',
        component: PLUGIN_COMPONENT,
        title: '回声',
        icon: 'megaphone',
        params: { pluginKey: '@godcreator02/gwb-echo', entryId: 'echo', paneId: 'main' },
      },
    ])
  })

  it('没给 icon 的不带这个键——不塞一个空串进去', () => {
    const bare: RegisteredPane = { entryId: 'x', pkg: '@x/x', id: 'main', title: 'X' }
    expect(panes([bare])[0]).not.toHaveProperty('icon')
  })

  it('同一个包的两条条目：两格分得开，pluginKey 是同一个', () => {
    const specs = panes([echo, echo2])
    expect(specs.map((s) => s.id)).toEqual(['plugin:echo:main', 'plugin:echo-2:main'])
    expect(new Set(specs.map((s) => s.params?.pluginKey)).size).toBe(1)
  })

  it('同一条条目的两格：靠 paneId 分派', () => {
    const specs = panes([echo, echoLog])
    expect(specs.map((s) => [s.id, s.title])).toEqual([
      ['plugin:echo:main', '回声'],
      ['plugin:echo:log', '日志'],
    ])
    expect(specs.map((s) => s.params?.paneId)).toEqual(['main', 'log'])
  })

  it('空表只剩导航——「一个件都没注册」跟「表没到手」是两回事,这儿只管前者', () => {
    expect(listOpenable([]).map((s) => s.id)).toEqual([NAV_ID])
  })

  it('不过滤：禁用的件根本没跑 apply、注册不进来,在表里就等于该开得出来', () => {
    // 母仓那份要 `!disabled && !shell` 两条判断,是因为它吃的是条目表；
    // 运行时注册下那两条连同它们会出的错一起消失了
    expect(panes([echo])).toHaveLength(1)
  })
})

describe('specForOwnPane：件说「打开我的某一格」', () => {
  it('认得出自己那格', () => {
    expect(specForOwnPane([echo, echoLog], 'echo', 'log')?.id).toBe('plugin:echo:log')
  })

  it('写错一个字回 undefined——不在井里凭空多出一格空白', () => {
    expect(specForOwnPane([echo], 'echo', 'nope')).toBeUndefined()
    expect(specForOwnPane([], 'echo', 'main')).toBeUndefined()
  })

  it('打不开别人条目的格:窗格 id 对上了但条目不是自己的,一样回 undefined', () => {
    expect(specForOwnPane([echo2], 'echo', 'main')).toBeUndefined()
  })
})

describe('panelIdOf：两段都进去,只有这一处这么拼', () => {
  it('落盘的 id 跟表里的算法是同一处', () => {
    expect(panelIdOf('echo', 'main')).toBe('plugin:echo:main')
    expect(listOpenable([echo])[1]!.id).toBe(panelIdOf(echo.entryId, echo.id))
  })

  it('实机的 entryId 自带 home: 前缀,拼出来是四段——这是条目 id 的真实形状', () => {
    // loader 把件的条目挂在 include 那条下面,id 是全路径。上面那些用例的 `echo`
    // 是简写,这一条钉住真的长什么样
    const real: RegisteredPane = { entryId: 'home:hello', pkg: '@godcreator02/gwb-hello', id: 'main', title: '验收件' }
    expect(panelIdOf(real.entryId, real.id)).toBe('plugin:home:hello:main')
    expect(panes([real])[0]).toMatchObject({
      id: 'plugin:home:hello:main',
      params: { entryId: 'home:hello', paneId: 'main' },
    })
  })
})

/** 井里已经有这几个 id */
function taken(...ids: string[]): (id: string) => boolean {
  const set = new Set(ids)
  return (id: string) => set.has(id)
}

describe('uniquePanelId：定义 → 这一份实例', () => {
  it('井里没有就是基名本身——第一份跟只能开一份的那些格长得一模一样', () => {
    expect(uniquePanelId('plugin:home:hello:counter', taken())).toEqual({
      id: 'plugin:home:hello:counter',
      ordinal: 1,
    })
  })

  it('基名占着就追 :2，再占着追 :3', () => {
    const base = 'plugin:home:hello:counter'
    expect(uniquePanelId(base, taken(base))).toEqual({ id: `${base}:2`, ordinal: 2 })
    expect(uniquePanelId(base, taken(base, `${base}:2`))).toEqual({ id: `${base}:3`, ordinal: 3 })
  })

  it('基名空出来但 :2 还占着 → 回基名', () => {
    // **这条最要紧**:查的是「当下井里真有哪些」,不是任何一个计数器。第四刀恢复落盘
    // 布局之后再开新格不撞,靠的就是这条语义
    const base = 'plugin:home:hello:counter'
    expect(uniquePanelId(base, taken(`${base}:2`))).toEqual({ id: base, ordinal: 1 })
  })

  it('查重恒真时抛,不是无限循环——那个循环跑在 UI 线程上', () => {
    expect(() => uniquePanelId('x', () => true)).toThrow(/查重坏了/)
  })
})

describe('titleForOrdinal：第二份起标题带序号', () => {
  it('第一份原样，第二份起追 (n)', () => {
    expect(titleForOrdinal('计数器', 1)).toBe('计数器')
    expect(titleForOrdinal('计数器', 2)).toBe('计数器 (2)')
    expect(titleForOrdinal('计数器', 3)).toBe('计数器 (3)')
  })
})

describe('planOpen：件说打开某一格之后该干什么', () => {
  const single = specForPane(echo)
  const multi = specForPane({ ...echoLog, id: 'counter', title: '计数器', duplicable: true })
  const who = { entryId: 'echo', paneId: 'main' }

  it('还没开过 → 开一份，id 就是基名', () => {
    const plan = planOpen(single, undefined, taken(), who)
    expect(plan).toMatchObject({ kind: 'open', id: single.id, title: '回声' })
  })

  it('已经开着 + 没要多份 → 聚焦，不再开', () => {
    expect(planOpen(single, undefined, taken(single.id), who)).toEqual({ kind: 'focus', id: single.id })
  })

  it('已经开着 + 要多份 + 声明过 duplicable → 开新的一份，标题带 (2)', () => {
    const plan = planOpen(multi, { duplicate: true }, taken(multi.id), { entryId: 'echo', paneId: 'counter' })
    expect(plan).toMatchObject({ kind: 'open', id: `${multi.id}:2`, title: '计数器 (2)' })
  })

  it('要多份但那格没声明 duplicable → 退回聚焦,而且要出声', () => {
    // **这条实机点不出来**——得专门写一个错的件才走得到,所以它只能在这儿钉住
    const plan = planOpen(single, { duplicate: true }, taken(single.id), who)
    expect(plan.kind).toBe('focus')
    expect(plan.kind === 'focus' ? plan.notice : undefined).toMatch(/duplicable/)
  })

  it('要多份、没声明、而且还没开过 → 照常开第一份,警告照出', () => {
    const plan = planOpen(single, { duplicate: true }, taken(), who)
    expect(plan).toMatchObject({ kind: 'open', id: single.id })
  })

  it('认不出那一格 → 什么都不做,但话里要带得出是谁要开什么', () => {
    const plan = planOpen(undefined, undefined, taken(), who)
    expect(plan.kind).toBe('none')
    expect(plan.kind === 'none' ? plan.notice : '').toContain('echo')
    expect(plan.kind === 'none' ? plan.notice : '').toContain('main')
  })
})

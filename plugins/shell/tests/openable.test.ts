import { describe, expect, it } from 'vitest'
import { NAV_COMPONENT, NAV_ID, listOpenable, panelIdOf, specForOwnPane } from '../src/openable.js'
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

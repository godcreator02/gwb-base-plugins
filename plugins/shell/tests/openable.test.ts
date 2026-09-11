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
  type OpenPane,
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

/** 下面几组用的那一格：`specForPane({ ...echo, id: 'counter' })` 的基名 */
const BASE = 'plugin:echo:counter'

/** 这一格开着的几份：正式格一份，`key` 就是它装的东西 */
function kept(...keys: string[]): OpenPane[] {
  return keys.map((key, i) => ({ id: i === 0 ? BASE : `${BASE}:${String(i + 1)}`, key, preview: false }))
}

/** 同上，但最后追一份**预览格** */
function withPreview(open: readonly OpenPane[], key: string): OpenPane[] {
  return [...open, { id: open.length === 0 ? BASE : `${BASE}:${String(open.length + 1)}`, key, preview: true }]
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

/**
 * **一格的身份是它装的内容**。件开格时给一个不透明的 `key`，外壳拿它去这一格已开的
 * 几份里找：找得到就聚焦那一份，找不到才开新的一份（要了 `preview` 就优先放进预览格）。
 *
 * 这几条分支里有一条实机点不出来（件传的参数踩了保留键），所以判断整个是纯函数。
 */
describe('planOpen：件说打开某一格之后该干什么', () => {
  const counter = specForPane({ ...echo, id: 'counter', title: '计数器' })
  const who = { entryId: 'echo', paneId: 'counter' }

  it('一份都没开 → 开一份，id 就是基名', () => {
    const plan = planOpen(counter, { key: 'a' }, [], who)
    expect(plan).toMatchObject({ kind: 'open', id: BASE, title: '计数器' })
  })

  it('装着这份内容的那一格已经开着 → 聚焦它，不新开也不换内容', () => {
    expect(planOpen(counter, { key: 'a' }, kept('a'), who)).toEqual({ kind: 'focus', id: BASE })
  })

  it('身份不同 → 开新的一份，标题带 (2)。**「开几份」由内容决定，不由谁给的权限决定**', () => {
    const plan = planOpen(counter, { key: 'b' }, kept('a'), who)
    expect(plan).toMatchObject({ kind: 'open', id: `${BASE}:2`, title: '计数器 (2)' })
  })

  it('不给 key 等于空串：**「没给 key」不是特例**，第二次点同一格照样是聚焦', () => {
    expect(planOpen(counter, undefined, [], who)).toMatchObject({ kind: 'open', id: BASE })
    expect(planOpen(counter, undefined, kept(''), who)).toEqual({ kind: 'focus', id: BASE })
    // 默认布局铺出来的那一份身上也没有 key，所以它跟「件不给 key 开的那一份」是同一格
    expect(planOpen(counter, { params: { file: 'a.md' } }, kept(''), who)).toEqual({ kind: 'focus', id: BASE })
  })

  it('件拿 key 开了几份、空身份那一份没开着 → 不给 key 的调用是 open 不是 focus', () => {
    // 状态栏那张表点一条走的就是这条（它不给 key），所以**「已开」那个记号必须问这同一句**
    // ——拿「这一格有没有开着」当判据的话，这儿明明开着两份、记号会说「已开」，而点下去
    // 多开一格空白的。记号跟效果岔开那一下，人看着就是坏的（接线侧的 willFocus 钉住这条）
    expect(planOpen(counter, undefined, kept('a', 'b'), who)).toMatchObject({ kind: 'open', id: `${BASE}:3` })
  })

  it('认不出那一格 → 什么都不做,但话里要带得出是谁要开什么', () => {
    const plan = planOpen(undefined, undefined, [], who)
    expect(plan.kind).toBe('none')
    expect(plan.kind === 'none' ? plan.notice : '').toContain('echo')
    expect(plan.kind === 'none' ? plan.notice : '').toContain('counter')
  })
})

/**
 * **新那份摆哪儿**：按这一格此刻开着几份分三档。第三份起往下叠而不是继续往右——件多半
 * 是从基名那一份（正文）点出来的，活动的一直是它，不改就是一格一列。
 */
describe('planOpen 的落位：第三份起往下叠，不再往右开', () => {
  const counter = specForPane({ ...echo, id: 'counter', title: '计数器' })
  const who = { entryId: 'echo', paneId: 'counter' }

  it('一份都没开 → 两格都不给，落当前活动组', () => {
    const plan = planOpen(counter, { key: 'a' }, [], who)
    expect(plan).not.toHaveProperty('direction')
    expect(plan).not.toHaveProperty('referencePanel')
  })

  it('开着一份 → 右边一个新 group，不给参照（相对当前活动的那一格）', () => {
    const plan = planOpen(counter, { key: 'b' }, kept('a'), who)
    expect(plan).toMatchObject({ kind: 'open', id: `${BASE}:2`, direction: 'right' })
    expect(plan).not.toHaveProperty('referencePanel')
  })

  it('开着两份 → 往下叠，**参照显式给**', () => {
    // 只说 below 不给参照的话，dockview 按整口井算（AbsolutePosition），新那份会横在
    // 正文格底下而不是叠在上一份评论下面——这条正是这次改动的要害
    expect(planOpen(counter, { key: 'c' }, kept('a', 'b'), who)).toMatchObject({
      kind: 'open',
      id: `${BASE}:3`,
      direction: 'below',
      referencePanel: `${BASE}:2`,
    })
  })

  it('参照的那一份**不是基名**——基名那份装的是件先开出来的内容，参照它就又挂回它底下', () => {
    const plan = planOpen(counter, { key: 'd' }, kept('a', 'b', 'c'), who)
    const ref = plan.kind === 'open' ? plan.referencePanel : undefined
    expect(ref).not.toBe(BASE)
    expect(ref).toBe(`${BASE}:3`)
  })

  it('基名那一份被人关掉了照样往下叠：表里剩的全是非基名的', () => {
    const open: OpenPane[] = [
      { id: `${BASE}:2`, key: 'b', preview: false },
      { id: `${BASE}:3`, key: 'c', preview: false },
    ]
    expect(planOpen(counter, { key: 'd' }, open, who)).toMatchObject({
      direction: 'below',
      referencePanel: `${BASE}:3`,
    })
  })

  it('预览格新开的那一份走同一张表——落位不看要没要 preview', () => {
    expect(planOpen(counter, { key: 'c', preview: true }, kept('a', 'b'), who)).toMatchObject({
      kind: 'open',
      direction: 'below',
      referencePanel: `${BASE}:2`,
    })
  })
})

/**
 * 预览格那套语义：至多一份、可被顶掉、转正之后就顶不动了。**照 VS Code 的规矩，
 * 实现是我们自己的**（dockview 的 PinnedTabs 是付费模块，而且它的 pin 管的是排序与溢出）。
 */
describe('planOpen 的预览格：至多一份，下一次 preview 打开原地换掉它', () => {
  const counter = specForPane({ ...echo, id: 'counter', title: '计数器', icon: 'hash' })
  const who = { entryId: 'echo', paneId: 'counter' }

  function paramsOf(plan: ReturnType<typeof planOpen>) {
    if (plan.kind === 'open') return plan.spec.params
    return plan.kind === 'retarget' ? plan.params : undefined
  }

  it('没有预览格 → 新开一份并标成预览格', () => {
    const plan = planOpen(counter, { key: 'a', preview: true }, [], who)
    expect(plan).toMatchObject({ kind: 'open', id: BASE })
    expect(paramsOf(plan)).toMatchObject({ key: 'a', preview: true })
  })

  it('没要 preview 的调用不碰预览格——**预览格只被 preview 打开顶掉**', () => {
    const plan = planOpen(counter, { key: 'b', params: { root: 'b' } }, withPreview([], 'a'), who)
    expect(plan).toMatchObject({ kind: 'open', id: `${BASE}:2` })
  })

  it('预览格活着 → **软换**：格不变、id 是它、params 整份换成新内容', () => {
    const swap = planOpen(counter, { key: 'b', preview: true, params: { root: 'b' } }, withPreview([], 'a'), who)
    expect(swap).toMatchObject({ kind: 'retarget', id: BASE })
    expect(paramsOf(swap)).toEqual({
      pluginKey: '@godcreator02/gwb-echo',
      entryId: 'echo',
      paneId: 'counter',
      icon: 'hash',
      key: 'b',
      preview: true,
      root: 'b',
    })
  })

  it('**软换那份 params 带着 icon**：开格与软换同一处拼，不然换完标签上的图标会变成兜底那枚', () => {
    const swap = planOpen(counter, { key: 'b', preview: true }, withPreview([], 'a'), who)
    expect(paramsOf(swap)).toMatchObject({ icon: 'hash' })
  })

  it('正式格开着好几份、预览格另有一份 → 换的是预览格那一份', () => {
    const open = withPreview(kept('a', 'b'), 'c')
    const plan = planOpen(counter, { key: 'd', preview: true }, open, who)
    expect(plan).toMatchObject({ kind: 'retarget', id: `${BASE}:3` })
  })

  it('要开的内容已经在某一格里（预览格或正式格都算）→ 聚焦它，不换内容', () => {
    expect(planOpen(counter, { key: 'a', preview: true }, withPreview([], 'a'), who)).toEqual({
      kind: 'focus',
      id: BASE,
    })
    expect(planOpen(counter, { key: 'a', preview: true }, kept('a'), who)).toEqual({ kind: 'focus', id: BASE })
  })

  it('预览格转正之后（表里没有 preview 的那一份了）→ 下一次 preview 开的是新的一格', () => {
    // 「在预览格里打字就转正」与「双击标签转正」落到这儿都是同一件事：表里没有预览格了
    const plan = planOpen(counter, { key: 'b', preview: true }, kept('a'), who)
    expect(plan).toMatchObject({ kind: 'open', id: `${BASE}:2` })
    expect(paramsOf(plan)).toMatchObject({ key: 'b', preview: true })
  })

  it('没要 preview → 开的是正式格：params 里**没有** preview 这个键，不是 false', () => {
    const plan = planOpen(counter, { key: 'a' }, [], who)
    expect(paramsOf(plan)).not.toHaveProperty('preview')
    expect(paramsOf(plan)).toMatchObject({ key: 'a' })
  })
})

/**
 * 开多份时那几份靠什么彼此不同：件在 `openPane` 里传一份参数，它并进面板 params、
 * 跟着布局落盘，再原样到那一份的 `mountPane` 手上。
 */
describe('planOpen 的 params：件说这一份是给谁的', () => {
  const counter = specForPane({ ...echo, id: 'counter', title: '计数器' })
  const who = { entryId: 'echo', paneId: 'counter' }

  /** 开出来的那一份的面板 params */
  function paramsOf(plan: ReturnType<typeof planOpen>) {
    return plan.kind === 'open' ? plan.spec.params : undefined
  }

  it('件传的键跟识别三件套并排落在同一份 params 里，身份那一格也在', () => {
    const plan = planOpen(counter, { key: 'a.md', params: { file: 'a.md', line: 3 } }, [], who)
    expect(paramsOf(plan)).toEqual({
      pluginKey: '@godcreator02/gwb-echo',
      entryId: 'echo',
      paneId: 'counter',
      key: 'a.md',
      file: 'a.md',
      line: 3,
    })
  })

  it('两份各拿各的——「几份之间彼此不同」就是这条', () => {
    const first = planOpen(counter, { key: 'a', params: { file: 'a.md' } }, [], who)
    const second = planOpen(counter, { key: 'b', params: { file: 'b.md' } }, kept('a'), who)
    expect(second.kind === 'open' ? second.id : '').toBe(`${BASE}:2`)
    expect(paramsOf(first)?.file).toBe('a.md')
    expect(paramsOf(second)?.file).toBe('b.md')
  })

  it('不传 params 的调用方一个字不用改：面板 params 还是那三样加一个空身份', () => {
    expect(paramsOf(planOpen(counter, undefined, [], who))).toEqual({ ...counter.params, key: '' })
  })

  it('保留键改不动这一格的身份：摘掉，而且要出声', () => {
    // **这条实机点不出来**——得专门写一个乱传的件才走得到
    const plan = planOpen(
      counter,
      { key: 'a', params: { entryId: '别人的条目', pluginKey: '@x/x', icon: 'skull', file: 'a.md' } },
      [],
      who,
    )
    expect(paramsOf(plan)).toEqual({
      pluginKey: '@godcreator02/gwb-echo',
      entryId: 'echo',
      paneId: 'counter',
      key: 'a',
      file: 'a.md',
    })
    expect(plan.kind === 'open' ? plan.notice : '').toMatch(/保留键/)
  })

  it('`key` 与 `preview` 也是保留键：件拿它们当自己的参数名会被摘掉并出声', () => {
    // 摘掉之后按上的是**外壳算出来的**那两个值，不是件传的——身份归外壳
    const plan = planOpen(counter, { key: 'a', params: { key: '冒充的', preview: true } }, [], who)
    expect(paramsOf(plan)).toEqual({ ...counter.params, key: 'a' })
    expect(plan.kind === 'open' ? plan.notice : '').toMatch(/保留键/)
  })

  it('聚焦已开的那份时参数不作数——那一格装的本来就是这份内容，改 params 只会让档跟界面对不上', () => {
    const plan = planOpen(counter, { key: 'a', params: { file: 'a.md' } }, kept('a'), who)
    expect(plan).toEqual({ kind: 'focus', id: BASE })
  })

  it('软换那条也要摘保留键、也要出声', () => {
    const plan = planOpen(counter, { key: 'b', preview: true, params: { icon: 'skull' } }, withPreview([], 'a'), who)
    expect(plan.kind).toBe('retarget')
    expect(plan.kind === 'retarget' ? plan.notice : '').toMatch(/保留键/)
  })
})

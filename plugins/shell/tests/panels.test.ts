import { describe, expect, it } from 'vitest'
import {
  isPluginPanel,
  isPreviewPanel,
  paneIdOf,
  paneKeyOf,
  paramsKeyOf,
  pluginKeyOf,
  pluginParamsIn,
  replaceParams,
  shellParamKeysIn,
  PLUGIN_COMPONENT,
  SHELL_PARAM_KEYS,
} from '../src/panels.js'

/**
 * 「重载 UI」按钮出不出现，看的是激活那格的 component，不是 id 前缀。
 * 调试口 `__gwbDebug.openPanel({ id: 'example-probe', component: 'plugin', … })` 开出来的
 * 格 id 不带 `plugin:`，按前缀判会把它漏掉——从调试口开的格反而用不上调试功能。
 */

describe('isPluginPanel：按 component 判，不看 id', () => {
  it('component 是插件窗格就算，id 叫什么都行', () => {
    expect(isPluginPanel({ view: { contentComponent: PLUGIN_COMPONENT } })).toBe(true)
  })

  it('导航格、别的 component 不算', () => {
    expect(isPluginPanel({ view: { contentComponent: 'nav' } })).toBe(false)
    expect(isPluginPanel({ view: { contentComponent: 'settings' } })).toBe(false)
  })

  it('没有激活格、形状缺失，一律 false', () => {
    expect(isPluginPanel(undefined)).toBe(false)
    expect(isPluginPanel(null)).toBe(false)
    expect(isPluginPanel({})).toBe(false)
    expect(isPluginPanel({ view: {} })).toBe(false)
  })

  it('COMPONENTS 表里插件窗格那个键就是这个常量（壳自己开的格与调试口开的格同一个判据）', () => {
    expect(PLUGIN_COMPONENT).toBe('plugin')
  })
})

/**
 * 一格背后是哪个插件，认的是 `params.pluginKey`（完整包名，跟条目视图的 pkg 同一个
 * 字符串）。卸载后该关哪几格全靠它对上号。
 */
describe('pluginKeyOf：认 params.pluginKey，认不出回空串', () => {
  it('插件格回它的包名', () => {
    const panel = { view: { contentComponent: PLUGIN_COMPONENT }, params: { pluginKey: '@godcreator02/echo' } }
    expect(pluginKeyOf(panel)).toBe('@godcreator02/echo')
  })

  it('不是插件格的一律空串——导航格的 params 里就算写了这一项也不算', () => {
    expect(pluginKeyOf({ view: { contentComponent: 'nav' }, params: { pluginKey: 'x' } })).toBe('')
  })

  it('插件格但 params 缺项、类型不对、整个没有：一律空串', () => {
    expect(pluginKeyOf({ view: { contentComponent: PLUGIN_COMPONENT } })).toBe('')
    expect(pluginKeyOf({ view: { contentComponent: PLUGIN_COMPONENT }, params: {} })).toBe('')
    expect(pluginKeyOf({ view: { contentComponent: PLUGIN_COMPONENT }, params: { pluginKey: 42 } })).toBe('')
  })

  it('没有面板一律空串', () => {
    expect(pluginKeyOf(null)).toBe('')
    expect(pluginKeyOf(undefined)).toBe('')
  })
})

/**
 * 一份面板 params 装两半：外壳的识别三件套（加图标）与件开这一份时传的那些键。
 * 这两个函数就是那条分界线——进面板前摘一次，出到件手上再摘一次。
 */
describe('保留键：外壳那半与件那半的分界', () => {
  it('名单是识别三件套、图标，加上内容身份那两样', () => {
    expect([...SHELL_PARAM_KEYS]).toEqual(['pluginKey', 'entryId', 'paneId', 'icon', 'key', 'preview'])
  })

  it('件那半摘掉保留键，剩下的原样留着', () => {
    expect(
      pluginParamsIn({
        pluginKey: '@x/x',
        entryId: 'echo',
        paneId: 'main',
        icon: 'flask',
        key: 'a',
        preview: true,
        file: 'a.md',
        line: 3,
      }),
    ).toEqual({ file: 'a.md', line: 3 })
  })

  it('值是什么形状都不动它——只按键名摘，不碰值', () => {
    const nested = { where: { file: 'a.md', at: [1, 2] }, open: false, none: null }
    expect(pluginParamsIn(nested)).toEqual(nested)
  })

  it('一个键都不剩回 undefined，不回空对象——件那头就能拿「没有」当「没给参数」', () => {
    expect(pluginParamsIn(undefined)).toBeUndefined()
    expect(pluginParamsIn({})).toBeUndefined()
    expect(pluginParamsIn({ pluginKey: '@x/x', entryId: 'echo', paneId: 'main' })).toBeUndefined()
  })

  it('踩了哪几个保留键说得出名字——摘掉要出声，不静默', () => {
    expect(shellParamKeysIn({ entryId: '别人的', file: 'a.md' })).toEqual(['entryId'])
    expect(shellParamKeysIn({ paneId: 'x', icon: 'y', file: 'a.md' })).toEqual(['paneId', 'icon'])
  })

  it('没踩就没话说', () => {
    expect(shellParamKeysIn(undefined)).toEqual([])
    expect(shellParamKeysIn({ file: 'a.md' })).toEqual([])
  })
})

/**
 * 这一格装的是什么、是不是预览格：两样都住在面板 params 里，所以它们跟着布局落盘——
 * 重载之后外壳照旧认得出哪一格装着什么、哪一格是预览格，不用另存一份账。
 */
describe('paneIdOf / paneKeyOf / isPreviewPanel：一格的身份', () => {
  const plugin = (params: Record<string, unknown>) => ({ view: { contentComponent: PLUGIN_COMPONENT }, params })

  it('paneIdOf 认 params.paneId，认不出回空串', () => {
    expect(paneIdOf(plugin({ paneId: 'reader' }))).toBe('reader')
    expect(paneIdOf(plugin({}))).toBe('')
    expect(paneIdOf({ view: { contentComponent: 'nav' }, params: { paneId: 'reader' } })).toBe('')
  })

  it('paneKeyOf 认 params.key；**没给过就是空串，而空串是个正当的身份**', () => {
    expect(paneKeyOf(plugin({ key: 'blk-1' }))).toBe('blk-1')
    expect(paneKeyOf(plugin({ key: '' }))).toBe('')
    // 默认布局铺出来的那一份身上没有 key——它跟「件不给 key 开的那一份」是同一格
    expect(paneKeyOf(plugin({}))).toBe('')
    expect(paneKeyOf(plugin({ key: 42 }))).toBe('')
  })

  it('isPreviewPanel 判的是 === true：正式格身上没有这个键，不是 false', () => {
    expect(isPreviewPanel(plugin({ preview: true }))).toBe(true)
    expect(isPreviewPanel(plugin({}))).toBe(false)
    expect(isPreviewPanel(plugin({ preview: false }))).toBe(false)
    expect(isPreviewPanel(plugin({ preview: 'true' }))).toBe(false)
    expect(isPreviewPanel(null)).toBe(false)
  })
})

/**
 * **dockview 的 `updateParameters` 是并不是换**：面板那头做的是 `{ …旧, …新 }`，
 * 只有值写成 `undefined` 的键才删。软换一格的内容时不补这一道，上一份的参数会赖在
 * 这一格里跟着落盘——而现象只是「件收到了一个它这一轮没传过的参数」。
 */
describe('replaceParams：把「并」拼成「换」', () => {
  it('旧那份里多出来的键显式写成 undefined', () => {
    expect(replaceParams({ a: 1, stale: 'x' }, { a: 2 })).toEqual({ a: 2, stale: undefined })
  })

  it('新那份的值原样压上，同名的不用标删', () => {
    expect(replaceParams({ root: 'a' }, { root: 'b' })).toEqual({ root: 'b' })
  })

  it('新那份里多出来的键照常加进去，不用标删', () => {
    expect(replaceParams({ a: 1 }, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 })
  })

  it('没有旧那份就是原样回新的', () => {
    expect(replaceParams(undefined, { a: 1 })).toEqual({ a: 1 })
  })
})

/**
 * 「这一份的参数换了没有」拿它比。面板 params 每轮渲染都摘出一个新对象，按引用比等于
 * 每轮都算换了；而 params 本来就要求可 JSON 序列化，所以序列化得出来。
 */
describe('paramsKeyOf：稳定序列化', () => {
  it('同样的内容算出同一个键——**键先排序**，跟写的顺序无关', () => {
    expect(paramsKeyOf({ a: 1, b: 2 })).toBe(paramsKeyOf({ b: 2, a: 1 }))
  })

  it('内容不一样就不一样', () => {
    expect(paramsKeyOf({ root: 'a' })).not.toBe(paramsKeyOf({ root: 'b' }))
    expect(paramsKeyOf({ root: 'a' })).not.toBe(paramsKeyOf({ root: 'a', at: 1 }))
  })

  it('嵌套的值也算进去', () => {
    expect(paramsKeyOf({ where: { file: 'a.md' } })).not.toBe(paramsKeyOf({ where: { file: 'b.md' } }))
  })

  it('没有参数回空串，而且跟空表分得开——「没给」与「给了个空的」是两回事', () => {
    expect(paramsKeyOf(undefined)).toBe('')
    expect(paramsKeyOf({})).not.toBe('')
  })
})

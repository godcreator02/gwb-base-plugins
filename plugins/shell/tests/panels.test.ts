import { describe, expect, it } from 'vitest'
import {
  isPluginPanel,
  pluginKeyOf,
  pluginParamsIn,
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
  it('名单就是识别三件套加图标', () => {
    expect([...SHELL_PARAM_KEYS]).toEqual(['pluginKey', 'entryId', 'paneId', 'icon'])
  })

  it('件那半摘掉保留键，剩下的原样留着', () => {
    expect(
      pluginParamsIn({ pluginKey: '@x/x', entryId: 'echo', paneId: 'main', icon: 'flask', file: 'a.md', line: 3 }),
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

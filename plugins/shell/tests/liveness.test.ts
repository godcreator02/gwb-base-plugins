import { describe, expect, it } from 'vitest'
import { deadPluginPanels, panePluginState, type EntryLike } from '../src/liveness.js'
import { PLUGIN_COMPONENT } from '../src/panels.js'

/**
 * 插件卸载之后那一格会变成僵尸：DOM 停在最后一帧，轮询继续打到已经注销的命令上。
 * 判据只有条目视图——宿主卸载时不向渲染层广播任何东西。
 */

const live: EntryLike = { id: 'echo', pkg: '@godcreator02/echo', disabled: false }
const other: EntryLike = { id: 'logger', pkg: '@godcreator02/logger', disabled: false }

function pane(pluginKey: string, entryId?: string) {
  return {
    view: { contentComponent: PLUGIN_COMPONENT },
    params: entryId === undefined ? { pluginKey } : { pluginKey, entryId },
  }
}

describe('panePluginState：卸了就关，没启用只画一句话', () => {
  it('条目视图里没有这个包 → gone（该关掉）', () => {
    expect(panePluginState([other], { pluginKey: live.pkg })).toEqual({ kind: 'gone', notice: '插件已卸载' })
  })

  it('条目还在、禁用着 → idle，提示「插件未启用」（格留着）', () => {
    expect(panePluginState([{ ...live, disabled: true }], { pluginKey: live.pkg })).toEqual({
      kind: 'idle',
      notice: '插件未启用',
    })
  })

  it('条目还在、带 unmet 没挂上 → idle，原样摆出那句话（它自带前缀）', () => {
    const entries = [{ ...live, unmet: '挂载失败：apply 抛了' }]
    expect(panePluginState(entries, { pluginKey: live.pkg })).toEqual({
      kind: 'idle',
      notice: '挂载失败：apply 抛了',
    })
  })

  it('条目在、启用着、没有 unmet → live', () => {
    expect(panePluginState([live, other], { pluginKey: live.pkg })).toEqual({ kind: 'live' })
    // 空串的 unmet 跟没有一样，不该把格打成未生效
    expect(panePluginState([{ ...live, unmet: '' }], { pluginKey: live.pkg })).toEqual({ kind: 'live' })
  })

  it('条目表还没到手（null）一律 live——拿空表当「都卸了」会在首帧把格关光', () => {
    expect(panePluginState(null, { pluginKey: live.pkg })).toEqual({ kind: 'live' })
    // 到手之后的空表才是真的「一条条目都没有」
    expect(panePluginState([], { pluginKey: live.pkg })).toEqual({ kind: 'gone', notice: '插件已卸载' })
  })

  it('没有 pluginKey 的格不归这条判据管（那条错由窗格自己报）', () => {
    expect(panePluginState([], { pluginKey: '' })).toEqual({ kind: 'live' })
  })

  it('认的是条目不是包：同一个包挂两条，禁用哪条就只有哪条那几格变 idle', () => {
    // 按包取首条的话，禁用第二条时它那格照挂照跑，禁用第一条时两格一起假死
    const a: EntryLike = { id: 'pomo-work', pkg: '@godcreator02/pomodoro', disabled: false }
    const b: EntryLike = { id: 'pomo-rest', pkg: a.pkg, disabled: true }
    expect(panePluginState([a, b], { pluginKey: a.pkg, entryId: 'pomo-work' })).toEqual({ kind: 'live' })
    expect(panePluginState([a, b], { pluginKey: a.pkg, entryId: 'pomo-rest' })).toEqual({
      kind: 'idle',
      notice: '插件未启用',
    })
  })

  it('那条条目整个没了 → gone，哪怕同一个包的另一条还在', () => {
    const a: EntryLike = { id: 'pomo-work', pkg: '@godcreator02/pomodoro', disabled: false }
    expect(panePluginState([a], { pluginKey: a.pkg, entryId: 'pomo-rest' })).toEqual({
      kind: 'gone',
      notice: '插件已卸载',
    })
  })

  it('老格没带 entryId：按包找首条，跟从前一样', () => {
    // 这一版之前落盘的布局恢复出来就是这个形状，判据得接得住
    expect(panePluginState([live], { pluginKey: live.pkg })).toEqual({ kind: 'live' })
  })
})

describe('deadPluginPanels：只挑该关的那几格', () => {
  it('卸掉的插件那几格全挑出来，同一个插件开几格就挑几格', () => {
    const panels = [pane(live.pkg), pane(live.pkg), pane(other.pkg)]
    expect(deadPluginPanels(panels, [other])).toEqual([panels[0], panels[1]])
  })

  it('禁用着的不挑（格留着画提示），条目表没到手时一格都不挑', () => {
    expect(deadPluginPanels([pane(live.pkg)], [{ ...live, disabled: true }])).toEqual([])
    expect(deadPluginPanels([pane(live.pkg)], null)).toEqual([])
  })

  it('导航格这类非插件格不挑——pluginKeyOf 回空串，天然落在 live 一档', () => {
    const nav = { view: { contentComponent: 'nav' } }
    expect(deadPluginPanels([nav], [])).toEqual([])
  })

  it('条目被摘掉时只关它那几格，同包另一条的格留着', () => {
    const a: EntryLike = { id: 'pomo-work', pkg: '@godcreator02/pomodoro', disabled: false }
    const panels = [pane(a.pkg, 'pomo-work'), pane(a.pkg, 'pomo-rest')]
    expect(deadPluginPanels(panels, [a])).toEqual([panels[1]])
  })
})

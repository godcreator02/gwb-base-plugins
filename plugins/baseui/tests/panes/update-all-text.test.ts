import { describe, expect, it } from 'vitest'
import { describeUpdateAll } from '../../src/client/panes/plugin-manager/update-all'

/** 回执 → 窗格上的几行话。形状按 node 半的 UpdateAllResult 收，认不出的丢、不崩 */

describe('describeUpdateAll', () => {
  it('升了几个包逐包一行，条目带去向与状态；reload 决定 busy 态撤不撤', () => {
    const view = describeUpdateAll({
      ok: true,
      data: {
        updated: [
          {
            pkg: '@x/gwb-hello',
            from: '0.2.0',
            to: '0.2.1',
            entries: [
              { id: 'hello', action: 'remounted', state: 'ACTIVE' },
              { id: 'hello-2', action: 'skipped', state: 'disabled' },
            ],
          },
          { pkg: '@x/gwb-tokens', from: '0.0.5', to: '0.0.6', entries: [] },
        ],
        selfDeferred: false,
        reload: 'done',
      },
    })
    expect(view.ok).toBe(true)
    expect(view.reloading).toBe(true)
    expect(view.text.split('\n')).toEqual([
      '升了 2 个包：',
      '@x/gwb-hello 0.2.0 → 0.2.1：hello（remounted，ACTIVE）、hello-2（skipped，disabled）',
      '@x/gwb-tokens 0.0.5 → 0.0.6（没挂条目）',
      '界面已整页重载',
    ])
  })

  it('自己也升了：说一声这一格会先关再开，重载是随后的', () => {
    const view = describeUpdateAll({
      ok: true,
      data: { updated: [{ pkg: '@x/gwb-plugins', from: '0.2.1', to: '0.3.0', entries: [] }], selfDeferred: true, reload: 'deferred', note: '命令表里没有 shell.reload，界面要手动刷新' },
    })
    expect(view.reloading).toBe(true)
    expect(view.text).toContain('先关再开')
    expect(view.text).toContain('界面随后整页重载')
    expect(view.text).toContain('手动刷新')
  })

  it('全都最新：贴 note，不是 busy', () => {
    const view = describeUpdateAll({ ok: true, data: { updated: [], selfDeferred: false, note: '全都最新' } })
    expect(view).toEqual({ ok: true, text: '全都最新', reloading: false })
  })

  it('没成：error 带上 tail，不吞', () => {
    const view = describeUpdateAll({ ok: false, error: 'pnpm add 没成（退出码 1）', data: { ok: false, tail: 'ERR_PNPM_NO_MATCHING_VERSION' } })
    expect(view.ok).toBe(false)
    expect(view.reloading).toBe(false)
    expect(view.text).toBe('pnpm add 没成（退出码 1）\nERR_PNPM_NO_MATCHING_VERSION')
  })

  it('data 形状坏了也不崩', () => {
    expect(describeUpdateAll({ ok: true, data: 'nope' }).text).toBe('全都最新')
    expect(describeUpdateAll({ ok: true, data: { updated: [42, null] } }).text).toBe('升了 2 个包：')
  })
})

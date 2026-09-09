import { describe, expect, it, vi } from 'vitest'
import { electronWindows, reloadWindows, type ReloadableWindow } from '../src/reload.js'

/** `shell.reload` 的纯逻辑那半：取窗口列表是注入的，electron 不在也测得了 */

function fakeWindow(): ReloadableWindow & { reloads: number } {
  const win = { reloads: 0, webContents: { reload: () => undefined } }
  win.webContents.reload = () => {
    win.reloads += 1
  }
  return win
}

describe('reloadWindows', () => {
  it('没有窗口回 ok:false 说清楚——不静默回成功', () => {
    const result = reloadWindows({ windows: () => [] })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('没有开着的窗口')
    expect(result).not.toHaveProperty('reloaded')
  })

  it('有几扇 reload 几扇，回执带数', () => {
    const a = fakeWindow()
    const b = fakeWindow()
    expect(reloadWindows({ windows: () => [a, b] })).toEqual({ ok: true, reloaded: 2 })
    expect(a.reloads).toBe(1)
    expect(b.reloads).toBe(1)
  })

  it('每次调都现取列表，不缓存', () => {
    const windows = vi.fn(() => [fakeWindow()])
    reloadWindows({ windows })
    reloadWindows({ windows })
    expect(windows).toHaveBeenCalledTimes(2)
  })
})

describe('electronWindows', () => {
  it('不在 Electron 里（测试进程）就 reject——调用方收成回执，不炸', async () => {
    await expect(electronWindows()).rejects.toBeInstanceOf(Error)
  })
})

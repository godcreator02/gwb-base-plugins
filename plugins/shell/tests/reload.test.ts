import { describe, expect, it, vi } from 'vitest'
import { electronWindows, reloadWindows, windowsOf, type ReloadableWindow } from '../src/reload.js'

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

describe('windowsOf：从 import("electron") 的命名空间里认出窗口列表', () => {
  const win = fakeWindow()
  const api = { BrowserWindow: { getAllWindows: () => [win] } }

  it('default 上有也认——ESM 里 import() 一个 CJS 包，API 整个挂在 default 上（实机撞过）', () => {
    expect(windowsOf({ default: api }).windows()).toEqual([win])
  })

  it('顶层就有也认；default 不是对象时退回命名空间本身', () => {
    expect(windowsOf(api).windows()).toEqual([win])
    expect(windowsOf({ ...api, default: 'nope' }).windows()).toEqual([win])
  })

  it('两头都没有就抛，话里说清 default 也看过了', () => {
    expect(() => windowsOf({ default: {} })).toThrow('default 上也没有')
    expect(() => windowsOf(undefined)).toThrow()
    expect(() => windowsOf({ BrowserWindow: {} })).toThrow()
  })
})

describe('electronWindows', () => {
  it('不在 Electron 里（测试进程）就 reject——调用方收成回执，不炸', async () => {
    await expect(electronWindows()).rejects.toBeInstanceOf(Error)
  })
})

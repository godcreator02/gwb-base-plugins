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
  /** 照真的 electron 喂：BrowserWindow 是一个**类**，typeof 是 'function'。0.2.2 / 0.2.3 按「是对象」判它，实机上它就等于不存在 */
  class BrowserWindow {
    static getAllWindows(): ReloadableWindow[] {
      return [win]
    }
  }
  const api = { BrowserWindow }

  it('BrowserWindow 是类（typeof function）也认——实机撞过两版的那条', () => {
    expect(windowsOf(api).windows()).toEqual([win])
  })

  it('default 上挂着类也认；default 不是对象时退回命名空间本身', () => {
    expect(windowsOf({ default: api }).windows()).toEqual([win])
    expect(windowsOf({ ...api, default: 'nope' }).windows()).toEqual([win])
  })

  it('普通对象形状（{ getAllWindows }）照旧认', () => {
    expect(windowsOf({ BrowserWindow: { getAllWindows: () => [win] } }).windows()).toEqual([win])
  })

  it('BrowserWindow 不在、或在但没有 getAllWindows，都抛且话里分得开', () => {
    expect(() => windowsOf({ default: {} })).toThrow('BrowserWindow 不在')
    expect(() => windowsOf(undefined)).toThrow('BrowserWindow 不在')
    expect(() => windowsOf({ BrowserWindow: class {} })).toThrow('没有 getAllWindows')
    expect(() => windowsOf({ BrowserWindow: {} })).toThrow('没有 getAllWindows')
  })
})

describe('electronWindows', () => {
  it('不在 Electron 里（测试进程）就 reject——调用方收成回执，不炸', async () => {
    await expect(electronWindows()).rejects.toBeInstanceOf(Error)
  })
})

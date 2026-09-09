/**
 * `shell.reload`：整页重载所有窗口。
 *
 * 件跑在 Electron **主进程**里，`import('electron')` 拿得到 `BrowserWindow`——开窗、重载全归件，
 * 内核一条都不代办（内核仓 AGENTS 写的）。渲染层为什么要整页重载而不是外壳内部重建：开着的
 * 格持的是旧的 client 束、importmap 只在开机注一次，装了新件、热升了件之后只有 reload 能让
 * 页面重新 import 到新东西。状态栏那颗「刷新」是同一件事的人手版，这条是给命令面的
 * （`plugins.update-all` 收尾时调它）。
 *
 * **取窗口列表抽成可注入的 deps**：测试里没有 electron，纯逻辑那半（没窗口怎么答、有几扇
 * 就 reload 几扇）喂一份假的就能测。
 */

/** 能 reload 的窗口——只收用得着的一格，electron 的 `BrowserWindow` 满足它 */
export interface ReloadableWindow {
  webContents: { reload(): void }
}

export interface ReloadDeps {
  /** 此刻开着的窗口 */
  windows(): ReloadableWindow[]
}

export interface ReloadResult {
  ok: boolean
  /** 成了才有：reload 了几扇 */
  reloaded?: number
  /** 没成时的一句话 */
  error?: string
}

/** 逐扇 `webContents.reload()`。**没有窗口回 `ok: false`**——静默回成功的话，调用方以为界面刷了，其实什么都没发生 */
export function reloadWindows(deps: ReloadDeps): ReloadResult {
  const list = deps.windows()
  if (list.length === 0) {
    return { ok: false, error: '没有开着的窗口，没什么可重载的（窗口关了，或者不在 Electron 主进程里）' }
  }
  for (const win of list) win.webContents.reload()
  return { ok: true, reloaded: list.length }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * `import('electron')` 回的命名空间 → deps。**先看 `default`**：electron 是 CJS 包，ESM 里
 * `import()` 回的命名空间把整个 API 挂在 `default` 上（内核 `main.ts` 就是
 * `import electron from 'electron'` 再 `electron.BrowserWindow`），顶层没有 `BrowserWindow`。
 * 实机撞过：0.2.2 直接从命名空间取，回的是「不在 Electron 主进程里」。`default` 不是对象
 * 就退回命名空间本身——将来它真出了 ESM 出口也认。认不出就抛，调用方收成回执
 */
export function windowsOf(mod: unknown): ReloadDeps {
  const api = isRecord(mod) && isRecord(mod['default']) ? mod['default'] : mod
  const bw = isRecord(api) ? api['BrowserWindow'] : undefined
  const getAll = isRecord(bw) ? bw['getAllWindows'] : undefined
  if (typeof getAll !== 'function') {
    throw new Error('import("electron") 里没有 BrowserWindow.getAllWindows（default 上也没有）——不在 Electron 主进程里')
  }
  return { windows: () => (getAll as () => ReloadableWindow[])() }
}

/**
 * 真机那份 deps：`BrowserWindow.getAllWindows()`。
 *
 * 说明符走变量，**不让 tsc 去解析 `electron` 这个模块**——本包不依赖它的类型（那要把整个
 * electron 装进件的 devDependencies，只为一个方法名），运行时它就在主进程里。不在
 * Electron 里（比如测试里）就 reject，调用方收成回执
 */
export async function electronWindows(): Promise<ReloadDeps> {
  const spec = 'electron'
  return windowsOf(await import(spec))
}

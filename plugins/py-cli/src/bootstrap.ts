import fs from 'node:fs'
import path from 'node:path'
import { runProcess } from './run.js'

// venv 检查：不在就建、版本对不上就同步、已经好了就跳过。`Scripts` / `Lib` 是 Windows 的目录名，本插件只在 Windows 上分发

/** uv sync 的时限。第一次可能要下载 python 解释器，给得宽一点 */
export const SYNC_TIMEOUT_MS = 300_000

/** 出身记号：venv 建成时把包根写进去。放在 venv 里面，跟 venv 一起创建、一起删除 */
export const STAMP_NAME = '.gwb-built-for'

export interface VenvPaths {
  /** 那个 python 项目（含 pyproject.toml） */
  projectDir: string
  venvDir: string
  /** 可执行文件都在这里：入口点的 .exe、python.exe */
  scriptsDir: string
  sitePackages: string
  stampPath: string
}

export function venvPaths(packageRoot: string): VenvPaths {
  const projectDir = path.join(packageRoot, 'py')
  const venvDir = path.join(projectDir, '.venv')
  return {
    projectDir,
    venvDir,
    scriptsDir: path.join(venvDir, 'Scripts'),
    sitePackages: path.join(venvDir, 'Lib', 'site-packages'),
    stampPath: path.join(venvDir, STAMP_NAME),
  }
}

/** 包名归一化，照 PyPA 的规矩：`-`、`_`、`.` 折成 `_` 再小写。`dist-info` 的目录名用的是归一化之后的名字 */
export function normalizeDistName(name: string): string {
  return name.replace(/[-_.]+/g, '_').toLowerCase()
}

/** site-packages 里有没有装着这个版本。只看目录名，不启动 python */
export function hasDist(distInfoNames: readonly string[], distName: string, version: string): boolean {
  const wantedName = normalizeDistName(distName)
  return distInfoNames.some((entry) => {
    const match = /^(.+)-([^-]+)\.dist-info$/.exec(entry)
    if (match === null) return false
    return normalizeDistName(match[1]!) === wantedName && match[2] === version
  })
}

export interface StaleInput {
  venvExists: boolean
  /** 读到的出身记号内容；没有这个文件就是 undefined */
  stamp: string | undefined
  packageRoot: string
  /** site-packages 下的目录名 */
  distInfoNames: readonly string[]
  distName: string
  version: string
}

/** 不是最新的就说明原因；是最新的回 undefined。纯逻辑，检查结果由调用方传入 */
export function venvStaleReason(input: StaleInput): string | undefined {
  if (!input.venvExists) return 'venv 还没建'
  if (input.stamp === undefined) return `没有出身记号 ${STAMP_NAME}（多半是连着包目录从别处拷来的）`
  if (path.resolve(input.stamp) !== path.resolve(input.packageRoot)) {
    return `出身记号写的是别处的包根：${input.stamp}`
  }
  if (!hasDist(input.distInfoNames, input.distName, input.version)) {
    return `装的不是 ${input.distName} ${input.version}`
  }
  return undefined
}

/** 目录列不出来（不在、没权限）就当空表：调用方要的是「有没有那一项」 */
function listDirOrEmpty(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

function readStamp(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    return undefined
  }
}

export interface BootstrapOptions {
  packageRoot: string
  distName: string
  version: string
  log: (message: string) => void
  /** 运行 uv 的函数，测试里能替换 */
  sync?: (paths: VenvPaths) => Promise<{ ok: boolean; error?: string }>
}

export interface BootstrapResult {
  ready: boolean
  reason?: string
  /** 这次做了什么，写日志用 */
  action: 'skipped' | 'synced' | 'failed'
}

/** uv 从 PATH 找：它是机器上装的工具，不是插件带来的 */
async function defaultSync(paths: VenvPaths): Promise<{ ok: boolean; error?: string }> {
  const result = await runProcess({
    command: 'uv',
    args: ['sync', '--frozen', '--no-dev', '--inexact', '--project', paths.projectDir],
    cwd: paths.projectDir,
    timeoutMs: SYNC_TIMEOUT_MS,
  })
  if (result.ok) return { ok: true }
  // 启动不了 uv 时 spawn 的报错写进了 stderr，按那个字符串判断
  const text = `${result.stderr.text}${result.stdout.text}`
  if (/ENOENT/.test(text)) {
    return { ok: false, error: '启动不了 uv（PATH 上没有？）：装上 uv 或把它加进 PATH，再调用一次（每次运行前都会重新检查 venv）。' }
  }
  if (result.timedOut) {
    return { ok: false, error: `uv sync 超时（${SYNC_TIMEOUT_MS}ms）——第一次运行时可能在下载 python 解释器，再调用一次试试` }
  }
  return { ok: false, error: `uv sync 失败（退出码 ${String(result.exitCode)}）：\n${text.slice(-2000)}` }
}

function staleReasonNow(opts: BootstrapOptions, paths: VenvPaths): string | undefined {
  return venvStaleReason({
    venvExists: fs.existsSync(paths.venvDir),
    stamp: readStamp(paths.stampPath),
    packageRoot: opts.packageRoot,
    distInfoNames: listDirOrEmpty(paths.sitePackages),
    distName: opts.distName,
    version: opts.version,
  })
}

/**
 * 检查一次，不是最新的就同步；已经好了就直接跳过，不启动任何进程。
 * 不抛：uv 不在、同步失败，一律回 `{ ready: false, reason }`
 */
export async function ensureVenv(opts: BootstrapOptions): Promise<BootstrapResult> {
  const paths = venvPaths(opts.packageRoot)
  const stale = staleReasonNow(opts, paths)
  if (stale === undefined) return { ready: true, action: 'skipped' }

  opts.log(`venv 要建一次（${stale}）：${paths.venvDir}`)
  const sync = opts.sync ?? defaultSync
  const result = await sync(paths)
  if (!result.ok) {
    return { ready: false, reason: result.error ?? '没给出原因', action: 'failed' }
  }

  // 记号最后写：同步到一半失败的 venv 不该带着「已建好」的记号
  try {
    fs.writeFileSync(paths.stampPath, `${opts.packageRoot}\n`, 'utf8')
  } catch (stampError) {
    return { ready: false, reason: `venv 建好了但写不下出身记号：${String(stampError)}`, action: 'failed' }
  }

  // uv 报成功、但装的不是要的那个版本，这里要认出来
  const staleAfterSync = staleReasonNow(opts, paths)
  if (staleAfterSync !== undefined) {
    return { ready: false, reason: `uv sync 运行完了，但 venv 还是不对：${staleAfterSync}`, action: 'failed' }
  }
  return { ready: true, action: 'synced' }
}

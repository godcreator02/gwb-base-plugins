import fs from 'node:fs'
import path from 'node:path'
import { runProcess } from './run.js'

/**
 * venv 的守卫：件挂上时校验一次，不在就建、版本对不上就同步、已经好了就跳过。
 *
 * 四条不显然的约定，都是 DSH 那套撞出来的（见文档站）：
 * - **版本比对静态读 `dist-info` 的目录名，不起 python 进程**——热路径上零解释器开销
 * - **同步带 `--inexact`**：开发工位上 `py/.venv` 与项目自己的开发环境一份两吃
 * - **失败不抛**：uv 不在 PATH、退出非零，一律收敛成 `{ ready: false, reason }` 加人话
 * - **`Scripts` / `Lib` 是 Windows 专属段**——Windows-only 是本生态的分发前提
 */

/** uv sync 给多久。首次可能要下一个 python 解释器,松一点 */
export const SYNC_TIMEOUT_MS = 300_000

/**
 * 出身记号：venv 建成时把包根写进去。
 *
 * 放在 venv **里面**,让它跟 venv 同生共死——放外面的话 venv 被删了记号还在,
 * 就有了「记号说建好了、其实没有」的半状态。
 *
 * 防的是 venv 跟着包目录被整份搬走：venv 里的可编辑安装记着**建它那次**的包根,
 * 搬到别处照样起得来、但指向的是别人的树。DSH 为 pnpm 的 side-effects cache 撞出这条,
 * 我们不走 postinstall 用不上那个场景,但 home 被整体拷贝或改名时一模一样。
 */
export const STAMP_NAME = '.gwb-built-for'

export interface VenvPaths {
  /** 那个 python 项目（含 pyproject.toml）*/
  projectDir: string
  venvDir: string
  /** 可执行文件都在这儿：入口点垫片、python.exe */
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

/**
 * 包名归一化，照 PyPA 那条规矩：`-`、`_`、`.` 一律折成 `_`，再小写。
 * `dist-info` 的目录名用的是归一化之后的名字,所以比对前两边都得过一遍
 */
export function normalizeDistName(name: string): string {
  return name.replace(/[-_.]+/g, '_').toLowerCase()
}

/** site-packages 里有没有装着这个版本。只看目录名,不起 python */
export function hasDist(distInfoNames: readonly string[], distName: string, version: string): boolean {
  const want = normalizeDistName(distName)
  return distInfoNames.some((entry) => {
    const m = /^(.+)-([^-]+)\.dist-info$/.exec(entry)
    if (m === null) return false
    return normalizeDistName(m[1]!) === want && m[2] === version
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

/** 不新鲜的话说一句为什么；新鲜就回 undefined。纯逻辑,探测结果由调用方喂进来 */
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

/** 目录列不出来（不在、没权限）就当空表——调用方要的是「有没有那一条」,不是列目录本身 */
function listDir(dir: string): string[] {
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
  /** 跑 uv 的那一下,测试里能换掉 */
  sync?: (paths: VenvPaths) => Promise<{ ok: boolean; error?: string }>
}

export interface BootstrapResult {
  ready: boolean
  reason?: string
  /** 这一趟到底干了什么,日志里说得出来 */
  action: 'skipped' | 'synced' | 'failed'
}

/**
 * 跑一趟 `uv sync`。
 *
 * **uv 走 PATH**——这一条跟「跑件自己的 CLI 一律全路径」不是一回事：uv 是机器上的工具,
 * 不是件带来的东西。npm 上没有 astral 官方的分发包,判据见文档站。
 */
async function defaultSync(paths: VenvPaths): Promise<{ ok: boolean; error?: string }> {
  const result = await runProcess({
    command: 'uv',
    args: ['sync', '--frozen', '--no-dev', '--inexact', '--project', paths.projectDir],
    cwd: paths.projectDir,
    timeoutMs: SYNC_TIMEOUT_MS,
  })
  if (result.ok) return { ok: true }
  // 拉不起 uv 时 spawn 的 error 进了 stderr,认那个串
  const text = `${result.stderr.text}${result.stdout.text}`
  if (/ENOENT/.test(text)) {
    return { ok: false, error: '拉不起 uv（PATH 上没有？）：装上 uv 或把它加进 PATH,再重载本件。' }
  }
  if (result.timedOut) {
    return { ok: false, error: `uv sync 超时（${SYNC_TIMEOUT_MS}ms）——首次可能在下 python 解释器,重来一次试试` }
  }
  return { ok: false, error: `uv sync 没成（退出码 ${String(result.exitCode)}）：\n${text.slice(-2000)}` }
}

/**
 * 校验一次，不新鲜就同步。**幂等**：已经好了就直接跳过，不起任何进程。
 *
 * 失败不抛：uv 不在、同步没成，一律收敛成 `{ ready: false, reason }`——
 * 件本身照常挂上，只是这批命令不注册。
 */
export async function ensureVenv(opts: BootstrapOptions): Promise<BootstrapResult> {
  const paths = venvPaths(opts.packageRoot)
  const stale = venvStaleReason({
    venvExists: fs.existsSync(paths.venvDir),
    stamp: readStamp(paths.stampPath),
    packageRoot: opts.packageRoot,
    distInfoNames: listDir(paths.sitePackages),
    distName: opts.distName,
    version: opts.version,
  })
  if (stale === undefined) return { ready: true, action: 'skipped' }

  opts.log(`venv 要建一次（${stale}）：${paths.venvDir}`)
  const sync = opts.sync ?? defaultSync
  const result = await sync(paths)
  if (!result.ok) {
    return { ready: false, reason: result.error ?? '没说原因', action: 'failed' }
  }

  // 记号最后写:同步成了才算数,半截失败的 venv 不该带着一个说「我是好的」的记号
  try {
    fs.writeFileSync(paths.stampPath, `${opts.packageRoot}\n`, 'utf8')
  } catch (err) {
    return { ready: false, reason: `venv 建好了但写不下出身记号：${String(err)}`, action: 'failed' }
  }

  // 同步完再验一遍:uv 说成了、但装的不是要的那个版本,这儿要认出来
  const after = venvStaleReason({
    venvExists: fs.existsSync(paths.venvDir),
    stamp: readStamp(paths.stampPath),
    packageRoot: opts.packageRoot,
    distInfoNames: listDir(paths.sitePackages),
    distName: opts.distName,
    version: opts.version,
  })
  if (after !== undefined) {
    return { ready: false, reason: `uv sync 跑完了,但 venv 还是不对：${after}`, action: 'failed' }
  }
  return { ready: true, action: 'synced' }
}

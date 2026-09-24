import fs from 'node:fs'
import path from 'node:path'
import { runProcess } from './run.js'

/**
 * venv 的检查：登记命令行工具时检查一次，不在就建、版本对不上就同步、已经好了就跳过。
 *
 * 四条不显然的约定，都来自 gwb-dsh 插件遇到过的问题（见文档站）：
 * - **比对版本只读 `dist-info` 的目录名，不启动 python 进程**——每次运行前都要检查，不能有解释器开销
 * - **同步带 `--inexact`**：开发机上 `py/.venv` 同时是 python 项目自己的开发环境，不能删掉多出来的包
 * - **失败不抛错**：uv 不在 PATH、退出码非零，一律返回 `{ ready: false, reason }`，reason 说明原因
 * - **`Scripts` / `Lib` 是 Windows 专属的目录名**——本生态只在 Windows 上分发
 */

/** uv sync 的超时。第一次可能要下载 python 解释器，给得宽一点 */
export const SYNC_TIMEOUT_MS = 300_000

/**
 * 出身记号：venv 建成时把包根写进去。
 *
 * 放在 venv **里面**，跟 venv 一起创建、一起删除——放外面的话 venv 被删了记号还在，
 * 就有了「记号说建好了、其实没有」的中间状态。
 *
 * 防的是 venv 跟着包目录被整个搬走：venv 里的可编辑安装记着**建它那次**的包根，
 * 搬到别处照样能启动、但指向的是别处的目录。gwb-dsh 在 pnpm 的 side-effects cache 上遇到过，
 * 我们不用 postinstall、没有那个场景，但 home 被整体复制或改名时情况一样。
 */
export const STAMP_NAME = '.gwb-built-for'

export interface VenvPaths {
  /** 那个 python 项目（含 pyproject.toml）*/
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
  /** 运行 uv 的函数，测试里能替换 */
  sync?: (paths: VenvPaths) => Promise<{ ok: boolean; error?: string }>
}

export interface BootstrapResult {
  ready: boolean
  reason?: string
  /** 这次做了什么，写日志用 */
  action: 'skipped' | 'synced' | 'failed'
}

/**
 * 运行一次 `uv sync`。
 *
 * **uv 从 PATH 找**——这跟「插件自己的命令行工具一律用全路径」不矛盾：uv 是机器上装的工具，
 * 不是插件带来的。npm 上没有 astral 官方发布的 uv 包，理由见文档站。
 */
async function defaultSync(paths: VenvPaths): Promise<{ ok: boolean; error?: string }> {
  const result = await runProcess({
    command: 'uv',
    args: ['sync', '--frozen', '--no-dev', '--inexact', '--project', paths.projectDir],
    cwd: paths.projectDir,
    timeoutMs: SYNC_TIMEOUT_MS,
  })
  if (result.ok) return { ok: true }
  // 启动不了 uv 时 spawn 的 error 写进了 stderr，按那个字符串判断
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
 * 检查一次，不是最新的就同步。**幂等**：已经好了就直接跳过，不启动任何进程。
 *
 * 失败不抛错：uv 不在、同步没成，一律返回 `{ ready: false, reason }`。登记方插件照常加载、
 * 命令照常登记；运行时 venv 仍没就绪，那次运行抛错（见 index.ts 的 runRecord）。
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

  // 记号最后写：同步成功才写，同步到一半失败的 venv 不该带着「已建好」的记号
  try {
    fs.writeFileSync(paths.stampPath, `${opts.packageRoot}\n`, 'utf8')
  } catch (err) {
    return { ready: false, reason: `venv 建好了但写不下出身记号：${String(err)}`, action: 'failed' }
  }

  // 同步完再检查一遍：uv 报成功、但装的不是要的那个版本，这里要认出来
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

/**
 * pnpm 装在哪、怎么起——零 I/O 纯逻辑：盘上的事由调用方给三个判定（`stat` / `realpath` /
 * `pnpmVersion`），于是可测。真去查盘、真去起进程的那一层在 `pnpm.ts`。
 *
 * 查找的落点是一份**启动方式**（`PnpmLaunch`），两种：
 *
 * - `native`：原生可执行，直接 spawn。pnpm 12 起的 npm 包就是这种——`bin` 指 `pnpm.exe`，
 *   二进制来自可选依赖 `@pnpm/exe.<平台>-<架构>`
 * - `script`：pnpm 11 的 `bin/pnpm.cjs`，用宿主自己的 node 运行时跑
 *
 * 一个 pnpm 包是哪种，**按它 package.json 里的版本号定**（大版本 ≥ 12 是原生），不按盘上
 * 碰巧有哪个文件定。
 */

/** 从这个大版本起，pnpm 的 npm 包是原生可执行 */
export const NATIVE_SINCE_MAJOR = 12

export type PnpmLaunch = { kind: 'native'; file: string } | { kind: 'script'; file: string }

export interface Lookup {
  /** 设置项 `pnpm-path` 的值。没装设置件、或者没填，就是 undefined */
  configured?: string
  /** `process.env.PATH` 的原文 */
  pathEnv?: string
  /** PATH 的分隔符（`path.delimiter`） */
  delimiter: string
  /** 路径分隔符（`path.sep`） */
  sep: string
  /** `process.platform` */
  platform: string
  /** `process.arch` */
  arch: string
  /** 盘上这个路径是文件、目录，还是不存在 */
  stat(file: string): 'file' | 'dir' | undefined
  /** 解软链后的真实路径；解不了原样回 */
  realpath(file: string): string
  /** `<dir>/package.json` 的 name 是 `pnpm` 时回它的 version，否则 undefined */
  pnpmVersion(dir: string): string | undefined
}

export type LookupResult =
  | { ok: true; launch: PnpmLaunch; version?: string; from: 'setting' | 'path' }
  | { ok: false; error: string }

type Found = { ok: true; launch: PnpmLaunch; version?: string }
type Step = Found | { ok: false; why: string }

/** 拼路径。不用 `node:path` —— 这个模块要在测试里喂假分隔符 */
function join(sep: string, ...parts: readonly string[]): string {
  return parts.join(sep)
}

/** 去掉最后一段 */
function parentOf(file: string, sep: string): string {
  const cut = file.lastIndexOf(sep)
  return cut <= 0 ? file : file.slice(0, cut)
}

function hasExt(file: string, ...exts: readonly string[]): boolean {
  const lower = file.toLowerCase()
  return exts.some((ext) => lower.endsWith(ext))
}

/** 路径落在某个 `node_modules/pnpm` 包里时，回那个包目录 */
export function pnpmPackageOf(file: string, sep: string): string | undefined {
  const marker = `${sep}node_modules${sep}pnpm`
  if (file.endsWith(marker)) return file
  const cut = file.lastIndexOf(`${marker}${sep}`)
  return cut < 0 ? undefined : file.slice(0, cut + marker.length)
}

/** 本机那份原生二进制的包名后缀。linux 两种 libc 各发一个包，npm 只装对得上的那个 */
function nativeTargets(platform: string, arch: string): string[] {
  return platform === 'linux' ? [`linux-${arch}`, `linux-${arch}-musl`] : [`${platform}-${arch}`]
}

/**
 * 一个 pnpm 包目录 → 启动方式。原生二进制的查找位置与 pnpm 包自带的 `native-binary.mjs`
 * 一致：包内 `node_modules/@pnpm/exe.*`，再它所在那层 `node_modules/@pnpm/exe.*`；
 * Windows 上 preinstall 在包根放好的 `pnpm.exe` 排最前。
 */
function fromPackage(pkgDir: string, lookup: Lookup): Step {
  const version = lookup.pnpmVersion(pkgDir)
  if (version === undefined) return { ok: false, why: `${pkgDir} 不是 pnpm 包（没有 name 为 pnpm 的 package.json）` }
  const major = Number.parseInt(version, 10)
  if (Number.isNaN(major)) return { ok: false, why: `${pkgDir} 的版本号 ${JSON.stringify(version)} 认不出大版本` }

  const { sep } = lookup
  if (major >= NATIVE_SINCE_MAJOR) {
    const bin = lookup.platform === 'win32' ? 'pnpm.exe' : 'pnpm'
    const candidates = lookup.platform === 'win32' ? [join(sep, pkgDir, 'pnpm.exe')] : []
    for (const target of nativeTargets(lookup.platform, lookup.arch)) {
      candidates.push(join(sep, pkgDir, 'node_modules', '@pnpm', `exe.${target}`, bin))
      candidates.push(join(sep, parentOf(pkgDir, sep), '@pnpm', `exe.${target}`, bin))
    }
    const hit = candidates.find((file) => lookup.stat(file) === 'file')
    if (hit !== undefined) return { ok: true, launch: { kind: 'native', file: hit }, version }
    return {
      ok: false,
      why: `pnpm ${version} 是原生可执行，可 ${pkgDir} 里没有本机（${lookup.platform}-${lookup.arch}）那份二进制（找过 ${candidates.join('、')}）——装它时可选依赖或构建脚本被跳过了，重装一次`,
    }
  }

  const cjs = join(sep, pkgDir, 'bin', 'pnpm.cjs')
  if (lookup.stat(cjs) === 'file') return { ok: true, launch: { kind: 'script', file: cjs }, version }
  return { ok: false, why: `pnpm ${version} 该带 bin/pnpm.cjs，没找到（${cjs}）` }
}

/**
 * 一个放 pnpm 垫片的目录（npm 全局的 bin 目录）→ 启动方式。
 * Windows 上 npm 全局布局是 `<目录>/node_modules/pnpm`；别的平台垫片是软链，解开它落到的
 * 那个 pnpm 包排前面。
 */
function fromBinDir(dir: string, lookup: Lookup): Step {
  const { sep } = lookup
  const packages: string[] = []
  if (lookup.platform !== 'win32') {
    const shim = join(sep, dir, 'pnpm')
    const pkg = lookup.stat(shim) === 'file' ? pnpmPackageOf(lookup.realpath(shim), sep) : undefined
    if (pkg !== undefined) packages.push(pkg)
  }
  packages.push(join(sep, dir, 'node_modules', 'pnpm'))
  const pkg = packages.find((candidate) => lookup.pnpmVersion(candidate) !== undefined)
  if (pkg !== undefined) return fromPackage(pkg, lookup)
  return { ok: false, why: `${dir} 旁边没有 npm 全局布局的 pnpm 包（找过 ${packages.join('、')}）` }
}

/** 设置项那一路：可执行文件、pnpm.cjs、垫片、垫片目录、pnpm 包目录都认 */
function fromSetting(value: string, lookup: Lookup): Step {
  const { sep } = lookup
  const kind = lookup.stat(value)
  if (kind === undefined) return { ok: false, why: '这个路径不存在' }
  if (kind === 'dir') {
    return lookup.pnpmVersion(value) !== undefined ? fromPackage(value, lookup) : fromBinDir(value, lookup)
  }
  if (hasExt(value, '.cmd', '.ps1')) return fromBinDir(parentOf(value, sep), lookup)
  if (hasExt(value, '.cjs', '.js')) {
    const pkg = pnpmPackageOf(value, sep)
    const version = pkg === undefined ? undefined : lookup.pnpmVersion(pkg)
    const launch: PnpmLaunch = { kind: 'script', file: value }
    return version === undefined ? { ok: true, launch } : { ok: true, launch, version }
  }
  const pkg = pnpmPackageOf(lookup.realpath(value), sep)
  if (pkg !== undefined && lookup.pnpmVersion(pkg) !== undefined) return fromPackage(pkg, lookup)
  if (lookup.platform === 'win32' && !hasExt(value, '.exe')) return fromBinDir(parentOf(value, sep), lookup)
  return { ok: true, launch: { kind: 'native', file: value } }
}

/**
 * PATH 那一路，按 PATH 顺序逐个目录找：Windows 上目录里的 `pnpm.exe` 是原生可执行、直接用；
 * `pnpm.cmd`（别的平台是 `pnpm`）是垫片，从它推 npm 全局布局里的那个 pnpm 包。
 * **推不出来不算完**，继续往后扫；一条都不成就把每一处为什么不成带回去。
 */
function fromPath(lookup: Lookup): { found?: Found; misses: string[] } {
  const misses: string[] = []
  for (const raw of (lookup.pathEnv ?? '').split(lookup.delimiter)) {
    // 有人往 PATH 里写带引号的目录（Windows 上很常见），去掉它
    const dir = raw.replace(/^"|"$/g, '')
    if (dir === '') continue
    if (lookup.platform === 'win32') {
      const exe = join(lookup.sep, dir, 'pnpm.exe')
      if (lookup.stat(exe) === 'file') return { found: { ok: true, launch: { kind: 'native', file: exe } }, misses }
      if (lookup.stat(join(lookup.sep, dir, 'pnpm.cmd')) !== 'file') continue
    } else if (lookup.stat(join(lookup.sep, dir, 'pnpm')) !== 'file') {
      continue
    }
    const step = fromBinDir(dir, lookup)
    if (step.ok) return { found: step, misses }
    misses.push(step.why)
  }
  return { misses }
}

const SETTING_FORMS =
  '能填的：pnpm 可执行文件（pnpm 12 起 npm 包里的 pnpm.exe，非 Windows 是 pnpm）、pnpm 11 的 bin/pnpm.cjs、npm 全局的垫片（pnpm.cmd）或垫片所在的目录、pnpm 包目录本身'

/**
 * 找 pnpm，两路：**设置项优先，PATH 兜底，都不成回一句明确的错。**
 * 填了设置项就不再回退去扫 PATH——填错了要当场看见，不是悄悄用了另一份。
 */
export function findPnpm(lookup: Lookup): LookupResult {
  if (lookup.configured !== undefined && lookup.configured !== '') {
    const step = fromSetting(lookup.configured, lookup)
    if (step.ok) return { ...step, from: 'setting' }
    return { ok: false, error: `设置里的 pnpm-path 是 ${JSON.stringify(lookup.configured)}，照它起不了 pnpm：${step.why}。${SETTING_FORMS}。` }
  }
  const { found, misses } = fromPath(lookup)
  if (found !== undefined) return { ...found, from: 'path' }
  const seen = misses.length === 0 ? '' : `PATH 上的垫片都推不出能用的 pnpm：${misses.join('；')}。`
  return {
    ok: false,
    error:
      `找不到 pnpm。${seen}自动查找认 PATH 上的 pnpm.exe，与 npm 全局装出来的布局（垫片旁边的 node_modules/pnpm，pnpm 11 与 12 都认）；corepack、volta 装的不是这个形状。` +
      `去设置里填 pnpm-path（典型值 %APPDATA%\\npm\\node_modules\\pnpm\\pnpm.exe）。${SETTING_FORMS}。`,
  }
}

/** 一趟 spawn 的三样：跑哪个文件、带什么参数、什么环境 */
export interface SpawnPlan {
  command: string
  args: string[]
  env: Record<string, string | undefined>
}

/**
 * 启动方式 → spawn 参数。
 *
 * - `script`：`process.execPath` 在宿主里是 electron.exe，不带 `ELECTRON_RUN_AS_NODE=1`
 *   它会去开一扇窗而不是跑那个 js
 * - `native`：直接起那个可执行，环境里**去掉** `ELECTRON_RUN_AS_NODE`——它只对 electron 有意义，
 *   留着会漏进 pnpm 起的依赖构建脚本里
 */
export function spawnPlan(
  launch: PnpmLaunch,
  args: readonly string[],
  host: { execPath: string; env: Readonly<Record<string, string | undefined>> },
): SpawnPlan {
  if (launch.kind === 'script') {
    return { command: host.execPath, args: [launch.file, ...args], env: { ...host.env, ELECTRON_RUN_AS_NODE: '1' } }
  }
  const env = { ...host.env }
  delete env['ELECTRON_RUN_AS_NODE']
  return { command: launch.file, args: [...args], env }
}

/** 日志里那一句「用的是哪份 pnpm」 */
export function describePnpm(found: { launch: PnpmLaunch; version?: string; from: 'setting' | 'path' }): string {
  const version = found.version === undefined ? 'pnpm' : `pnpm ${found.version}`
  const how = found.launch.kind === 'native' ? '原生' : 'node 跑脚本'
  const from = found.from === 'setting' ? '设置里填的' : 'PATH 里找到的'
  return `${version}（${how}，${found.launch.file}，${from}）`
}

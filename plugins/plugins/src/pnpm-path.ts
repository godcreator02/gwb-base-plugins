/**
 * pnpm 装在哪——零 I/O 纯逻辑：盘上在不在由调用方给一个 `exists` 判定，于是可测。
 * 真去查盘的那一层在 `pnpm.ts`。
 *
 * **用用户电脑上的 pnpm 包，但用我们自己的 node 运行时**（见 `pnpm.ts`），所以这儿找的
 * 不是可执行文件，是 `pnpm.cjs` 那个脚本。
 */

/** npm 全局装出来的布局：`<bin 目录>/node_modules/pnpm/bin/pnpm.cjs` */
const CJS_TAIL = ['node_modules', 'pnpm', 'bin', 'pnpm.cjs']

/** PATH 里那个垫片叫什么。Windows 上是 `pnpm.cmd`（还有 .ps1，指向同一份） */
const SHIM = { win32: 'pnpm.cmd', other: 'pnpm' }

export interface Lookup {
  /** 设置项 `pnpm-path` 的值。没装设置件、或者没填，就是 undefined */
  configured?: string
  /** `process.env.PATH` 的原文 */
  pathEnv?: string
  /** PATH 的分隔符（`path.delimiter`） */
  delimiter: string
  /** 路径分隔符（`path.sep`） */
  sep: string
  platform: string
  exists(file: string): boolean
}

export type LookupResult = { ok: true; cjs: string; from: 'setting' | 'path' } | { ok: false; error: string }

/** 拼路径。不用 `node:path` —— 这个模块要在测试里喂假分隔符 */
function join(sep: string, ...parts: readonly string[]): string {
  return parts.join(sep)
}

/** 一个目录 → 它底下那份 `pnpm.cjs` 该在哪 */
export function pnpmCjsIn(dir: string, sep: string): string {
  return join(sep, dir, ...CJS_TAIL)
}

/** 去掉最后一段。`node:path` 的 dirname 认死了本机的分隔符，这儿要能喂假的 */
function parentOf(file: string, sep: string): string {
  const cut = file.lastIndexOf(sep)
  return cut <= 0 ? file : file.slice(0, cut)
}

/**
 * 设置项那一路。填什么都尽量认：
 * `pnpm.cjs` 本身、`pnpm.cmd` 那个垫片、或者垫片所在的那个目录。
 */
function fromSetting(configured: string, lookup: Lookup): LookupResult {
  const tried: string[] = []
  const candidates =
    configured.endsWith('.cjs') || configured.endsWith('.js')
      ? [configured]
      : [pnpmCjsIn(configured, lookup.sep), pnpmCjsIn(parentOf(configured, lookup.sep), lookup.sep)]
  for (const candidate of candidates) {
    if (lookup.exists(candidate)) return { ok: true, cjs: candidate, from: 'setting' }
    tried.push(candidate)
  }
  return {
    ok: false,
    error: `设置里的 pnpm-path 是 ${JSON.stringify(configured)}，照它找不到 pnpm.cjs（找过 ${tried.join('、')}）。填 pnpm.cjs 的绝对路径，或者 pnpm.cmd 那个垫片的路径。`,
  }
}

/**
 * PATH 那一路。逐个目录找垫片，找到就从它旁边推 `node_modules/pnpm/bin/pnpm.cjs`。
 *
 * **推不出来不算完**——继续往后扫：corepack / volta 也会往 PATH 里放一个叫 pnpm 的垫片，
 * 但它们的布局不是 npm 全局那种，第一个命中的垫片未必是能用的那份。
 */
function fromPath(lookup: Lookup): string | undefined {
  const shim = lookup.platform === 'win32' ? SHIM.win32 : SHIM.other
  for (const dir of (lookup.pathEnv ?? '').split(lookup.delimiter)) {
    if (dir === '') continue
    // 有人往 PATH 里写带引号的目录（Windows 上很常见），去掉它
    const clean = dir.replace(/^"|"$/g, '')
    if (!lookup.exists(join(lookup.sep, clean, shim))) continue
    const cjs = pnpmCjsIn(clean, lookup.sep)
    if (lookup.exists(cjs)) return cjs
  }
  return undefined
}

/**
 * 找 pnpm.cjs，两路：**设置项优先，PATH 兜底，都不成回一句明确的错。**
 *
 * 第三路（回错）不是偷懒，是有意的收口：corepack / volta / standalone 装出来的布局跟
 * npm 全局那种不一样，穷举所有安装方式是个填不满的坑；填一条设置项五秒钟的事，而
 * **静默失败的代价是「装机按钮点了没反应」**——那种现场最难查。
 */
export function findPnpmCjs(lookup: Lookup): LookupResult {
  if (lookup.configured !== undefined && lookup.configured !== '') {
    return fromSetting(lookup.configured, lookup)
  }
  const found = fromPath(lookup)
  if (found !== undefined) return { ok: true, cjs: found, from: 'path' }
  return {
    ok: false,
    error:
      '找不到 pnpm。自动查找只认 npm 全局装出来的布局（PATH 里的垫片旁边有 node_modules/pnpm/bin/pnpm.cjs）；corepack、volta、standalone 装的都不是这个形状。' +
      '去设置里把 pnpm-path 填成 pnpm.cjs 的绝对路径（典型值 %APPDATA%\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs）。',
  }
}

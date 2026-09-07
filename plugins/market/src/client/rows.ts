import type { CatalogItem } from '../catalog'

/**
 * 市场那一格的纯逻辑：清单筛选、已装状态对账、命令回执收窄、直接装那个输入框的校验。
 * 不碰 DOM，**也不碰网络**——这一格一条网络请求都没有，判据见 `../catalog.ts` 的头注。
 *
 * **不 import 别的件的类型**：`plugins.list` 的那份数据跨 fd3 过来，本来就得当 `unknown`
 * 收窄一次；正本在 `gwb-plugins` 的 `src/inventory.ts`，这儿按形状收（同 `gwb-plugins`
 * 自己那格窗格的 `rows.ts`、logger 的 `entries.ts`）。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 命令回来的那个信封。`ok` / `data` / `error` 三格，`error` 一个字都不许吞 */
export interface CallResult {
  ok: boolean
  data?: unknown
  error?: string
}

export function asResult(value: unknown): CallResult {
  if (!isRecord(value)) return { ok: false, error: `命令回了个认不出的东西：${String(value)}` }
  const error = value['error']
  if (value['ok'] === true) return value['data'] === undefined ? { ok: true } : { ok: true, data: value['data'] }
  // 没成却没给话时也得有句话——空的错误提示跟没提示一样，人看不出发生过什么
  return { ok: false, error: typeof error === 'string' && error !== '' ? error : '命令没成，也没说是为什么' }
}

/** 一个包在 home 里的样子。市场只关心两格：叫什么、装的是哪个范围 */
export interface InstalledView {
  pkg: string
  /** home 那份 package.json 里写的版本范围。手改过 cordis.yml 的场合可能没有 */
  spec?: string
}

/**
 * `plugins.list` 的 data → 「home 里有哪些包」。
 *
 * **只收 `installed === true` 那些。** 那张表还会列出「cordis.yml 里有条目、可包不在
 * home 里」的包，那种在市场这一格里就是**没装**——点「装」正是该做的事。
 *
 * 条目一概不看：市场问的是「这个包在不在 home 里」，挂了几条条目、挂上没有归插件那一格。
 */
export function acceptInstalled(raw: unknown): InstalledView[] {
  if (!Array.isArray(raw)) return []
  const out: InstalledView[] = []
  for (const item of raw as unknown[]) {
    if (!isRecord(item)) continue
    const pkg = item['pkg']
    if (typeof pkg !== 'string' || pkg === '') continue
    if (item['installed'] !== true) continue
    const spec = item['spec']
    out.push(typeof spec === 'string' && spec !== '' ? { pkg, spec } : { pkg })
  }
  return out
}

/** 包名 → 它在 home 里的样子。取不到就是没装（`undefined`），跟「装了但没版本号」分得开 */
export type InstalledIndex = ReadonlyMap<string, InstalledView>

/** 表还没取到时用的那份。**空表不等于「一个都没装」**，界面得靠别的信号分开这两种 */
export const NO_INDEX: InstalledIndex = new Map<string, InstalledView>()

export function installedIndex(views: readonly InstalledView[]): InstalledIndex {
  const map = new Map<string, InstalledView>()
  // 同名后来的盖前面的——那张表本来就该一个包一行，真重了取哪份都一样
  for (const view of views) map.set(view.pkg, view)
  return map
}

/**
 * 这句错话的意思是不是「插件管理件不在」。
 *
 * 两种说法都要认，它们出自不同的两层：
 * - `没有这条命令：plugins.list` —— 命令总线在，可没人注册过这条（`gwb-plugins` 没装）
 * - `没有命令服务（ctx.gwbCommands）…` —— 连命令总线都没装，内核的 dispatch 直接回的
 *
 * 认出来之后市场说一句人话，而不是把这串原文当成一场事故摆在脸上。**原文照样留着显示**，
 * 只是退到次要位置。
 */
export function isMissingPlugins(error: string): boolean {
  return error.includes('没有这条命令') || error.includes('没有命令服务')
}

/** 列表上的一行 */
export interface MarketRow extends CatalogItem {
  /** 这个包在 home 里 */
  installed: boolean
  /** 装的是哪个版本范围。装了才可能有 */
  spec?: string
}

/** 搜索只筛本地这份清单，三个字段一起筛，子串、不区分大小写。**不做正则**：写错的表达式静默匹配不到 */
export function matchesQuery(item: CatalogItem, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return (
    item.title.toLowerCase().includes(needle) ||
    item.pkg.toLowerCase().includes(needle) ||
    item.why.toLowerCase().includes(needle)
  )
}

/** 清单 + 已装的那份 → 要画的那几行。**顺序照清单**，装没装不参与排序 */
export function toRows(catalog: readonly CatalogItem[], index: InstalledIndex, query: string): MarketRow[] {
  const out: MarketRow[] = []
  for (const item of catalog) {
    if (!matchesQuery(item, query)) continue
    const found = index.get(item.pkg)
    if (found === undefined) {
      out.push({ ...item, installed: false })
    } else {
      out.push(found.spec === undefined ? { ...item, installed: true } : { ...item, installed: true, spec: found.spec })
    }
  }
  return out
}

export interface Summary {
  /** 清单一共几条 */
  total: number
  /** 其中已经装了几条。**数的是筛选之前的全量** */
  installed: number
  /** 这次筛出来几行 */
  shown: number
}

export function summarize(
  catalog: readonly CatalogItem[],
  index: InstalledIndex,
  rows: readonly MarketRow[],
): Summary {
  let installed = 0
  for (const item of catalog) if (index.has(item.pkg)) installed += 1
  return { total: catalog.length, installed, shown: rows.length }
}

/**
 * npm 的包名规矩，收得比 npm 严两处：**只认小写**（大写包名在 registry 上本来也是历史
 * 遗留），**首字符不许是 `-`**（那种名字 npm 上不存在，而它正好长得像一个开关）。
 *
 * 跟 `gwb-plugins` 的 `src/ids.ts` 是同一份。这边先拦一道是为了**当场给一句人话**——
 * 那边也会拦，可那时错已经过了一趟命令，回来的是一串给机器看的话。
 */
const PKG_PATTERN = /^(@[a-z0-9~][a-z0-9-._~]*\/)?[a-z0-9~][a-z0-9-._~]*$/

/** 「直接输包名装」那个框的判定结果 */
export type ManualCheck = { ok: true; pkg: string } | { ok: false; error: string }

/**
 * 「直接输包名装」是**兜底**：清单外的、第三方的件走这条。
 *
 * 四道判，每一道都给一句能照着改的话：
 * 1. 空的
 * 2. 带了版本号（`名@1.2.3`）——市场不钉版本，装的一律是最新的
 * 3. 不是个合法包名
 * 4. **已经装了**——大多数件是服务提供方，直接装第二份会抛
 *    `service ... has been registered` 根本挂不上。真要第二条条目走 `plugins.add-entry`
 */
export function checkManual(raw: string, index: InstalledIndex): ManualCheck {
  const pkg = raw.trim()
  if (pkg === '') return { ok: false, error: '先填一个包名，比如 @godcreator02/gwb-hello。' }
  // scope 那个 @ 在 0 位，版本号那个一定在后面
  if (pkg.lastIndexOf('@') > 0) {
    return { ok: false, error: `市场不钉版本，装的一律是最新的。把 ${JSON.stringify(pkg)} 里 @ 后面那段版本号去掉。` }
  }
  if (!PKG_PATTERN.test(pkg)) {
    return {
      ok: false,
      error: `包名 ${JSON.stringify(pkg)} 不合规。要么 \`name\`，要么 \`@scope/name\`，小写字母、数字与 - . _ ~。`,
    }
  }
  if (index.has(pkg)) {
    return {
      ok: false,
      error: `${pkg} 已经在 home 里了，市场不再装一份。要给它多挂一条条目，去插件那一格走 plugins.add-entry——多数件是服务提供方，直接装第二份会挂不上。`,
    }
  }
  return { ok: true, pkg }
}

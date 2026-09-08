/**
 * `plugins.list` 回的那份 → 渲染用的两层行。纯逻辑，不碰 DOM。
 *
 * **不 import node 半的类型**：这份数据跨 IPC 过来，本来就得当 `unknown` 收窄一次；
 * 正本在 `src/inventory.ts`，这儿按形状收（跟 logger 的 `entries.ts` 同一个规矩）。
 *
 * 两层结构不是排版偏好：**一个包能挂多条条目**——`name` 是「装哪个包」，`id` 才是身份，
 * 每条条目各有各的配置、设置和数据。摊平成一行一个包就表达不了这件事。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 一条条目过桥之后的样子。跟 node 半的 `PluginEntryView` 是同一个形状 */
export interface EntryView {
  /** 裸 id。cordis.yml 与日志里出现的是它 */
  id: string
  /** 完整 entryId。每条命令收的都是这一个 */
  entryId: string
  pkg: string
  /** yml 里写了 `disabled: true` */
  disabled: boolean
  /** fiber 真的在跑 */
  active: boolean
  /** `group: true` 的那种条目——它是个分组，不是件 */
  group: boolean
  label?: string
}

/** 一个包过桥之后的样子。跟 node 半的 `PluginPackageView` 是同一个形状 */
export interface PackageView {
  pkg: string
  spec?: string
  installed: boolean
  entries: EntryView[]
}

/**
 * 判形。**认不出的丢掉、不崩**——node 半改了形状而这一格没跟上时，宁可少显示几行，
 * 也不要整格窗格白屏。
 */
function acceptEntry(value: unknown): EntryView | undefined {
  if (!isRecord(value)) return undefined
  const id = value['id']
  if (typeof id !== 'string' || id === '') return undefined
  const entryId = value['entryId']
  const pkg = value['pkg']
  const label = value['label']
  const view: EntryView = {
    id,
    entryId: typeof entryId === 'string' && entryId !== '' ? entryId : id,
    pkg: typeof pkg === 'string' ? pkg : '',
    disabled: value['disabled'] === true,
    active: value['active'] === true,
    group: value['group'] === true,
  }
  return typeof label === 'string' && label !== '' ? { ...view, label } : view
}

/** 一份 `plugins.list` 的 data 收窄成包数组。**顺序照收**——node 半已经按包名排好了 */
export function acceptPackages(raw: unknown): PackageView[] {
  if (!Array.isArray(raw)) return []
  const out: PackageView[] = []
  for (const item of raw as unknown[]) {
    if (!isRecord(item)) continue
    const pkg = item['pkg']
    if (typeof pkg !== 'string') continue
    const entries: EntryView[] = []
    const rawEntries = item['entries']
    if (Array.isArray(rawEntries)) {
      for (const one of rawEntries as unknown[]) {
        const entry = acceptEntry(one)
        if (entry !== undefined) entries.push(entry)
      }
    }
    const spec = item['spec']
    const view: PackageView = { pkg, installed: item['installed'] === true, entries }
    out.push(typeof spec === 'string' ? { ...view, spec } : view)
  }
  return out
}

/**
 * 一条条目此刻的样子。
 *
 * **`active` 与 `disabled` 是两回事，四种组合都得说得出话来**：`disabled` 是「yml 里写了
 * 停用」（人的意愿），`active` 是「fiber 真的在跑」（此刻的事实）。合成一个状态就会把
 * `stalled` 那一档说成「已停用」——而那一档恰恰是最该被看见的。
 */
export type EntryState = 'active' | 'stalled' | 'disabled' | 'disabled-running'

interface StateFace {
  text: string
  hint: string
  /** 这一档要显眼：不是人要它停的，是它自己没起来 */
  attention: boolean
}

const FACES: Record<EntryState, StateFace> = {
  active: { text: '挂上了', hint: 'fiber 在跑', attention: false },
  stalled: {
    text: '没挂上',
    hint: '没被停用，可它的 fiber 没跑起来——多半是 inject 要的服务还没到齐，或者它提供的服务已经被同名的占了。原因在日志里',
    attention: true,
  },
  disabled: { text: '已停用', hint: 'cordis.yml 里写着 disabled: true，本来就不该跑', attention: false },
  'disabled-running': {
    text: '已停用（还在跑）',
    hint: 'yml 里写了停用，可 fiber 还活着。通常是刚停用那一瞬，再取一次表就对上了',
    attention: true,
  },
}

export function stateOf(entry: Pick<EntryView, 'disabled' | 'active'>): EntryState {
  if (entry.disabled) return entry.active ? 'disabled-running' : 'disabled'
  return entry.active ? 'active' : 'stalled'
}

/** 条目那一行 */
export interface EntryRow {
  entryId: string
  /** **id 始终要看得见**：它是身份，日志和 yml 里出现的是它，label 只是给人看的一层皮 */
  id: string
  label?: string
  state: EntryState
  text: string
  hint: string
  attention: boolean
  /** yml 里写了停用没有。启用／停用那颗按钮看这一格，**不看 active** */
  disabled: boolean
}

function toEntryRow(entry: EntryView): EntryRow {
  const state = stateOf(entry)
  const face = FACES[state]
  const row: EntryRow = {
    entryId: entry.entryId,
    id: entry.id,
    state,
    text: face.text,
    hint: face.hint,
    attention: face.attention,
    disabled: entry.disabled,
  }
  return entry.label === undefined ? row : { ...row, label: entry.label }
}

/** 包那一层。卸载是包级动作（`plugins.uninstall`），入口在窗格里，不在这张表的行上 */
export interface PackageRow {
  pkg: string
  /** 表头上显示的名字。条目没写 name 时包名是空串，那时给一句话顶上 */
  title: string
  spec?: string
  /** home 的 dependencies 里有它。false 就是「yml 里有条目，可包不在 home 里」 */
  installed: boolean
  entries: EntryRow[]
  /** 包这一层的一句话，没有就不显示 */
  note?: string
  noteHint?: string
}

export function toRows(views: readonly PackageView[]): PackageRow[] {
  const out: PackageRow[] = []
  for (const view of views) {
    // cordis 的分组条目不是件（`group: true`，连 name 都没有），这一格只管件
    const entries = view.entries.filter((e) => !e.group).map(toEntryRow)
    // 摘掉分组之后什么都不剩、而且连包名都没有的，压根不是一个包——丢掉，
    // 不在界面上留一行空名字
    if (view.pkg === '' && entries.length === 0) continue
    const row: PackageRow = {
      pkg: view.pkg,
      title: view.pkg === '' ? '（条目没写 name）' : view.pkg,
      installed: view.installed,
      entries,
    }
    if (view.spec !== undefined) row.spec = view.spec
    if (entries.length === 0) {
      // **如实说「没有条目」，不说「未启用」**：home 里躺着一批共享包（运行时、令牌表
      // 那些），它们不是件、永远不该有条目，说成「未启用」是冤枉它们
      row.note = '没有条目'
      row.noteHint =
        '这个包在 home 里，但 cordis.yml 里没有引它的条目。共享包（运行时、令牌表这类）本来就该是这样——它们不是件，没有 apply'
    }
    out.push(row)
  }
  return out
}

export interface Summary {
  packages: number
  entries: number
  /** 最该被看见的那几条：没停用也没挂上 */
  attention: number
}

export function summarize(rows: readonly PackageRow[]): Summary {
  let entries = 0
  let attention = 0
  for (const row of rows) {
    entries += row.entries.length
    for (const entry of row.entries) if (entry.attention) attention += 1
  }
  return { packages: rows.length, entries, attention }
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

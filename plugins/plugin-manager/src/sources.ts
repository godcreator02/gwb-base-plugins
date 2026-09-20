/**
 * npmrc 的 scope 路由面：解析、增改、删除的**纯逻辑**。盘上那两份文件（用户级 `~/.npmrc`
 * 与 home 级 `<home>/.npmrc`）的读写归 `index.ts`，这儿只对文本干活——好单测。
 *
 * 认识的只有两种行，其余（注释、空行、`electron_mirror=` 这类别的配置）原样透传：
 *
 * ```
 * @j:registry=https://host/api/packages/J/npm/
 * //host/api/packages/J/npm/:_authToken=shxxx
 * ```
 *
 * **token 行按「源的路径」配对，不按 scope**：同一个 token 可以配好几条源（本机的
 * `@godcreator` 与 `@j` 就是同一个 gitea token 的两行）。所以换源 / 删源时，那条 token
 * 行只有当**没有任何别的 scope 还指着它**才跟着走，否则留下——删别人还在用的凭据是
 * 运行时故障，多留一行没人用的只是占磁盘，跟 uninstall 不追 peer 是同一笔账。
 */

/** 一条 scope 路由（token 只在写盘前短暂持有，回执一律走 `maskToken`） */
export interface SourceEntry {
  scope: string
  registry: string
  token?: string
}

/** `list` 看到的一条：多了出处——pnpm 是两层合并解析的，只看一层是假全景 */
export interface SourceView extends SourceEntry {
  file: 'user' | 'home'
}

/** scope 的形状：`@` 开头，不带 `/`。npm 官方规矩是小写，但 gitea 源上 `@j` 这种大写
 * 实际活得下去，这儿不比 pnpm 更严——拦的是手滑写成包名（`@a/b`）或忘了 `@` */
const SCOPE_RE = /^@[\w.-]+$/

/** 一行 scope 路由：`@scope:registry=<url>` */
const SCOPE_LINE_RE = /^(@[\w.-]+):registry=(\S+)$/

/** 一行凭据：`//<host/path>/:_authToken=<token>`。键里没有协议，配对靠 `registryKeyOf` */
const TOKEN_LINE_RE = /^(\/\/\S+?):_authToken=(\S+)$/

/** 生态的引导 scope：全机 36 个 home 与所有源码仓的装机都指着它，source.* 动不得 */
export const BOOTSTRAP_SCOPE = '@godcreator'

export function isScope(value: unknown): value is string {
  return typeof value === 'string' && SCOPE_RE.test(value)
}

/** 源地址的形状：http(s) 起头、没有空白。不深究更多——源是啥样 pnpm 说了算 */
export function isRegistryUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\/\S+$/.test(value)
}

/**
 * 源地址 → token 行的键。`https://h/p/npm/` 与 `https://h/p/npm`（没斜杠）是同一条源，
 * 键必须归一：剥协议、补尾斜杠。回的是**带 `//` 前缀不带 `:_authToken`** 的那半截，
 * 与 `TOKEN_LINE_RE` 捕获的键同一形状，直接比。
 */
export function registryKeyOf(registry: string): string {
  const bare = registry.replace(/^https?:\/\//, '')
  return `//${bare.endsWith('/') ? bare : `${bare}/`}`
}

/** 回执里可以示人的一行：token 的值换成 `***`。不带长度不带前缀——凭据的一个字节都不出去 */
export function maskLine(line: string): string {
  return line.replace(/(_authToken=)\S+$/, '$1***')
}

interface ScopeLine {
  scope: string
  registry: string
  index: number
}

interface TokenLine {
  key: string
  token: string
  index: number
}

function classify(text: string): { scopes: ScopeLine[]; tokens: TokenLine[] } {
  const scopes: ScopeLine[] = []
  const tokens: TokenLine[] = []
  text.split('\n').forEach((line, index) => {
    const scope = SCOPE_LINE_RE.exec(line)
    if (scope !== null) {
      scopes.push({ scope: scope[1]!, registry: scope[2]!, index })
      return
    }
    const token = TOKEN_LINE_RE.exec(line)
    if (token !== null) tokens.push({ key: token[1]!, token: token[2]!, index })
  })
  return { scopes, tokens }
}

/** 一份 npmrc 文本里的全部 scope 路由。token 按 `registryKeyOf` 配上；配不上就没有 */
export function parseSources(text: string): SourceEntry[] {
  const { scopes, tokens } = classify(text)
  return scopes.map(({ scope, registry }) => ({
    scope,
    registry,
    token: tokens.find((token) => token.key === registryKeyOf(registry))?.token,
  }))
}

/** 几份 npmrc 合着看：逐份解析、带上出处，原顺序排（先用户级后 home 级是调用方的事） */
export function mergeSources(parts: readonly { file: 'user' | 'home'; text: string }[]): SourceView[] {
  return parts.flatMap(({ file, text }) => parseSources(text).map((entry) => ({ ...entry, file })))
}

/** 这些行里还有没有 scope 指着这条源——token 行要不要跟着走，就看它 */
function stillReferenced(lines: readonly string[], registry: string): boolean {
  const key = registryKeyOf(registry)
  return lines.some((line) => {
    const hit = SCOPE_LINE_RE.exec(line)
    return hit !== null && registryKeyOf(hit[2]!) === key
  })
}

/**
 * 写进 / 换掉一条 scope 路由（幂等：已有就原地替换，没有就追加到末尾）。`token` 没给就
 * 只动路由行——公开源不需要凭据，也不该替调用方瞎猜一条。
 *
 * 换源时**旧源的 token 行**若已无别的 scope 引用，一并收走；还有引用就留着（见头注释）。
 * `wrote` 是这次真正落盘的行（含明文 token），给回执展示时调用方必须先过 `maskToken`。
 */
export function upsertSource(text: string, entry: SourceEntry): { text: string; wrote: string[]; replaced: boolean } {
  const hadTrailingNewline = text.endsWith('\n') || text === ''
  const lines = text.split('\n')
  // 文本以换行收尾时 split 出的最后一段是空串——追加要插在它前面，别多出一行空白
  const appendAt = hadTrailingNewline ? lines.length - 1 : lines.length

  const previous = classify(text).scopes.find((hit) => hit.scope === entry.scope)
  const wrote: string[] = [`${entry.scope}:registry=${entry.registry}`]

  if (previous !== undefined) {
    lines[previous.index] = wrote[0]!
  } else {
    lines.splice(appendAt, 0, wrote[0]!)
  }

  if (entry.token !== undefined) {
    const key = registryKeyOf(entry.registry)
    const tokenLine = `${key}:_authToken=${entry.token}`
    const existing = classify(lines.join('\n')).tokens.find((hit) => hit.key === key)
    if (existing !== undefined) {
      lines[existing.index] = tokenLine
    } else {
      lines.splice(appendAt + 1, 0, tokenLine)
    }
    wrote.push(tokenLine)
  }

  // 旧源成了孤儿才收它的 token；append 之后行号变了，按内容删而不是按旧下标
  if (previous !== undefined && registryKeyOf(previous.registry) !== registryKeyOf(entry.registry)) {
    const oldKey = registryKeyOf(previous.registry)
    if (!stillReferenced(lines, previous.registry)) {
      const at = lines.findIndex((line) => TOKEN_LINE_RE.test(line) && TOKEN_LINE_RE.exec(line)![1] === oldKey)
      if (at !== -1) lines.splice(at, 1)
    }
  }

  return { text: lines.join('\n'), wrote, replaced: previous !== undefined }
}

/**
 * 拿掉一条 scope 路由。token 行同样只在成了孤儿时跟着走。没这条 scope 就 `removed: false`，
 * 一个字节都不动——调用方拿这个回执去说「机器级没有这条」的人话。
 */
export function removeSource(text: string, scope: string): { text: string; removed: boolean; registry?: string } {
  const { scopes } = classify(text)
  const hit = scopes.find((candidate) => candidate.scope === scope)
  if (hit === undefined) return { text, removed: false }

  const lines = text.split('\n')
  const registry = hit.registry
  lines.splice(hit.index, 1)
  if (!stillReferenced(lines, registry)) {
    const key = registryKeyOf(registry)
    const at = lines.findIndex((line) => TOKEN_LINE_RE.test(line) && TOKEN_LINE_RE.exec(line)![1] === key)
    if (at !== -1) lines.splice(at, 1)
  }
  return { text: lines.join('\n'), removed: true, registry }
}

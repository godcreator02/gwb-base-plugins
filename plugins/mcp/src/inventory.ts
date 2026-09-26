import { readFileSync } from 'node:fs'

// `index` 与 `search` 两个工具的返回。index 给全部说明书（带完整描述）与命令名，search 给命令的用法

/** 描述正常是一句话；只有超过这个长度才截，防的是写得过长的描述把 index 的返回撑大 */
const DESCRIPTION_CLAMP = 200

/** 超过 200 字才截、拼省略号。不取「第一句」：那会把触发文本砍残 */
export function clampDescription(text: string): string {
  const trimmed = text.trim()
  return trimmed.length <= DESCRIPTION_CLAMP ? trimmed : `${trimmed.slice(0, DESCRIPTION_CLAMP)}…`
}

/** index 返回末尾的提示：下一步去哪查 */
const HINT =
  '命令参数形状与 effect：search {"plugin":"<包名>"} 或 {"prefix":"<前缀>"}；说明书正文：run skill.read {"name":"<名>"}；装了哪些插件问 plugin-manager.list；装卸或升级过插件后重新调 index。'

/** 命令会动到什么，与 `gwb-commands` 的 `GwbCommandEffect` 同一组值 */
export type CommandEffect = 'read' | 'write' | 'external'

export const COMMAND_EFFECTS: readonly CommandEffect[] = ['read', 'write', 'external']

/** 命令那几样。与 `gwb-commands` 的 list() 条目对得上，直接传 */
export interface CommandView {
  name: string
  plugin: string
  description: string
  /** 用法：参数形状与注意事项。没有时当空串 */
  usage?: string
  /** 没标就没有这一项 */
  effect?: CommandEffect
  /** 只给页面调用的命令：index、search 不列，run 拒绝 */
  hiddenFromAgents?: true
}

/** agent 看得到、调得到的命令 */
export function commandsOpenToAgents<T extends CommandView>(commands: readonly T[]): T[] {
  return commands.filter((command) => command.hiddenFromAgents !== true)
}

/** 命令名第一个点之前的部分；没有点就是整个名字 */
function commandPrefix(name: string): string {
  const dot = name.indexOf('.')
  return dot === -1 ? name : name.slice(0, dot)
}

/** instructions.md 之后接的这台 home 的目录：连上就知道有哪些说明书、哪些命令前缀，该找什么时再调 index / search */
export function homeCatalog(input: { home: string; version: string; commands: readonly CommandView[]; skills: readonly SkillView[] }): string {
  const prefixes = [...new Set(commandsOpenToAgents(input.commands).map((command) => commandPrefix(command.name)))]
  return [
    `你连上的是 home「${input.home}」（gwb-mcp ${input.version}）。`,
    `说明书（描述在 index 里，正文 run skill.read）：${input.skills.map((skill) => skill.name).join('、') || '无'}`,
    `命令前缀（用法 search {"prefix":"<前缀>."}）：${prefixes.join('、') || '无'}`,
  ].join('\n')
}

/** Claude Code 超过 2048 字符静默截断 instructions，留一点余量 */
export const INSTRUCTIONS_CHAR_BUDGET = 2_000

/** initialize 返回的 instructions：固定的用法说明接上这台 home 的目录 */
export function buildInstructions(input: { home: string; version: string; commands: readonly CommandView[]; skills: readonly SkillView[] }): string {
  return `${loadInstructions()}\n\n${homeCatalog(input)}`
}

/** 说明书那几样。刻意不带 files：附件路径由 SKILL.md 正文自己提到 */
export interface SkillView {
  name: string
  description: string
  plugin: string
}

/** 本插件从说明书服务要的那一个方法。说明书插件不在时整个是 undefined，入口照开 */
export interface SkillsSlot {
  list(): SkillView[]
}

/** 包根的 instructions.md，模块加载时读一次。dist/ 与 src/ 往上一级都是包根 */
const INSTRUCTIONS: string = readFileSync(new URL('../instructions.md', import.meta.url), 'utf8').trimEnd()

/** initialize 与 index 都用它 */
export function loadInstructions(): string {
  return INSTRUCTIONS
}

/** `index` 的返回 */
export interface IndexDoc {
  /** home 名：读的人拿它核对自己连上的是哪一个 */
  home: string
  /** 本插件的版本号 */
  version: string
  /** instructions.md 全文。不把 initialize 里的 instructions 交给模型的客户端，靠这一份拿到 */
  instructions: string
  /** 说明书清单：名字、插件、完整 description（超长才截）；正文经 run skill.read 取 */
  skills: Array<{ name: string; plugin: string; description: string }>
  /** 命令按插件分组、只报名字，参数形状在 search。顺序是命令表里首次出现的顺序 */
  commands: Array<{ plugin: string; names: string[] }>
  hint: string
}

function commandNamesByPlugin(commands: readonly CommandView[]): Array<{ plugin: string; names: string[] }> {
  const namesByPlugin = new Map<string, string[]>()
  for (const command of commands) {
    const names = namesByPlugin.get(command.plugin)
    if (names === undefined) namesByPlugin.set(command.plugin, [command.name])
    else names.push(command.name)
  }
  return [...namesByPlugin].map(([plugin, names]) => ({ plugin, names }))
}

/** 生成 index 的返回。commands 与 skills 由调用方每次调用时取 */
export function buildIndex(input: {
  home: string
  version: string
  commands: readonly CommandView[]
  skills?: readonly SkillView[]
}): IndexDoc {
  return {
    home: input.home,
    version: input.version,
    instructions: loadInstructions(),
    skills: (input.skills ?? []).map((s) => ({ name: s.name, plugin: s.plugin, description: clampDescription(s.description) })),
    commands: commandNamesByPlugin(commandsOpenToAgents(input.commands)),
    hint: HINT,
  }
}

/** `search` 的筛选条件 */
export interface SearchQuery {
  /** 精确插件名（包名），命令与说明书一起筛 */
  plugin?: string
  /** 命令名前缀，如 "skill."；只给它时说明书只回名字与插件 */
  prefix?: string
  /** 在名字、一句话介绍或用法里找子串，不分大小写 */
  q?: string
  /** 只要标了这一种 effect 的命令；没标的不算。对说明书不适用，给了它就不回说明书 */
  effect?: CommandEffect
}

/** `search` 返回的一条命令：`effect` 没标就没有这一项 */
export interface SearchCommandRow {
  name: string
  plugin: string
  description: string
  usage: string
  effect?: CommandEffect
}

/** `search` 的返回：命中的命令总带 usage；filter 写明这次按什么筛的 */
export interface SearchDoc {
  filter?: SearchQuery
  commands: SearchCommandRow[]
  /** 只给 prefix 时没有 description */
  skills: Array<{ name: string; plugin: string; description?: string }>
}

function containsIgnoringCase(text: string, lowerCaseNeedle: string): boolean {
  return text.toLowerCase().includes(lowerCaseNeedle)
}

/** 给了的条件全部要满足；q 连 usage 一起找 */
function commandMatches(command: CommandView, query: SearchQuery): boolean {
  if (query.plugin !== undefined && command.plugin !== query.plugin) return false
  if (query.prefix !== undefined && !command.name.startsWith(query.prefix)) return false
  if (query.effect !== undefined && command.effect !== query.effect) return false
  if (query.q !== undefined) {
    const needle = query.q.toLowerCase()
    const usage = command.usage ?? ''
    if (!containsIgnoringCase(command.name, needle) && !containsIgnoringCase(command.description, needle) && !containsIgnoringCase(usage, needle)) {
      return false
    }
  }
  return true
}

/** 说明书只按 plugin 与 q 筛，prefix 对它不适用；effect 是命令才有的，给了就一份说明书都不回 */
function skillMatches(skill: SkillView, query: SearchQuery): boolean {
  if (query.effect !== undefined) return false
  if (query.plugin !== undefined && skill.plugin !== query.plugin) return false
  if (query.q !== undefined) {
    const needle = query.q.toLowerCase()
    if (!containsIgnoringCase(skill.name, needle) && !containsIgnoringCase(skill.description, needle)) return false
  }
  return true
}

function searchRowOf(command: CommandView): SearchCommandRow {
  const row: SearchCommandRow = { name: command.name, plugin: command.plugin, description: command.description, usage: command.usage ?? '' }
  if (command.effect !== undefined) row.effect = command.effect
  return row
}

/** 生成 search 的返回 */
export function buildSearch(input: {
  commands: readonly CommandView[]
  skills?: readonly SkillView[]
  query?: SearchQuery
}): SearchDoc {
  const query = input.query ?? {}
  const hasFilter = query.plugin !== undefined || query.prefix !== undefined || query.q !== undefined || query.effect !== undefined
  const commands = commandsOpenToAgents(input.commands).filter((command) => commandMatches(command, query))
  // 只给 prefix 时说明书没被任何条件筛过，只回名字与插件，不把整张表带上
  const onlyPrefixGiven = query.prefix !== undefined && query.plugin === undefined && query.q === undefined
  const skills = (input.skills ?? []).filter((skill) => skillMatches(skill, query))
  const doc: SearchDoc = {
    commands: commands.map(searchRowOf),
    skills: onlyPrefixGiven
      ? skills.map((s) => ({ name: s.name, plugin: s.plugin }))
      : skills.map((s) => ({ name: s.name, plugin: s.plugin, description: s.description })),
  }
  if (hasFilter) doc.filter = query
  return doc
}

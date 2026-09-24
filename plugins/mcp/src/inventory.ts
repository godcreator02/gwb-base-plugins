import { readFileSync } from 'node:fs'

// `index` 与 `search` 两个工具的返回。index 是地图（说明书带完整描述、命令只报名字），search 给命令的用法

/** 描述正常是一句话；只有超过这个长度才截，防的是失控的长文把地图撑爆 */
const DESCRIPTION_CLAMP = 200

/** 超过 200 字才截、拼省略号。不取「第一句」：那会把触发文本砍残 */
export function clampDescription(text: string): string {
  const trimmed = text.trim()
  return trimmed.length <= DESCRIPTION_CLAMP ? trimmed : `${trimmed.slice(0, DESCRIPTION_CLAMP)}…`
}

/** 地图末尾的提示：下一步去哪查 */
const HINT =
  '命令参数形状：search {"plugin":"<包名>"} 或 {"prefix":"<前缀>"}；说明书正文：run skill.read {"name":"<名>"}；装了什么件问 plugin-manager.list；动过插件后重调 index 刷新。'

/** 命令那几样。与 `gwb-commands` 的 list() 条目对得上，直接传 */
export interface CommandView {
  name: string
  plugin: string
  description: string
  /** 用法：参数形状与注意事项。没有时当空串 */
  usage?: string
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

/** 现拼一份地图。commands 与 skills 由调用方现取 */
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
    commands: commandNamesByPlugin(input.commands),
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
}

/** `search` 的返回：命中的命令总带 usage；filter 写明这次按什么筛的 */
export interface SearchDoc {
  filter?: SearchQuery
  commands: Array<{ name: string; plugin: string; description: string; usage: string }>
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
  if (query.q !== undefined) {
    const needle = query.q.toLowerCase()
    const usage = command.usage ?? ''
    if (!containsIgnoringCase(command.name, needle) && !containsIgnoringCase(command.description, needle) && !containsIgnoringCase(usage, needle)) {
      return false
    }
  }
  return true
}

/** 说明书只按 plugin 与 q 筛，prefix 对它不适用 */
function skillMatches(skill: SkillView, query: SearchQuery): boolean {
  if (query.plugin !== undefined && skill.plugin !== query.plugin) return false
  if (query.q !== undefined) {
    const needle = query.q.toLowerCase()
    if (!containsIgnoringCase(skill.name, needle) && !containsIgnoringCase(skill.description, needle)) return false
  }
  return true
}

/** 现拼一份检索结果 */
export function buildSearch(input: {
  commands: readonly CommandView[]
  skills?: readonly SkillView[]
  query?: SearchQuery
}): SearchDoc {
  const query = input.query ?? {}
  const hasFilter = query.plugin !== undefined || query.prefix !== undefined || query.q !== undefined
  const commands = input.commands.filter((command) => commandMatches(command, query))
  // 只给 prefix 时说明书没被任何条件筛过，只回名字与插件，不把整张表带上
  const onlyPrefixGiven = query.prefix !== undefined && query.plugin === undefined && query.q === undefined
  const skills = (input.skills ?? []).filter((skill) => skillMatches(skill, query))
  const doc: SearchDoc = {
    commands: commands.map((c) => ({ name: c.name, plugin: c.plugin, description: c.description, usage: c.usage ?? '' })),
    skills: onlyPrefixGiven
      ? skills.map((s) => ({ name: s.name, plugin: s.plugin }))
      : skills.map((s) => ({ name: s.name, plugin: s.plugin, description: s.description })),
  }
  if (hasFilter) doc.filter = query
  return doc
}

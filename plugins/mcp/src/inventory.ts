import { readFileSync } from 'node:fs'

/**
 * `index` 与 `search` 两枚工具的回执。纯函数，从接线里抽出来以便测试。
 *
 * 渐进式的正身是**索引 → 按址取件**，搜索只是不知道地址时的兜底：
 *
 * - `index`（裸调，无参数）是**地图**：全部命令（名字+插件+一句话）与全部说明书（名字+
 *   插件+一句话），完整而极小，约两千 token——description 与 skill 的 description 同义，
 *   是导航触发文本，不是参数文档
 * - `search` 的命中行**恒带 usage**（参数形状与行为注意，commands 0.4 起与 description
 *   分家）；裸调＝不过滤＝全貌全用法（约八千 token，陌生 home 深度进场一次）
 * - 任何一级查询都不把另一张全表捎上：prefix 是命令域意图，此时说明书表只回瘦身行
 *
 * instructions 是一份真的 markdown——包根 `instructions.md`，模块加载时读一次。
 * 只搬了形状、没搬 skills 件的类型——本地收窄声明，不欠 skills 件一个依赖。
 */

/** 命令那几样。与 `gwb-commands` 的注册表条目对得上，直接传就行 */
export interface CommandView {
  name: string
  plugin: string
  description: string
  /** 用法：参数形状与行为注意。老版注册表（commands <0.4）没有这格，当空串 */
  usage?: string
}

/** skill 那几样。files 刻意不投影——附件的目录归 SKILL.md 正文自己管 */
export interface SkillView {
  name: string
  description: string
  plugin: string
}

/** 本件从 skills 件那儿要的那一格。skills 件不在时这格整个是 undefined，门照开 */
export interface SkillsSlot {
  list(): SkillView[]
}

/**
 * 包根那份口上的纪律，模块加载时读一次——部署期就定死的文字，不值得每请求重读。
 * dist/ 与 src/（vitest）两种运行位向上跳一级都是包根，指到的是同一份。
 */
const INSTRUCTIONS: string = readFileSync(new URL('../instructions.md', import.meta.url), 'utf8').trimEnd()

/** initialize 与 index 都用它——前者是协议正身，后者是「客户端不透出 initialize」的保险 */
export function loadInstructions(): string {
  return INSTRUCTIONS
}

/** `index` 的应答：完整地图，两表同形 */
export interface IndexDoc {
  /** 自报的 home 名——读的人拿它核对「你连上的实际是哪个」，别只信 runtime.json 那份记录 */
  home: string
  /** 本件自己的版本号 */
  version: string
  /** 口上的纪律（怎么干活、哪些改动不问、哪些先问） */
  instructions: string
  commands: Array<{ name: string; plugin: string; description: string }>
  skills: Array<{ name: string; plugin: string; description: string }>
}

/** 现拼一份地图。commands 与 skills 都是调用方现取的，这里只组装 */
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
    commands: input.commands.map((c) => ({ name: c.name, plugin: c.plugin, description: c.description })),
    skills: (input.skills ?? []).map((s) => ({ name: s.name, plugin: s.plugin, description: s.description })),
  }
}

/** `search` 的过滤参数 */
export interface SearchQuery {
  /** 精确插件名（包名），命令与说明书一起筛 */
  plugin?: string
  /** 命令名前缀，如 "skill."——命令域意图：说明书表只回瘦身行 */
  prefix?: string
  /** 名字、一句话或用法里找子串，不分大小写 */
  q?: string
}

/** `search` 的应答：命中行恒带 usage；filter 自证本次筛了什么 */
export interface SearchDoc {
  filter?: SearchQuery
  commands: Array<{ name: string; plugin: string; description: string; usage: string }>
  /** prefix 单独生效时是瘦身行——那格查询的意图在命令，说明书不该捎全表 */
  skills: Array<{ name: string; plugin: string; description?: string }>
}

/** 一条命令过不过筛：给了的条件全部 AND；q 连 usage 一起搜——概念常住在用法里 */
function keepCommand(command: CommandView, query: SearchQuery): boolean {
  if (query.plugin !== undefined && command.plugin !== query.plugin) return false
  if (query.prefix !== undefined && !command.name.startsWith(query.prefix)) return false
  if (query.q !== undefined) {
    const needle = query.q.toLowerCase()
    const usage = command.usage ?? ''
    if (
      !command.name.toLowerCase().includes(needle) &&
      !command.description.toLowerCase().includes(needle) &&
      !usage.toLowerCase().includes(needle)
    ) {
      return false
    }
  }
  return true
}

/** 一份 skill 过不过筛：plugin 与 q 两样适用，prefix 对 skill 没有意义 */
function keepSkill(skill: SkillView, query: SearchQuery): boolean {
  if (query.plugin !== undefined && skill.plugin !== query.plugin) return false
  if (query.q !== undefined) {
    const needle = query.q.toLowerCase()
    if (!skill.name.toLowerCase().includes(needle) && !skill.description.toLowerCase().includes(needle)) return false
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
  const commands = input.commands.filter((c) => keepCommand(c, query))
  // prefix 是命令域意图：它单独生效时说明书没被任何条件筛过，回瘦身行——不把全表捎上
  const skillsOnlyPrefix = query.prefix !== undefined && query.plugin === undefined && query.q === undefined
  const skills = (input.skills ?? []).filter((s) => keepSkill(s, query))
  const doc: SearchDoc = {
    commands: commands.map((c) => ({ name: c.name, plugin: c.plugin, description: c.description, usage: c.usage ?? '' })),
    skills: skillsOnlyPrefix
      ? skills.map((s) => ({ name: s.name, plugin: s.plugin }))
      : skills.map((s) => ({ name: s.name, plugin: s.plugin, description: s.description })),
  }
  if (hasFilter) doc.filter = query
  return doc
}

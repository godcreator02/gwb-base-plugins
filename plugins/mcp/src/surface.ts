import { readFileSync } from 'node:fs'

/**
 * `surface` 那枚工具回的那一格。纯函数，从接线里抽出来以便测试。
 *
 * 这条回执是 agent 的**发现面**：连上先调一次，命令面、说明书清单、口上的纪律
 * （instructions）都以它为准。它是**现拼的**，不是快照——热挂上来的件下一次调用就在。
 * 形状与 command-http 时代的 `GET /surface` 一致（0.4 复位时抬过来，`top` 格随门面封顶
 * 退役）：两代门一个词汇，改口的文档只动「怎么调」，不动「回什么」。
 *
 * 全量回执此刻约八千 token 且随件数线性涨，于是有过滤（`SurfaceQuery`）：`plugin` 按登记
 * 件筛、`prefix` 按命令名前缀筛、`q` 在名字与描述里找子串（不分大小写）、`slim` 只回
 * 名字+插件的索引行。生效的过滤在回执 `filter` 那格自证。
 *
 * instructions 是一份真的 markdown——包根 `instructions.md`，模块加载时读一次。
 * 只搬了形状、没搬 skills 件的类型——本地收窄声明，不欠 skills 件一个依赖。
 */

/** 这道门要报的命令那几样。与 `gwb-commands` 的注册表条目对得上，直接传就行 */
export interface CommandView {
  name: string
  plugin: string
  description: string
}

/** skill 那几样。与 `gwb-skills` 的 `GwbSkill` 结构对得上，直接传就行 */
export interface SkillView {
  name: string
  description: string
  plugin: string
  /** 主文件在前：`SKILL.md` 加可选附件 */
  files: string[]
}

/** 本件从 skills 件那儿要的那一格。skills 件不在时这格整个是 undefined，门照开 */
export interface SkillsSlot {
  list(): SkillView[]
}

/** `slim` 时的索引行：只有名字与插件，不带描述——建索引用 */
export interface SlimEntry {
  name: string
  plugin: string
}

/** `surface` 的过滤参数 */
export interface SurfaceQuery {
  /** 只留这个插件登记的（commands 与 skills 一起筛） */
  plugin?: string
  /** 命令名前缀，如 "skill." */
  prefix?: string
  /** 名字或描述里含这个子串，不分大小写 */
  q?: string
  /** 瘦身：commands 与 skills 只回索引行 */
  slim?: boolean
}

/**
 * 包根那份口上的纪律，模块加载时读一次——部署期就定死的文字，不值得每请求重读。
 * dist/ 与 src/（vitest）两种运行位向上跳一级都是包根，指到的是同一份。
 */
const INSTRUCTIONS: string = readFileSync(new URL('../instructions.md', import.meta.url), 'utf8').trimEnd()

/** instructions 原样带出，**不随挂着的 skill 变**——initialize 与 surface 都用它 */
export function loadInstructions(): string {
  return INSTRUCTIONS
}

/** `surface` 的应答形状 */
export interface Surface {
  /** 自报的 home 名——读的人拿它核对「你连上的实际是哪个」，别只信 runtime.json 那份记录 */
  home: string
  /** 本件自己的版本号 */
  version: string
  /** 口上的纪律（怎么干活、哪些改动不问、哪些先问） */
  instructions: string
  /** 本次生效的过滤条件；一条都没给时没有这格 */
  filter?: SurfaceQuery
  commands: Array<CommandView | SlimEntry>
  skills: Array<SkillView | SlimEntry>
}

/** 一条命令过不过筛：给了的条件全部 AND */
function keepCommand(command: CommandView, query: SurfaceQuery): boolean {
  if (query.plugin !== undefined && command.plugin !== query.plugin) return false
  if (query.prefix !== undefined && !command.name.startsWith(query.prefix)) return false
  if (query.q !== undefined) {
    const needle = query.q.toLowerCase()
    if (!command.name.toLowerCase().includes(needle) && !command.description.toLowerCase().includes(needle)) return false
  }
  return true
}

/** 一份 skill 过不过筛：plugin 与 q 两样适用，prefix 对 skill 没有意义 */
function keepSkill(skill: SkillView, query: SurfaceQuery): boolean {
  if (query.plugin !== undefined && skill.plugin !== query.plugin) return false
  if (query.q !== undefined) {
    const needle = query.q.toLowerCase()
    if (!skill.name.toLowerCase().includes(needle) && !skill.description.toLowerCase().includes(needle)) return false
  }
  return true
}

const slimCommand = (c: CommandView): SlimEntry => ({ name: c.name, plugin: c.plugin })
const slimSkill = (s: SkillView): SlimEntry => ({ name: s.name, plugin: s.plugin })

/** 现拼一份表面。commands 与 skills 都是调用方现取的，这里只筛、裁、组装 */
export function buildSurface(input: {
  home: string
  version: string
  commands: readonly CommandView[]
  skills?: readonly SkillView[]
  query?: SurfaceQuery
}): Surface {
  const query = input.query ?? {}
  const hasFilter =
    query.plugin !== undefined || query.prefix !== undefined || query.q !== undefined || query.slim !== undefined
  const commands = input.commands.filter((c) => keepCommand(c, query))
  const skills = (input.skills ?? []).filter((s) => keepSkill(s, query))
  const surface: Surface = {
    home: input.home,
    version: input.version,
    instructions: loadInstructions(),
    commands: query.slim === true ? commands.map(slimCommand) : [...commands],
    skills: query.slim === true ? skills.map(slimSkill) : [...skills],
  }
  if (hasFilter) surface.filter = query
  return surface
}

import { readFileSync } from 'node:fs'

/**
 * `GET /surface` 那一格的内容。纯函数，从接线里抽出来以便测试。
 *
 * 这条回执是 agent 的**发现面**：连上先 GET 一次，命令面、说明书清单、门上的纪律
 * （instructions）都以它为准。它是**现拼的**，不是快照——热挂上来的件下一次 GET 就在。
 *
 * instructions 是一份真的 markdown——包根 `instructions.md`，模块加载时读一次：
 * 能当 markdown 写、预览、格式化，而不是源码里一串引号（跟 mcp 件那份同待遇）。
 * 只搬了形状、没搬 skills 件的类型——本地收窄声明，不欠 skills 件一个依赖。
 */

/** 这道口要报的命令那几样。与 `gwb-commands` 的注册表条目对得上，直接传就行 */
export interface CommandView {
  name: string
  plugin: string
  description: string
  /** 登记时标了 `top: true` 的——门面位概念，这道门只是如实带出 */
  top: boolean
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

/**
 * 包根那份门上的纪律，模块加载时读一次——部署期就定死的文字，不值得每请求重读。
 * dist/ 与 src/（vitest）两种运行位向上跳一级都是包根，指到的是同一份。
 */
const INSTRUCTIONS: string = readFileSync(new URL('../instructions.md', import.meta.url), 'utf8').trimEnd()

/** instructions 原样带出，**不随挂着的 skill 变**——它是每个 agent 第一份 GET 都带的固定成本 */
export function loadInstructions(): string {
  return INSTRUCTIONS
}

/** `/surface` 的应答形状 */
export interface Surface {
  /** 自报的 home 名——读的人拿它核对「你连上的实际是哪个」，别只信 runtime.json 那份记录 */
  home: string
  /** 本件自己的版本号 */
  version: string
  /** 门上的纪律（怎么干活、哪些改动不问、哪些先问） */
  instructions: string
  commands: CommandView[]
  skills: SkillView[]
}

/** 现拼一份表面。commands 与 skills 都是调用方现取的，这里只组装 */
export function buildSurface(input: {
  home: string
  version: string
  commands: readonly CommandView[]
  skills?: readonly SkillView[]
}): Surface {
  return {
    home: input.home,
    version: input.version,
    instructions: loadInstructions(),
    commands: [...input.commands],
    skills: [...(input.skills ?? [])],
  }
}

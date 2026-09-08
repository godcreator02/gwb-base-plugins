import { readFileSync } from 'node:fs'

/**
 * skill 那一面在 MCP 上的表达，从端点实现里抽出以便测试。
 *
 * **MCP 协议里没有 skill 这个原语**，客户端也不会把 MCP 来的东西自动挂成 skill
 * （那是文件系统上 `.claude/skills/` 的待遇）。能用的只有两格：
 *
 * - `instructions`：initialize 时白送进 agent 上下文的那段，**唯一的发现面**。
 *   客户端不会自己去 `resources/list`——不在这段里点名的 skill，等于不存在
 * - `resources`：正文的载体，agent 照 instructions 给的 URI 来读
 *
 * 所以动态那半的分寸是：**每份 skill 一行，说清什么时候该读它**，正文一个字不放。
 * 它是每个连上来的 agent 都要吃的固定成本，skill 一多就变成一页废话。
 *
 * 固定那半（工作台自我说明）是一份真的 markdown——包根 `instructions.md`，模块加载时
 * 读一次：能当 markdown 写、预览、格式化，而不是源码里一串引号（跟内核仓 home-readme
 * 的待遇一个理）。动态那半（此刻挂着的 skill 清单）才归这份 .ts 拼。
 *
 * 只搬了形状、没搬旧线的实现：旧仓那份依赖 `@godcreator02/gwb-platform` 的类型，
 * 这儿按本仓的依赖纪律**本地收窄声明**——mcp 只消费 list/read，不欠 skills 件一个依赖。
 */

/** mcp 用得着的 skill 那几样。与 `gwb-skills` 的 `GwbSkill` 结构对得上，直接传就行 */
export interface SkillView {
  name: string
  description: string
  plugin: string
  /** 主文件在前：`SKILL.md` 加可选附件 */
  files: string[]
}

/** mcp 从 skills 件那儿要的两格。skills 件不在时这格整个是 undefined，桥照开 */
export interface SkillsSlot {
  list(): SkillView[]
  read(name: string, file?: string): Promise<string | undefined>
}

/** URI 里代表本工作台的那一段（照 Agent Skills 生态的 `skill://<来源>/…` 惯例） */
const SCHEME_HOST = 'skill://gwb'

/** 主文件的名字。collect 那头也认这个，两处对得上 */
const ENTRY = 'SKILL.md'

/**
 * 包根那份说明，模块加载时读一次——部署期就定死的文字，不值得每请求重读。
 * dist/ 与 src/（vitest）两种运行位向上跳一级都是包根，指到的是同一份。
 */
const INSTRUCTIONS_BASE: string = readFileSync(new URL('../instructions.md', import.meta.url), 'utf8').trimEnd()

/** 工作台自我说明的固定那半：包根 instructions.md 原样 */
export function baseInstructions(): string {
  return INSTRUCTIONS_BASE
}

/**
 * 拼 server instructions。
 *
 * 没有 skill 时只有固定那半——**不留一句「本台支持 skill」的空话**：agent 读了
 * 也无处可去，只是白占上下文。
 */
export function buildInstructions(skills: readonly SkillView[]): string {
  if (skills.length === 0) return INSTRUCTIONS_BASE
  const lines = [
    INSTRUCTIONS_BASE,
    '',
    `这个 home 的插件带了 ${skills.length} 份说明书（skill），讲的是多步流程、调用顺序与踩过的坑。`,
    '下面哪一条对得上手头的活，**动手前先把它的 URI 读出来**（resources/read）：',
    '',
  ]
  for (const skill of skills) {
    lines.push(`- ${skill.name}（${skill.plugin} 件）：${skill.description === '' ? '（这一份没写描述）' : skill.description}`)
    lines.push(`  ${skillUri(skill.name, ENTRY)}`)
  }
  return lines.join('\n')
}

/** 一条要挂到 MCP 上的 resource */
export interface SkillResource {
  /** MCP resource 的 name */
  name: string
  uri: string
  title: string
  description: string
  mimeType: string
  /** 回读时拿它去 `skills.read` */
  source: { skill: string; file: string }
}

/**
 * 把 skill 表摊成 resource 条目：主文件一条，附件各一条。
 *
 * 附件的描述里写死「先读 SKILL.md」——附件是渐进披露的第二层，单独读一份
 * `references/gotchas.md` 而没有主文件的上下文，读了也用不对。
 */
export function skillResources(skills: readonly SkillView[]): SkillResource[] {
  const out: SkillResource[] = []
  for (const skill of skills) {
    for (const file of skill.files) {
      const main = file === ENTRY
      out.push({
        name: main ? skill.name : `${skill.name}/${file}`,
        uri: skillUri(skill.name, file),
        title: main ? `Skill: ${skill.name}` : `${skill.name} 附件：${file}`,
        description: main
          ? skill.description
          : `${skill.name} 的附件。用它之前必须先读 ${skillUri(skill.name, ENTRY)}。`,
        mimeType: mimeTypeOf(file),
        source: { skill: skill.name, file },
      })
    }
  }
  return out
}

/** 按扩展名给 mimeType；认不出的当纯文本 */
export function mimeTypeOf(file: string): string {
  const dot = file.lastIndexOf('.')
  const ext = dot === -1 ? '' : file.slice(dot).toLowerCase()
  if (ext === '.md') return 'text/markdown'
  if (ext === '.json') return 'application/json'
  if (ext === '.yml' || ext === '.yaml') return 'application/yaml'
  return 'text/plain'
}

/** 一份 skill 里某个文件的 URI */
export function skillUri(skillName: string, file: string): string {
  return `${SCHEME_HOST}/${skillName}/${file}`
}

import { readFileSync } from 'node:fs'

/**
 * skill 那一面在 MCP 上的表达，从端点实现里抽出以便测试。
 *
 * **MCP 协议里没有 skill 这个原语**，客户端也不会把 MCP 来的东西自动挂成 skill
 * （那是文件系统上 `.claude/skills/` 的待遇）。能用的只有三格：
 *
 * - **顶层工具 `skill_list` / `skill_read`**：skills 件登记时标了 `top`，桥渲染成顶层。
 *   说明书的发现面就是 `skill_list` 的回执——它是现取的，不是连接时的快照
 * - `resources`：正文的另一个载体，`skill://gwb/<名>/<文件>`，agent 照名字来读
 * - `instructions`：initialize 时白送进 agent 上下文的那段，**固定文本**——只说
 *   「先调 skill_list」，不再列清单。清单曾经列在这儿，实测会被客户端截断（十三份列到
 *   第八份就断），而且它是每会话的固定成本，skill 一多就是一页废话
 *
 * 固定那半是一份真的 markdown——包根 `instructions.md`，模块加载时读一次：能当 markdown
 * 写、预览、格式化，而不是源码里一串引号（跟内核仓 home-readme 的待遇一个理）。
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
const INSTRUCTIONS: string = readFileSync(new URL('../instructions.md', import.meta.url), 'utf8').trimEnd()

/**
 * server instructions：包根 `instructions.md` 原样，**不随挂着的 skill 变**。
 * 每个 agent 连上来都要读这段，所以按「少一句就漏事、多一句就是废话」裁，二十行内。
 */
export function baseInstructions(): string {
  return INSTRUCTIONS
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

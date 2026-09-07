import fs from 'node:fs'
import path from 'node:path'

/**
 * skill 目录的扫描与 frontmatter 解析。**不碰 ctx、不打日志**——扫出来的问题攒进
 * `problems` 交给调用方去说，于是这一份是纯逻辑、可以单测。
 *
 * 一个 skill 是一个目录：必有 `SKILL.md`，可带 `references/` 之类的附件。形状照
 * Anthropic Agent Skills 那套，同一份文件两边通用。
 */

/** 收得下的扩展名：agent 读的是文本，二进制读出来只会是乱码 */
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yml', '.yaml'])

/** 单文件上限 512KB——比这还大的一份，agent 读一遍就吃掉整个上下文 */
const MAX_FILE_BYTES = 512 * 1024

/** 一个 skill 目录往下最多再走三层、最多收 64 份：防手滑把一整棵树挂进来 */
const MAX_DEPTH = 3
const MAX_FILES = 64

/** 主文件名。它不在就不算一个 skill（目录名对得上也不算） */
export const SKILL_ENTRY = 'SKILL.md'

/** 一份 skill 的自述。这份是要交出去的，所以**不带本机路径** */
export interface GwbSkill {
  /** skill 名：目录名；frontmatter 写了 `name` 就以它为准 */
  name: string
  /** frontmatter 的 `description`。agent 靠它决定要不要读正文，不是简介 */
  description: string
  /** 挂它的那个件（完整包名） */
  plugin: string
  /** 目录下的文件清单（相对路径，POSIX 分隔符）。`SKILL.md` 恒在第一位 */
  files: string[]
}

/** 扫描途中值得说一句的事 */
export interface CollectProblem {
  /** 相对扫描根的路径，指得到具体是哪一份 */
  where: string
  message: string
}

export interface CollectedSkill {
  skill: GwbSkill
  /** skill 目录的绝对路径。**不进 GwbSkill**：那份要交出去，别捎带本机路径 */
  dir: string
}

export interface CollectResult {
  skills: CollectedSkill[]
  problems: CollectProblem[]
}

/**
 * 取 markdown 的 YAML frontmatter 头（首行 `---` 到下一行 `---` 之间）。
 *
 * **只认单行 `key: value`**，值可带成对的单/双引号。够用的理由：SKILL.md 的
 * frontmatter 惯例就只有 `name` 与 `description` 两个标量。折叠块（`>-`、`|`）与嵌套
 * 一律取不到值，调用方会为此报一句——静默当成空的话，作者要到 agent 死活不读这份
 * skill 时才发现描述丢了。
 *
 * 值里的冒号照收（`description: Skill: 干嘛的` 取到 `Skill: 干嘛的`）：只在第一个冒号切一刀。
 */
export function parseFrontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  // 允许文件以 BOM 起头
  const body = text.replace(/^﻿/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body)
  if (match === null) return out
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    if (key === '' || /\s/.test(key)) continue
    let value = line.slice(colon + 1).trim()
    // 折叠/字面块起手符后面跟的是下面几行，这一行取不到值——留空让调用方报
    if (value === '>' || value === '|' || value === '>-' || value === '|-') value = ''
    const quote = value[0]
    if (value.length >= 2 && (quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1)
    }
    if (value !== '') out[key] = value
  }
  return out
}

/**
 * 收一个 skill 目录下的文件（相对路径，POSIX 分隔符）。
 *
 * 顺序稳定（每层按名字排），`SKILL.md` 由调用方提到最前。超限就停——多出来的那些
 * 由调用方报一句，不静默截断。
 */
function listFiles(dir: string, problems: CollectProblem[], rel = '', depth = 0): string[] {
  const here = rel === '' ? '.' : rel
  if (depth > MAX_DEPTH) {
    problems.push({ where: here, message: `目录超过 ${MAX_DEPTH} 层，更深的没收` })
    return []
  }
  const out: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    problems.push({ where: here, message: `读不动：${String(err)}` })
    return []
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listFiles(full, problems, childRel, depth + 1))
      continue
    }
    if (!entry.isFile()) continue
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
    let size: number
    try {
      size = fs.statSync(full).size
    } catch {
      continue
    }
    if (size > MAX_FILE_BYTES) {
      problems.push({
        where: childRel,
        message: `${Math.round(size / 1024)}KB 超过 ${MAX_FILE_BYTES / 1024}KB，没收——agent 读一份这么大的会吃掉整个上下文`,
      })
      continue
    }
    out.push(childRel)
  }
  return out
}

/**
 * 扫一个「装 skill 的目录」：**它下面每个子目录是一个 skill**（不再往下找，
 * `skills/a/b/SKILL.md` 不算）。
 *
 * 名字以 frontmatter 的 `name` 为准、缺了用目录名兜底。**描述缺了照样收**——没有描述
 * 的 skill 只是没人会主动去读，比整个不收要好查（问题里说得清是哪一份）。
 */
export function collectSkills(root: string, plugin: string): CollectResult {
  const problems: CollectProblem[] = []
  const skills: CollectedSkill[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch (err) {
    return { skills: [], problems: [{ where: '.', message: `skill 目录读不动：${String(err)}` }] }
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    const entryFile = path.join(dir, SKILL_ENTRY)
    if (!fs.existsSync(entryFile)) {
      problems.push({ where: entry.name, message: `没有 ${SKILL_ENTRY}，不当作 skill` })
      continue
    }
    let text: string
    try {
      text = fs.readFileSync(entryFile, 'utf8')
    } catch (err) {
      problems.push({ where: `${entry.name}/${SKILL_ENTRY}`, message: `读不动：${String(err)}` })
      continue
    }
    const front = parseFrontmatter(text)
    const name = front.name ?? entry.name
    const description = front.description ?? ''
    if (description === '') {
      problems.push({
        where: `${entry.name}/${SKILL_ENTRY}`,
        message: 'frontmatter 里没取到 description（只认单行 `key: value`，折叠块取不到）——没有描述 agent 不会来读它',
      })
    }
    // 子扫描的问题按 skill 目录报（它自己只知道相对自己的路径）
    const inner: CollectProblem[] = []
    const found = listFiles(dir, inner)
    for (const p of inner) problems.push({ where: `${entry.name}/${p.where}`, message: p.message })
    // SKILL.md 恒在第一位：读它的人不该去猜清单顺序
    const rest = found.filter((f) => f !== SKILL_ENTRY)
    if (rest.length + 1 > MAX_FILES) {
      problems.push({ where: entry.name, message: `文件超过 ${MAX_FILES} 份，只收前 ${MAX_FILES} 份` })
    }
    skills.push({
      skill: { name, description, plugin, files: [SKILL_ENTRY, ...rest.slice(0, MAX_FILES - 1)] },
      dir,
    })
  }
  return { skills, problems }
}

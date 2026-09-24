import fs from 'node:fs'
import path from 'node:path'

// 这个文件不碰 ctx、不写日志：扫出来的问题放进 problems 交给调用方写

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yml', '.yaml'])
const MAX_FILE_BYTES = 512 * 1024
/** 一份说明书的目录往下最多再走三层、最多收 64 个文件 */
const MAX_DEPTH = 3
const MAX_FILES = 64

/** 主文件名。它不在就不算一份说明书，目录名对得上也不算 */
export const SKILL_ENTRY = 'SKILL.md'

/** 一份说明书的自述。这份要交给外面，所以不带本机路径 */
export interface GwbSkill {
  /** 说明书名：frontmatter 写了 `name` 就用它，没写用目录名 */
  name: string
  /** frontmatter 的 `description`。agent 靠它决定要不要读正文，不是简介 */
  description: string
  /** 登记它的插件（完整包名） */
  plugin: string
  /** 目录下的文件清单（相对路径，POSIX 分隔符）。`SKILL.md` 恒在第一位 */
  files: string[]
}

/** 扫描途中值得告警的事 */
export interface CollectProblem {
  /** 相对扫描根的路径，指得到具体是哪一份 */
  where: string
  message: string
}

export interface CollectedSkill {
  skill: GwbSkill
  /** 说明书目录的绝对路径，只留在本插件里 */
  dir: string
}

export interface CollectResult {
  skills: CollectedSkill[]
  problems: CollectProblem[]
}

const FOLDED_BLOCK_MARKERS = new Set(['>', '|', '>-', '|-'])

function stripPairedQuotes(value: string): string {
  const quote = value[0]
  if (value.length >= 2 && (quote === '"' || quote === "'") && value.endsWith(quote)) return value.slice(1, -1)
  return value
}

/**
 * 取 markdown 的 YAML frontmatter（首行 `---` 到下一行 `---` 之间）。
 * 只认单行 `key: value`，只在第一个冒号处切开；折叠块（`>-`、`|`）与嵌套取不到值
 */
export function parseFrontmatter(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const withoutBom = text.replace(/^﻿/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(withoutBom)
  if (match === null) return fields
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    if (key === '' || /\s/.test(key)) continue
    let value = line.slice(colon + 1).trim()
    // 折叠块的值在下面几行，这一行取不到——留空让调用方告警
    if (FOLDED_BLOCK_MARKERS.has(value)) value = ''
    value = stripPairedQuotes(value)
    if (value !== '') fields[key] = value
  }
  return fields
}

function sortedDirEntries(dirEntries: fs.Dirent[]): fs.Dirent[] {
  return dirEntries.sort((a, b) => a.name.localeCompare(b.name))
}

/** 超过上限的记一条问题；stat 失败的直接跳过、不记问题 */
function isWithinSizeLimit(fullPath: string, relativePath: string, problems: CollectProblem[]): boolean {
  let size: number
  try {
    size = fs.statSync(fullPath).size
  } catch {
    return false
  }
  if (size > MAX_FILE_BYTES) {
    problems.push({
      where: relativePath,
      message: `${Math.round(size / 1024)}KB 超过 ${MAX_FILE_BYTES / 1024}KB，不收——agent 读一份这么大的会占满整个上下文`,
    })
    return false
  }
  return true
}

/** 收一份说明书目录下的文本文件（相对路径，POSIX 分隔符），每层按名字排；超出层数的记问题、不静默截断 */
function listTextFiles(dir: string, problems: CollectProblem[], relativeDir = '', depth = 0): string[] {
  const here = relativeDir === '' ? '.' : relativeDir
  if (depth > MAX_DEPTH) {
    problems.push({ where: here, message: `目录超过 ${MAX_DEPTH} 层，更深的不收` })
    return []
  }
  let dirEntries: fs.Dirent[]
  try {
    dirEntries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (readError) {
    problems.push({ where: here, message: `读不动：${String(readError)}` })
    return []
  }
  const relativePaths: string[] = []
  for (const dirEntry of sortedDirEntries(dirEntries)) {
    const childRelative = relativeDir === '' ? dirEntry.name : `${relativeDir}/${dirEntry.name}`
    const childFull = path.join(dir, dirEntry.name)
    if (dirEntry.isDirectory()) {
      relativePaths.push(...listTextFiles(childFull, problems, childRelative, depth + 1))
      continue
    }
    if (!dirEntry.isFile()) continue
    if (!TEXT_EXTENSIONS.has(path.extname(dirEntry.name).toLowerCase())) continue
    if (!isWithinSizeLimit(childFull, childRelative, problems)) continue
    relativePaths.push(childRelative)
  }
  return relativePaths
}

/** 子目录里扫出的问题只知道相对子目录的路径，补上子目录名再报 */
function prefixProblems(prefix: string, innerProblems: CollectProblem[], problems: CollectProblem[]): void {
  for (const problem of innerProblems) problems.push({ where: `${prefix}/${problem.where}`, message: problem.message })
}

/** `SKILL.md` 放第一位，其余照扫出的顺序；超过上限的截掉并记问题 */
function fileListWithEntryFirst(skillDirName: string, foundFiles: string[], problems: CollectProblem[]): string[] {
  const otherFiles = foundFiles.filter((file) => file !== SKILL_ENTRY)
  if (otherFiles.length + 1 > MAX_FILES) {
    problems.push({ where: skillDirName, message: `文件超过 ${MAX_FILES} 份，只收前 ${MAX_FILES} 份` })
  }
  return [SKILL_ENTRY, ...otherFiles.slice(0, MAX_FILES - 1)]
}

/** 收一份说明书；不算说明书或主文件读不出时记问题、回 undefined。缺 description 照收，只记问题 */
function collectOneSkill(root: string, skillDirName: string, plugin: string, problems: CollectProblem[]): CollectedSkill | undefined {
  const dir = path.join(root, skillDirName)
  const entryFile = path.join(dir, SKILL_ENTRY)
  if (!fs.existsSync(entryFile)) {
    problems.push({ where: skillDirName, message: `没有 ${SKILL_ENTRY}，不当作 skill` })
    return undefined
  }
  let text: string
  try {
    text = fs.readFileSync(entryFile, 'utf8')
  } catch (readError) {
    problems.push({ where: `${skillDirName}/${SKILL_ENTRY}`, message: `读不动：${String(readError)}` })
    return undefined
  }
  const frontmatter = parseFrontmatter(text)
  const name = frontmatter.name ?? skillDirName
  const description = frontmatter.description ?? ''
  if (description === '') {
    problems.push({
      where: `${skillDirName}/${SKILL_ENTRY}`,
      message: 'frontmatter 里没取到 description（只认单行 `key: value`，折叠块取不到）——没有描述 agent 不会来读它',
    })
  }
  const innerProblems: CollectProblem[] = []
  const foundFiles = listTextFiles(dir, innerProblems)
  prefixProblems(skillDirName, innerProblems, problems)
  return { skill: { name, description, plugin, files: fileListWithEntryFirst(skillDirName, foundFiles, problems) }, dir }
}

/** 扫一个装说明书的目录：它下面每个子目录是一份（只看这一层，`skills/a/b/SKILL.md` 不算） */
export function collectSkills(root: string, plugin: string): CollectResult {
  const problems: CollectProblem[] = []
  const skills: CollectedSkill[] = []
  let dirEntries: fs.Dirent[]
  try {
    dirEntries = fs.readdirSync(root, { withFileTypes: true })
  } catch (readError) {
    return { skills: [], problems: [{ where: '.', message: `skill 目录读不动：${String(readError)}` }] }
  }
  for (const dirEntry of sortedDirEntries(dirEntries)) {
    if (!dirEntry.isDirectory()) continue
    const collected = collectOneSkill(root, dirEntry.name, plugin, problems)
    if (collected !== undefined) skills.push(collected)
  }
  return { skills, problems }
}

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { collectSkills, parseFrontmatter, SKILL_ENTRY } from '../src/collect.js'

/** 造一棵真的目录树来扫——扫描本身就是它的活,拿替身测等于没测 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-skills-'))
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function writeSkill(dir: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(root, dir, ...rel.split('/'))
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, text, 'utf8')
  }
}

describe('parseFrontmatter', () => {
  it('取到 name 与 description', () => {
    const front = parseFrontmatter('---\nname: 甲\ndescription: 干这个用的\n---\n正文')
    expect(front).toEqual({ name: '甲', description: '干这个用的' })
  })

  it('值里的冒号照收——只在第一个冒号切一刀', () => {
    expect(parseFrontmatter('---\ndescription: Skill: 干嘛的\n---\n')).toEqual({ description: 'Skill: 干嘛的' })
  })

  it('成对的引号剥掉', () => {
    expect(parseFrontmatter('---\nname: "甲"\ndescription: \'乙\'\n---\n')).toEqual({ name: '甲', description: '乙' })
  })

  it('折叠块取不到值——留空让调用方报,不静默当成有', () => {
    expect(parseFrontmatter('---\ndescription: >-\n  下一行才是正文\n---\n')).toEqual({})
  })

  it('注释与空行跳过', () => {
    expect(parseFrontmatter('---\n# 说一句\n\nname: 甲\n---\n')).toEqual({ name: '甲' })
  })

  it('没有 frontmatter 回空表,不抛', () => {
    expect(parseFrontmatter('# 就是一份普通 markdown\n')).toEqual({})
  })
})

describe('collectSkills', () => {
  it('收下有 SKILL.md 的目录,SKILL.md 恒在第一位', () => {
    writeSkill('good', {
      'alpha/SKILL.md': '---\nname: alpha\ndescription: 甲的说明书\n---\n正文',
      'alpha/references/gotchas.md': '踩过的坑',
      'alpha/aaa.md': '排序上本该在 references 前面',
    })
    const { skills } = collectSkills(path.join(root, 'good'), '@scope/pkg')
    expect(skills).toHaveLength(1)
    const found = skills[0]!
    expect(found.skill.name).toBe('alpha')
    expect(found.skill.description).toBe('甲的说明书')
    expect(found.skill.plugin).toBe('@scope/pkg')
    expect(found.skill.files[0]).toBe(SKILL_ENTRY)
    expect(found.skill.files).toContain('references/gotchas.md')
    expect(found.skill.files).toContain('aaa.md')
  })

  it('本机路径留在 CollectedSkill.dir 上,不进要交出去的那份', () => {
    const { skills } = collectSkills(path.join(root, 'good'), '@scope/pkg')
    expect(skills[0]!.dir).toContain('alpha')
    expect(JSON.stringify(skills[0]!.skill)).not.toContain(root)
  })

  it('非文本不进表', () => {
    writeSkill('binary', {
      'beta/SKILL.md': '---\nname: beta\ndescription: 乙\n---\n',
      'beta/shot.png': '假装是张图',
    })
    const { skills } = collectSkills(path.join(root, 'binary'), 'p')
    expect(skills[0]!.skill.files).toEqual([SKILL_ENTRY])
  })

  it('没有 SKILL.md 的目录不算 skill,并报一句', () => {
    writeSkill('nomain', { 'gamma/readme.md': '这不是说明书' })
    const { skills, problems } = collectSkills(path.join(root, 'nomain'), 'p')
    expect(skills).toEqual([])
    expect(problems[0]!.where).toBe('gamma')
    expect(problems[0]!.message).toContain(SKILL_ENTRY)
  })

  it('缺 description 照样收,但必须报一句——静默丢了 agent 就永远不读它', () => {
    writeSkill('nodesc', { 'delta/SKILL.md': '---\nname: delta\n---\n正文' })
    const { skills, problems } = collectSkills(path.join(root, 'nodesc'), 'p')
    expect(skills).toHaveLength(1)
    expect(skills[0]!.skill.description).toBe('')
    expect(problems.some((p) => p.message.includes('description'))).toBe(true)
  })

  it('frontmatter 的 name 优先,缺了拿目录名兜底', () => {
    writeSkill('naming', {
      'dir-name/SKILL.md': '---\ndescription: 没写 name\n---\n',
      'renamed/SKILL.md': '---\nname: 另一个名\ndescription: 写了 name\n---\n',
    })
    const { skills } = collectSkills(path.join(root, 'naming'), 'p')
    expect(skills.map((s) => s.skill.name).sort()).toEqual(['dir-name', '另一个名'])
  })

  it('目录不存在回空表并报一句,不抛', () => {
    const { skills, problems } = collectSkills(path.join(root, '压根没有这个目录'), 'p')
    expect(skills).toEqual([])
    expect(problems).toHaveLength(1)
  })

  it('装 skill 的目录只看一层——再深的 SKILL.md 不算一个 skill', () => {
    writeSkill('deep', { 'outer/inner/SKILL.md': '---\nname: inner\ndescription: 藏得深\n---\n' })
    const { skills } = collectSkills(path.join(root, 'deep'), 'p')
    expect(skills).toEqual([])
  })
})

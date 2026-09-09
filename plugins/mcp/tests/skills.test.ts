import { describe, expect, it } from 'vitest'
import { buildInstructions, mimeTypeOf, skillResources, skillUri, type SkillView } from '../src/skills.js'

/** 一份测试用的 skill */
function skill(overrides: Partial<SkillView> = {}): SkillView {
  return { name: 'demo', description: '演示用', plugin: '@godcreator02/gwb-demo', files: ['SKILL.md'], ...overrides }
}

describe('skillUri', () => {
  it('拼成 skill://gwb/<名>/<文件>', () => {
    expect(skillUri('demo', 'SKILL.md')).toBe('skill://gwb/demo/SKILL.md')
    expect(skillUri('demo', 'references/gotchas.md')).toBe('skill://gwb/demo/references/gotchas.md')
  })
})

describe('mimeTypeOf', () => {
  it('认扩展名,认不出的当纯文本', () => {
    expect(mimeTypeOf('a.md')).toBe('text/markdown')
    expect(mimeTypeOf('a.JSON')).toBe('application/json')
    expect(mimeTypeOf('a.yml')).toBe('application/yaml')
    expect(mimeTypeOf('a.yaml')).toBe('application/yaml')
    expect(mimeTypeOf('a.txt')).toBe('text/plain')
    expect(mimeTypeOf('noext')).toBe('text/plain')
  })
})

describe('buildInstructions', () => {
  it('没有 skill 时只有固定那半,不留「本台支持 skill」的空话', () => {
    const text = buildInstructions([])
    expect(text).toContain('gwb_command_list')
    expect(text).not.toContain('skill://')
    expect(text).not.toContain('说明书')
  })

  it('固定那半带着自改的门:两张单子各一条,连内核都点了名', () => {
    const text = buildInstructions([])
    expect(text).toContain('不用问就能做')
    expect(text).toContain('先问人再动手')
    expect(text).toContain('gwb-kernel')
    // 无状态桥发不出 list_changed 这件事得写在门里,不然 agent 装完件干等新工具
    expect(text).toContain('list_changed')
  })

  it('每份 skill 两行:一行名字加描述,一行 URI', () => {
    const text = buildInstructions([
      skill(),
      skill({ name: 'another', description: '', plugin: '@godcreator02/gwb-x' }),
    ])
    expect(text).toContain('2 份说明书')
    expect(text).toContain('- demo（@godcreator02/gwb-demo 件）：演示用')
    expect(text).toContain(`  ${skillUri('demo', 'SKILL.md')}`)
    // 没写描述的不留空,也不冒充有
    expect(text).toContain('- another（@godcreator02/gwb-x 件）：（这一份没写描述）')
  })
})

describe('skillResources', () => {
  it('主文件一条,附件各一条', () => {
    const out = skillResources([
      skill({ files: ['SKILL.md', 'references/commands.md', 'references/gotchas.md'] }),
    ])
    expect(out.map((r) => r.name)).toEqual(['demo', 'demo/references/commands.md', 'demo/references/gotchas.md'])
  })

  it('主文件的名字就是 skill 名,附件的描述把人赶回主文件', () => {
    const out = skillResources([skill({ files: ['SKILL.md', 'references/commands.md'] })])
    const main = out[0]!
    expect(main.title).toBe('Skill: demo')
    expect(main.description).toBe('演示用')
    expect(main.source).toEqual({ skill: 'demo', file: 'SKILL.md' })

    const attached = out[1]!
    expect(attached.mimeType).toBe('text/markdown')
    expect(attached.description).toContain(skillUri('demo', 'SKILL.md'))
    expect(attached.source).toEqual({ skill: 'demo', file: 'references/commands.md' })
  })

  it('URI 与 source 对得上:照 instructions 给的 URI 能反查出该读哪个文件', () => {
    const out = skillResources([skill({ files: ['SKILL.md'] })])
    expect(out[0]!.uri).toBe(skillUri('demo', 'SKILL.md'))
    expect(`${out[0]!.source.skill}/${out[0]!.source.file}`).toBe('demo/SKILL.md')
  })
})

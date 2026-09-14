import { describe, expect, it } from 'vitest'
import { buildIndex, buildSearch, type CommandView, type SkillView } from '../src/inventory.js'

const CMDS: CommandView[] = [
  { name: 'skill.list', plugin: '@godcreator02/gwb-skills', description: '此刻挂着的 skill', usage: '无参数' },
  { name: 'skill.read', plugin: '@godcreator02/gwb-skills', description: '读一份 skill 的正文', usage: '参数 { name, file? }' },
  { name: 'py-cli.bootstrap', plugin: '@godcreator02/gwb-py-cli', description: '给一条 python CLI 建 venv', usage: 'venv 建在消费方件的包根下。参数 { entryId }' },
  { name: 'devkit.home.list', plugin: '@godcreator02/gwb-devkit', description: '列出全部测试 home', usage: '无参数' },
]

const SKILLS: SkillView[] = [
  { name: 'mcp', description: '要连一台 gwb 工作台的 MCP 门时读', plugin: '@godcreator02/gwb-mcp' },
  { name: 'gwb-py-cli', description: '要跑 python CLI 时读。讲清 venv 守卫的自愈行为', plugin: '@godcreator02/gwb-py-cli' },
]

describe('buildIndex：地图', () => {
  it('两表同形（名字+插件+一句话），commands 不带 usage、skills 不带 files', () => {
    const doc = buildIndex({ home: 'default', version: '0.5.0', commands: CMDS, skills: SKILLS })
    expect(doc.home).toBe('default')
    expect(doc.version).toBe('0.5.0')
    expect(doc.instructions).toContain('封顶于 index / search / run')
    expect(doc.commands[0]).toEqual({
      name: 'skill.list',
      plugin: '@godcreator02/gwb-skills',
      description: '此刻挂着的 skill',
    })
    expect(doc.skills[0]).toEqual({ name: 'mcp', plugin: '@godcreator02/gwb-mcp', description: '要连一台 gwb 工作台的 MCP 门时读' })
  })

  it('skills 件不在（undefined）时清单是空表——门照开', () => {
    const doc = buildIndex({ home: 'x', version: '0.0.0', commands: [] })
    expect(doc.skills).toEqual([])
  })

  it('老版注册表（没有 usage）不炸——当空串', () => {
    const doc = buildSearch({ commands: [{ name: 'a', plugin: 'p', description: '老' }] })
    expect(doc.commands[0]!.usage).toBe('')
  })
})

describe('buildSearch：按址与兜底', () => {
  it('裸调＝不过滤＝全貌：全部带 usage，filter 那格不出现', () => {
    const doc = buildSearch({ commands: CMDS, skills: SKILLS })
    expect(doc.filter).toBeUndefined()
    expect(doc.commands).toHaveLength(4)
    expect(doc.commands[1]).toEqual({
      name: 'skill.read',
      plugin: '@godcreator02/gwb-skills',
      description: '读一份 skill 的正文',
      usage: '参数 { name, file? }',
    })
    expect(doc.skills).toHaveLength(2)
    expect(doc.skills[0]).toHaveProperty('description')
  })

  it('plugin 精确筛两张表，命中行带描述', () => {
    const doc = buildSearch({ commands: CMDS, skills: SKILLS, query: { plugin: '@godcreator02/gwb-skills' } })
    expect(doc.commands.map((c) => c.name)).toEqual(['skill.list', 'skill.read'])
    expect(doc.skills).toHaveLength(0)
    expect(doc.filter).toEqual({ plugin: '@godcreator02/gwb-skills' })
  })

  it('prefix 是命令域意图：命令带用法，说明书表回瘦身行（不捎全表）', () => {
    const doc = buildSearch({ commands: CMDS, skills: SKILLS, query: { prefix: 'skill.' } })
    expect(doc.commands.map((c) => c.name)).toEqual(['skill.list', 'skill.read'])
    expect(doc.commands[0]).toHaveProperty('usage')
    // 全部说明书都在，但只有名字+插件——11.6KB 捎表那课的修复
    expect(doc.skills).toHaveLength(2)
    for (const s of doc.skills) expect('description' in s && s.description !== undefined).toBe(false)
  })

  it('prefix 与 q 同给时 q 对说明书生效，说明书带描述', () => {
    const doc = buildSearch({ commands: CMDS, skills: SKILLS, query: { prefix: 'skill.', q: 'mcp' } })
    expect(doc.skills.map((s) => s.name)).toEqual(['mcp'])
  })

  it('q 搜名字、一句话与用法——概念住在用法里也找得到', () => {
    const byUsage = buildSearch({ commands: CMDS, skills: SKILLS, query: { q: 'venv' } })
    expect(byUsage.commands.map((c) => c.name)).toEqual(['py-cli.bootstrap'])
    expect(byUsage.skills.map((s) => s.name)).toEqual(['gwb-py-cli'])

    const byDesc = buildSearch({ commands: CMDS, skills: SKILLS, query: { q: 'HOME' } })
    expect(byDesc.commands.map((c) => c.name)).toEqual(['devkit.home.list'])

    const byName = buildSearch({ commands: CMDS, skills: SKILLS, query: { q: 'skill.read' } })
    expect(byName.commands.map((c) => c.name)).toEqual(['skill.read'])
  })

  it('条件 AND 生效，空结果如实回空表', () => {
    const doc = buildSearch({ commands: CMDS, skills: SKILLS, query: { plugin: '@godcreator02/gwb-skills', q: 'venv' } })
    expect(doc.commands).toEqual([])
    expect(doc.skills).toEqual([])
    expect(doc.filter).toEqual({ plugin: '@godcreator02/gwb-skills', q: 'venv' })
  })
})

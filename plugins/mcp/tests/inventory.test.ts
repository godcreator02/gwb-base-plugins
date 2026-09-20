import { describe, expect, it } from 'vitest'
import { buildIndex, buildSearch, clampDescription, type CommandView, type SkillView } from '../src/inventory.js'

const CMDS: CommandView[] = [
  { name: 'skill.list', plugin: '@godcreator/gwb-skills', description: '此刻挂着的 skill', usage: '无参数' },
  { name: 'skill.read', plugin: '@godcreator/gwb-skills', description: '读一份 skill 的正文', usage: '参数 { name, file? }' },
  { name: 'py-cli.bootstrap', plugin: '@godcreator/gwb-py-cli', description: '给一条 python CLI 建 venv', usage: 'venv 建在消费方件的包根下。参数 { entryId }' },
  { name: 'devkit.home.list', plugin: '@godcreator/gwb-devkit', description: '列出全部测试 home', usage: '无参数' },
]

const SKILLS: SkillView[] = [
  { name: 'mcp', description: '要连一台 gwb 工作台的 MCP 门时读', plugin: '@godcreator/gwb-mcp' },
  { name: 'gwb-py-cli', description: '要跑 python CLI 时读。讲清 venv 守卫的自愈行为', plugin: '@godcreator/gwb-py-cli' },
]

describe('clampDescription：保险丝', () => {
  it('正常一句话原样——不做人话级截断，触发文本不砍', () => {
    const long = '用户提到「单元」「容器根」「unitfolders」「当前单元」，或者要你新开一个单元、找某个项目住在哪个目录时用。这个件把单元容器根现扫一遍读出生证。'
    expect(clampDescription(long)).toBe(long)
  })

  it('超 200 字才截、拼省略号——只防失控长文爆地图', () => {
    const t = 'x'.repeat(250)
    expect(clampDescription(t)).toBe(`${'x'.repeat(200)}…`)
    expect(clampDescription('x'.repeat(200))).toBe('x'.repeat(200))
  })

  it('空串与首尾空白', () => {
    expect(clampDescription('')).toBe('')
    expect(clampDescription('  一句话  ')).toBe('一句话')
  })
})

describe('buildIndex：地图（三层递进的第一层）', () => {
  it('说明书带完整 description；命令按件分组只报名字；没有 plugins 段；hint 在尾部', () => {
    const doc = buildIndex({ home: 'default', version: '0.9.0', commands: CMDS, skills: SKILLS })
    expect(doc.home).toBe('default')
    expect(doc.version).toBe('0.9.0')
    expect(doc.instructions).toContain('封顶于 index / search / run')
    expect('plugins' in doc).toBe(false)
    expect(doc.commands).toEqual([
      { plugin: '@godcreator/gwb-skills', names: ['skill.list', 'skill.read'] },
      { plugin: '@godcreator/gwb-py-cli', names: ['py-cli.bootstrap'] },
      { plugin: '@godcreator/gwb-devkit', names: ['devkit.home.list'] },
    ])
    expect(doc.skills[0]).toEqual({ name: 'mcp', plugin: '@godcreator/gwb-mcp', description: '要连一台 gwb 工作台的 MCP 门时读' })
    expect(doc.skills[1]!.description).toBe('要跑 python CLI 时读。讲清 venv 守卫的自愈行为')
    expect(doc.hint).toContain('search')
    expect(doc.hint).toContain('skill.read')
    expect(doc.hint).toContain('plugin-manager.list')
  })

  it('skills 件不在（undefined）时清单是空表——门照开', () => {
    const doc = buildIndex({ home: 'x', version: '0.0.0', commands: [] })
    expect(doc.skills).toEqual([])
    expect(doc.commands).toEqual([])
  })

  it('预算：现实规模（20 件 × 各 6 命令 + 26 说明书满长 description ≈ 实测 default 换算）≤ 18KB（UTF-8 字节）', () => {
    const commands: CommandView[] = []
    for (let p = 0; p < 20; p++) {
      for (let c = 0; c < 6; c++) commands.push({ name: `pkg${p}.command.number${c}.read`, plugin: `@godcreator/gwb-pkg${p}`, description: '', usage: '' })
    }
    const doc = buildIndex({
      home: 'default',
      version: '0.9.0',
      commands,
      skills: Array.from({ length: 26 }, (_, i) => ({
        name: `skill-${i}`,
        description: `触发词一触发词二触发词三时读。${'讲清参数形状与行为注意的正文说明文字'.repeat(5)}`,
        plugin: `@godcreator/gwb-pkg${i % 20}`,
      })),
    })
    expect(Buffer.byteLength(JSON.stringify(doc), 'utf8')).toBeLessThanOrEqual(18_432)
  })

  it('同输入两次拼装逐字节一致——地图进公共前缀，字节稳定性是缓存的地基', () => {
    const a = JSON.stringify(buildIndex({ home: 'd', version: '1', commands: CMDS, skills: SKILLS }))
    const b = JSON.stringify(buildIndex({ home: 'd', version: '1', commands: CMDS, skills: SKILLS }))
    expect(a).toBe(b)
  })
})

describe('buildSearch：按址与兜底', () => {
  it('裸调＝不过滤＝全貌：全部带 usage，filter 那格不出现', () => {
    const doc = buildSearch({ commands: CMDS, skills: SKILLS })
    expect(doc.filter).toBeUndefined()
    expect(doc.commands).toHaveLength(4)
    expect(doc.commands[1]).toEqual({
      name: 'skill.read',
      plugin: '@godcreator/gwb-skills',
      description: '读一份 skill 的正文',
      usage: '参数 { name, file? }',
    })
    expect(doc.skills).toHaveLength(2)
    expect(doc.skills[0]).toHaveProperty('description')
  })

  it('老版注册表（没有 usage）不炸——当空串', () => {
    const doc = buildSearch({ commands: [{ name: 'a', plugin: 'p', description: '老' }] })
    expect(doc.commands[0]!.usage).toBe('')
  })

  it('plugin 精确筛两张表，命中行带描述', () => {
    const doc = buildSearch({ commands: CMDS, skills: SKILLS, query: { plugin: '@godcreator/gwb-skills' } })
    expect(doc.commands.map((c) => c.name)).toEqual(['skill.list', 'skill.read'])
    expect(doc.skills).toHaveLength(0)
    expect(doc.filter).toEqual({ plugin: '@godcreator/gwb-skills' })
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
    const doc = buildSearch({ commands: CMDS, skills: SKILLS, query: { plugin: '@godcreator/gwb-skills', q: 'venv' } })
    expect(doc.commands).toEqual([])
    expect(doc.skills).toEqual([])
    expect(doc.filter).toEqual({ plugin: '@godcreator/gwb-skills', q: 'venv' })
  })
})

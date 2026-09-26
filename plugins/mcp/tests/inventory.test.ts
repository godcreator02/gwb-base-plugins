import { describe, expect, it } from 'vitest'
import { buildIndex, buildSearch, clampDescription, homeCatalog, type CommandView, type SkillView } from '../src/inventory.js'

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

describe('clampDescription：描述长度上限', () => {
  it('正常长度的描述原样返回——不按句子截断，触发条件一个字不删', () => {
    const long = '用户提到「单元」「容器根」「unitfolders」「当前单元」，或者要你新开一个单元、找某个项目住在哪个目录时用。这个件把单元容器根现扫一遍读出生证。'
    expect(clampDescription(long)).toBe(long)
  })

  it('超过 200 字才截断、加省略号——只防超长描述把 index 的返回撑得过大', () => {
    const t = 'x'.repeat(250)
    expect(clampDescription(t)).toBe(`${'x'.repeat(200)}…`)
    expect(clampDescription('x'.repeat(200))).toBe('x'.repeat(200))
  })

  it('空串与首尾空白', () => {
    expect(clampDescription('')).toBe('')
    expect(clampDescription('  一句话  ')).toBe('一句话')
  })
})

describe('buildIndex：index 的返回（三层查询的第一层）', () => {
  it('说明书带完整 description；命令按插件分组只列名字；没有 plugins 字段；hint 在末尾', () => {
    const doc = buildIndex({ home: 'default', version: '0.9.0', commands: CMDS, skills: SKILLS })
    expect(doc.home).toBe('default')
    expect(doc.version).toBe('0.9.0')
    expect(doc.instructions).toContain('MCP 工具只有 index / search / run 三个')
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

  it('skills 插件不在（undefined）时说明书清单是空表——MCP 入口照常可用', () => {
    const doc = buildIndex({ home: 'x', version: '0.0.0', commands: [] })
    expect(doc.skills).toEqual([])
    expect(doc.commands).toEqual([])
  })

  it('大小上限：现实规模（20 个插件 × 各 6 条命令 + 26 份说明书、description 写满，按实测 default 换算）≤ 18KB（UTF-8 字节）', () => {
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

  it('同样的输入两次生成逐字节一致——index 的返回会进提示词的公共前缀，字节稳定才能命中缓存', () => {
    const a = JSON.stringify(buildIndex({ home: 'd', version: '1', commands: CMDS, skills: SKILLS }))
    const b = JSON.stringify(buildIndex({ home: 'd', version: '1', commands: CMDS, skills: SKILLS }))
    expect(a).toBe(b)
  })
})

describe('homeCatalog：instructions 末尾那段目录', () => {
  it('写 home 名与版本、全部说明书名、去重后的命令前缀', () => {
    const text = homeCatalog({ home: 'default', version: '0.11.0', commands: CMDS, skills: SKILLS })
    expect(text).toContain('home「default」（gwb-mcp 0.11.0）')
    expect(text).toContain('mcp、gwb-py-cli')
    expect(text).toContain('skill、py-cli、devkit')
  })

  it('没有说明书、没有命令时写「无」', () => {
    const text = homeCatalog({ home: 'x', version: '0', commands: [], skills: [] })
    expect(text).toMatch(/说明书.*：无/)
    expect(text).toMatch(/命令前缀.*：无/)
  })
})

describe('buildSearch：按条件过滤与不带参数返回全部', () => {
  it('不带参数＝不过滤＝返回全部：每条都带 usage，不出现 filter 字段', () => {
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

  it('旧版注册表（没有 usage）不报错——当作空串', () => {
    const doc = buildSearch({ commands: [{ name: 'a', plugin: 'p', description: '老' }] })
    expect(doc.commands[0]!.usage).toBe('')
  })

  it('plugin 精确过滤命令与说明书两张表，匹配的行带描述', () => {
    const doc = buildSearch({ commands: CMDS, skills: SKILLS, query: { plugin: '@godcreator/gwb-skills' } })
    expect(doc.commands.map((c) => c.name)).toEqual(['skill.list', 'skill.read'])
    expect(doc.skills).toHaveLength(0)
    expect(doc.filter).toEqual({ plugin: '@godcreator/gwb-skills' })
  })

  it('prefix 表示只查命令：命令带用法，说明书只回名字与插件（不附带全部描述）', () => {
    const doc = buildSearch({ commands: CMDS, skills: SKILLS, query: { prefix: 'skill.' } })
    expect(doc.commands.map((c) => c.name)).toEqual(['skill.list', 'skill.read'])
    expect(doc.commands[0]).toHaveProperty('usage')
    // 全部说明书都在，但只有名字与插件——附带全部描述会让这次返回涨到 11.6KB
    expect(doc.skills).toHaveLength(2)
    for (const s of doc.skills) expect('description' in s && s.description !== undefined).toBe(false)
  })

  it('prefix 与 q 同时给时，q 对说明书生效，说明书带描述', () => {
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

  it('effect 只留标了这一种的命令，没标的不算；给了 effect 就不回说明书；命中的行带 effect', () => {
    const marked: CommandView[] = [
      { ...CMDS[0]!, effect: 'read' },
      { ...CMDS[1]!, effect: 'read' },
      { ...CMDS[2]!, effect: 'write' },
      CMDS[3]!,
    ]
    const doc = buildSearch({ commands: marked, skills: SKILLS, query: { effect: 'read' } })
    expect(doc.commands.map((c) => [c.name, c.effect])).toEqual([
      ['skill.list', 'read'],
      ['skill.read', 'read'],
    ])
    expect(doc.skills).toEqual([])
    const unmarkedRow = buildSearch({ commands: marked, query: { prefix: 'devkit.' } }).commands[0]!
    expect('effect' in unmarkedRow).toBe(false)
  })

  it('只给页面调用的命令 index 与 search 都不列', () => {
    const withHidden: CommandView[] = [...CMDS, { name: 'skill.sync', plugin: '@godcreator/gwb-skills', description: '页面推数据', hiddenFromAgents: true }]
    expect(buildIndex({ home: 'd', version: '1', commands: withHidden }).commands[0]).toEqual({ plugin: '@godcreator/gwb-skills', names: ['skill.list', 'skill.read'] })
    expect(buildSearch({ commands: withHidden, query: { prefix: 'skill.' } }).commands.map((c) => c.name)).toEqual(['skill.list', 'skill.read'])
  })

  it('多个条件按 AND 组合，没有匹配就返回空表', () => {
    const doc = buildSearch({ commands: CMDS, skills: SKILLS, query: { plugin: '@godcreator/gwb-skills', q: 'venv' } })
    expect(doc.commands).toEqual([])
    expect(doc.skills).toEqual([])
    expect(doc.filter).toEqual({ plugin: '@godcreator/gwb-skills', q: 'venv' })
  })
})

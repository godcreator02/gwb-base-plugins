import { describe, expect, it } from 'vitest'
import { buildSurface, loadInstructions } from '../src/surface.js'

describe('buildSurface', () => {
  it('现拼：home / version / instructions 都在，命令带 top 标', () => {
    const surface = buildSurface({
      home: 'default',
      version: '0.1.0',
      commands: [
        { name: 'skill.list', plugin: 'gwb-skills', description: '列出说明书。无参数', top: true },
        { name: 'hello.probe', plugin: 'gwb-hello', description: '探针：无参数', top: false },
      ],
    })
    expect(surface.home).toBe('default')
    expect(surface.version).toBe('0.1.0')
    expect(surface.filter).toBeUndefined()
    expect(surface.commands).toHaveLength(2)
    expect(surface.commands[0]).toMatchObject({ name: 'skill.list', top: true })
    expect(surface.commands[1]?.top).toBe(false)
  })

  it('skills 件不在（undefined）时清单是空表——门照开', () => {
    const surface = buildSurface({ home: 'x', version: '0.0.0', commands: [] })
    expect(surface.skills).toEqual([])
  })

  it('skills 在就带上，主文件在前', () => {
    const surface = buildSurface({
      home: 'x',
      version: '0.0.0',
      commands: [],
      skills: [{ name: 'gwb-devkit', description: '写件手册', plugin: 'gwb-devkit', files: ['SKILL.md'] }],
    })
    expect(surface.skills[0]?.name).toBe('gwb-devkit')
  })

  it('instructions 是包根那份 markdown——非空且带门牌第一句', () => {
    const surface = buildSurface({ home: 'x', version: '0.0.0', commands: [] })
    expect(surface.instructions).toContain('god 工作台（gwb）')
    expect(surface.instructions).toContain('先问人再动手')
  })
})

describe('loadInstructions', () => {
  it('原样带出，不随调用变', () => {
    expect(loadInstructions()).toBe(loadInstructions())
    expect(loadInstructions().length).toBeGreaterThan(300)
  })
})

const COMMANDS = [
  { name: 'skill.list', plugin: 'gwb-skills', description: '列出说明书。无参数', top: true },
  { name: 'skill.read', plugin: 'gwb-skills', description: '读一份正文。参数 { name, file? }', top: true },
  { name: 'plugin-manager.list', plugin: 'gwb-plugin-manager', description: '列条目。无参数', top: false },
  { name: 'hello.probe', plugin: 'gwb-hello', description: '探针：无参数', top: false },
]
const SKILLS = [
  { name: 'gwb-devkit', description: '写插件手册', plugin: 'gwb-devkit', files: ['SKILL.md'] },
  { name: 'reimburse', description: '报销插件手册', plugin: 'gwb-reimburse', files: ['SKILL.md'] },
]

describe('buildSurface 过滤', () => {
  it('?plugin= 只留那个插件登记的，commands 与 skills 一起筛', () => {
    const surface = buildSurface({
      home: 'x',
      version: '0.0.0',
      commands: COMMANDS,
      skills: SKILLS,
      query: { plugin: 'gwb-skills' },
    })
    expect(surface.commands.map((c) => c.name)).toEqual(['skill.list', 'skill.read'])
    expect(surface.skills).toEqual([])
    expect(surface.filter).toEqual({ plugin: 'gwb-skills' })
  })

  it('?prefix= 按命令名前缀筛，对 skills 不生效', () => {
    const surface = buildSurface({
      home: 'x',
      version: '0.0.0',
      commands: COMMANDS,
      skills: SKILLS,
      query: { prefix: 'skill.' },
    })
    expect(surface.commands.map((c) => c.name)).toEqual(['skill.list', 'skill.read'])
    expect(surface.skills).toHaveLength(2)
  })

  it('?q= 名字与描述里找子串，不分大小写', () => {
    const surface = buildSurface({
      home: 'x',
      version: '0.0.0',
      commands: COMMANDS,
      skills: SKILLS,
      query: { q: 'PROBE' },
    })
    expect(surface.commands.map((c) => c.name)).toEqual(['hello.probe'])
  })

  it('?q= 也筛 skills 的名字与描述', () => {
    const surface = buildSurface({
      home: 'x',
      version: '0.0.0',
      commands: [],
      skills: SKILLS,
      query: { q: 'devkit' },
    })
    expect(surface.skills.map((s) => s.name)).toEqual(['gwb-devkit'])
  })

  it('?slim=true 只回名字+插件的索引行，filter 自证', () => {
    const surface = buildSurface({
      home: 'x',
      version: '0.0.0',
      commands: COMMANDS,
      skills: SKILLS,
      query: { slim: true },
    })
    expect(surface.commands).toEqual([
      { name: 'skill.list', plugin: 'gwb-skills' },
      { name: 'skill.read', plugin: 'gwb-skills' },
      { name: 'plugin-manager.list', plugin: 'gwb-plugin-manager' },
      { name: 'hello.probe', plugin: 'gwb-hello' },
    ])
    expect(surface.skills).toEqual([
      { name: 'gwb-devkit', plugin: 'gwb-devkit' },
      { name: 'reimburse', plugin: 'gwb-reimburse' },
    ])
    expect(surface.filter).toEqual({ slim: true })
    // instructions 照带——它是口上的纪律，不是清单的一部分
    expect(surface.instructions).toContain('god 工作台')
  })

  it('过滤条件 AND 起来：plugin × q 同时给', () => {
    const surface = buildSurface({
      home: 'x',
      version: '0.0.0',
      commands: COMMANDS,
      query: { plugin: 'gwb-skills', q: 'read' },
    })
    expect(surface.commands.map((c) => c.name)).toEqual(['skill.read'])
    expect(surface.filter).toEqual({ plugin: 'gwb-skills', q: 'read' })
  })

  it('筛空了就是空表——空结果不是错，调用方看得懂', () => {
    const surface = buildSurface({
      home: 'x',
      version: '0.0.0',
      commands: COMMANDS,
      query: { q: '不存在的词' },
    })
    expect(surface.commands).toEqual([])
    expect(surface.home).toBe('x')
  })
})

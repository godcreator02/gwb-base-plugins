import { describe, expect, it } from 'vitest'
import { buildSurface } from '../src/surface.js'

describe('buildSurface', () => {
  it('现拼：home / version / instructions 都在,命令不带 top——门面封顶后没有那格', () => {
    const surface = buildSurface({
      home: 'default',
      version: '0.4.0',
      commands: [
        { name: 'skill.list', plugin: 'gwb-skills', description: '列出说明书。无参数' },
        { name: 'hello.probe', plugin: 'gwb-hello', description: '探针：无参数' },
      ],
    })
    expect(surface.home).toBe('default')
    expect(surface.version).toBe('0.4.0')
    expect(surface.filter).toBeUndefined()
    expect(surface.commands).toHaveLength(2)
    expect(surface.commands[0]).toEqual({ name: 'skill.list', plugin: 'gwb-skills', description: '列出说明书。无参数' })
    expect('top' in surface.commands[0]!).toBe(false)
  })

  it('skills 件不在（undefined）时清单是空表——门照开', () => {
    const surface = buildSurface({ home: 'x', version: '0.0.0', commands: [] })
    expect(surface.skills).toEqual([])
  })

  it('skills 在就带上', () => {
    const surface = buildSurface({
      home: 'x',
      version: '0.0.0',
      commands: [],
      skills: [{ name: 'mcp', description: 'MCP 门', plugin: 'gwb-mcp', files: ['SKILL.md'] }],
    })
    expect(surface.skills).toHaveLength(1)
  })

  it('plugin 筛：commands 与 skills 一起筛,生效条件在 filter 那格自证', () => {
    const surface = buildSurface({
      home: 'x',
      version: '0.0.0',
      commands: [
        { name: 'a', plugin: 'p1', description: '' },
        { name: 'b', plugin: 'p2', description: '' },
      ],
      skills: [{ name: 's1', description: '', plugin: 'p1', files: ['SKILL.md'] }],
      query: { plugin: 'p1' },
    })
    expect(surface.commands.map((c) => c.name)).toEqual(['a'])
    expect(surface.skills.map((s) => s.name)).toEqual(['s1'])
    expect(surface.filter).toEqual({ plugin: 'p1' })
  })

  it('prefix 只对命令有意义,q 不分大小写地搜名字与描述', () => {
    const surface = buildSurface({
      home: 'x',
      version: '0.0.0',
      commands: [
        { name: 'skill.list', plugin: 'p', description: '列出' },
        { name: 'shell.panes', plugin: 'p', description: 'PANES' },
      ],
      query: { prefix: 'skill.' },
    })
    expect(surface.commands.map((c) => c.name)).toEqual(['skill.list'])

    const searched = buildSurface({
      home: 'x',
      version: '0.0.0',
      commands: [
        { name: 'skill.list', plugin: 'p', description: '列出' },
        { name: 'shell.panes', plugin: 'p', description: '窗格' },
      ],
      query: { q: 'PANES' },
    })
    expect(searched.commands.map((c) => c.name)).toEqual(['shell.panes'])
  })

  it('slim：commands 与 skills 只回名字+插件的索引行', () => {
    const surface = buildSurface({
      home: 'x',
      version: '0.0.0',
      commands: [{ name: 'a', plugin: 'p1', description: '长描述' }],
      skills: [{ name: 's1', description: 'd', plugin: 'p1', files: ['SKILL.md'] }],
      query: { slim: true },
    })
    expect(surface.commands).toEqual([{ name: 'a', plugin: 'p1' }])
    expect(surface.skills).toEqual([{ name: 's1', plugin: 'p1' }])
  })
})

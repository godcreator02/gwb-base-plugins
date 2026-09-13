import { describe, expect, it } from 'vitest'
import { buildSurface, loadInstructions } from '../src/surface.js'

describe('buildSurface', () => {
  it('现拼：home / version / instructions 都在，命令带 top 标', () => {
    const surface = buildSurface({
      home: 'default',
      version: '0.1.0',
      commands: [
        { name: 'skill_list', plugin: 'gwb-skills', description: '列出说明书。无参数', top: true },
        { name: 'hello.probe', plugin: 'gwb-hello', description: '探针：无参数', top: false },
      ],
    })
    expect(surface.home).toBe('default')
    expect(surface.version).toBe('0.1.0')
    expect(surface.commands).toHaveLength(2)
    expect(surface.commands[0]).toMatchObject({ name: 'skill_list', top: true })
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

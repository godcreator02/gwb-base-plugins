import { describe, expect, it, vi } from 'vitest'
import { createRegistry, mergeFiles, toSettingsFile, type Owner } from '../src/registry.js'

const alice: Owner = { entryId: 'home:alice', pkg: '@godcreator02/gwb-alice' }
const bob: Owner = { entryId: 'home:bob', pkg: '@godcreator02/gwb-bob' }
/** 同一个包挂的第二条条目——包名一样，entryId 不一样 */
const alice2: Owner = { entryId: 'home:alice-2', pkg: '@godcreator02/gwb-alice' }

function fresh(): { reg: ReturnType<typeof createRegistry>; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn()
  const reg = createRegistry(warn)
  reg.load({}, {})
  return { reg, warn }
}

describe('声明与读写', () => {
  it('没设过值时 get 回 default', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'level', title: '级别', type: 'string', default: 'info' })
    expect(reg.get(alice, 'level')).toBe('info')
  })

  it('设过值就回那个值', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'level', title: '级别', type: 'string', default: 'info' })
    reg.put(reg.locate(alice, 'level')!, 'debug')
    expect(reg.get(alice, 'level')).toBe('debug')
  })

  it('drop 抹掉值但定义还在，get 回落到 default', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'level', title: '级别', type: 'string', default: 'info' })
    const slot = reg.locate(alice, 'level')!
    reg.put(slot, 'debug')
    reg.drop(slot)
    expect(reg.get(alice, 'level')).toBe('info')
    expect(reg.locate(alice, 'level')).toBeDefined()
  })

  it('读一项谁也没声明过的:回 undefined 并 warn', () => {
    const { reg, warn } = fresh()
    expect(reg.get(alice, 'nobody')).toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('没声明过就 locate 不到——set 因此写不进去', () => {
    const { reg } = fresh()
    expect(reg.locate(alice, 'nobody')).toBeUndefined()
  })
})

describe('落在哪一格', () => {
  it('不写 scope 就是 home，按 entryId 分区', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'level', title: '级别', type: 'string' })
    expect(reg.locate(alice, 'level')).toEqual({ scope: 'home', section: 'home:alice', key: 'level' })
  })

  it('machine 按包名分区——entryId 是 home 局部的，跨不了 home', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'license', title: '许可证', type: 'string', scope: 'machine' })
    expect(reg.locate(alice, 'license')).toEqual({
      scope: 'machine',
      section: '@godcreator02/gwb-alice',
      key: 'license',
    })
  })

  it('shared 落公共区，两档都一样', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'theme', title: '主题', type: 'string', shared: true })
    reg.define(alice, { key: 'api-key', title: 'Key', type: 'secret', scope: 'machine', shared: true })
    expect(reg.locate(alice, 'theme')?.section).toBe('*')
    expect(reg.locate(alice, 'api-key')).toEqual({ scope: 'machine', section: '*', key: 'api-key' })
  })

  it('同一个包挂两条:home 级各存各的，机器级共享一份', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'level', title: '级别', type: 'string' })
    reg.define(alice2, { key: 'level', title: '级别', type: 'string' })
    expect(reg.locate(alice, 'level')?.section).toBe('home:alice')
    expect(reg.locate(alice2, 'level')?.section).toBe('home:alice-2')

    reg.define(alice, { key: 'license', title: '许可证', type: 'string', scope: 'machine' })
    reg.define(alice2, { key: 'license', title: '许可证', type: 'string', scope: 'machine' })
    expect(reg.locate(alice, 'license')).toEqual(reg.locate(alice2, 'license'))
  })

  it('两条条目各存各的值，互不覆盖', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'level', title: '级别', type: 'string' })
    reg.define(alice2, { key: 'level', title: '级别', type: 'string' })
    reg.put(reg.locate(alice, 'level')!, 'info')
    reg.put(reg.locate(alice2, 'level')!, 'debug')
    expect(reg.get(alice, 'level')).toBe('info')
    expect(reg.get(alice2, 'level')).toBe('debug')
  })
})

describe('跨件共享', () => {
  it('件 B 不用 define 也读得到件 A 声明进公共区的——凭据就靠这条', () => {
    const { reg, warn } = fresh()
    reg.define(alice, { key: 'api-key', title: 'Key', type: 'secret', scope: 'machine', shared: true })
    reg.put(reg.locate(alice, 'api-key')!, 'sk-ant-xxx')
    expect(reg.get(bob, 'api-key')).toBe('sk-ant-xxx')
    expect(warn).not.toHaveBeenCalled()
  })

  it('件 B 读不到件 A 自己分区里的', () => {
    const { reg, warn } = fresh()
    reg.define(alice, { key: 'level', title: '级别', type: 'string' })
    reg.put(reg.locate(alice, 'level')!, 'debug')
    expect(reg.get(bob, 'level')).toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('本件自己声明过的优先于公共区', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'theme', title: '主题', type: 'string', shared: true })
    reg.put(reg.locate(alice, 'theme')!, 'dark')
    reg.define(bob, { key: 'theme', title: '主题', type: 'string', default: 'light' })
    expect(reg.get(bob, 'theme')).toBe('light')
    expect(reg.get(alice, 'theme')).toBe('dark')
  })
})

describe('撞名与说不清自己是谁', () => {
  it('同一条条目重复声明同一项:后来者赢，但要告警', () => {
    const { reg, warn } = fresh()
    reg.define(alice, { key: 'level', title: '旧', type: 'string', default: 'a' })
    reg.define(alice, { key: 'level', title: '新', type: 'string', default: 'b' })
    expect(reg.get(alice, 'level')).toBe('b')
    expect(warn).toHaveBeenCalledOnce()
  })

  it('注销只收自己那份——先来者的注销函数摘不掉后来者', () => {
    const { reg } = fresh()
    const offFirst = reg.define(alice, { key: 'level', title: '旧', type: 'string', default: 'a' })
    reg.define(alice, { key: 'level', title: '新', type: 'string', default: 'b' })
    offFirst()
    expect(reg.get(alice, 'level')).toBe('b')
  })

  it('注销之后就 locate 不到了', () => {
    const { reg } = fresh()
    const off = reg.define(alice, { key: 'level', title: '级别', type: 'string' })
    off()
    expect(reg.locate(alice, 'level')).toBeUndefined()
  })

  it('空 title 抛错，不是静默收下', () => {
    const { reg } = fresh()
    expect(() => reg.define(alice, { key: 'level', title: '', type: 'string' })).toThrow()
  })

  it('设置名不合规当场抛', () => {
    const { reg } = fresh()
    expect(() => reg.define(alice, { key: 'A/B', title: 'x', type: 'string' })).toThrow()
  })
})

describe('元信息：代码是权威，盘上是快照', () => {
  it('件挂上时用代码里的 title 覆盖盘上那份，值不动', () => {
    const warn = vi.fn()
    const reg = createRegistry(warn)
    reg.load({ 'home:alice': { level: { title: '盘上的旧标题', type: 'string', value: 'debug' } } }, {})
    reg.define(alice, { key: 'level', title: '代码里的新标题', type: 'string' })
    const row = reg.all().find((v) => v.key === 'level')
    expect(row?.title).toBe('代码里的新标题')
    expect(row?.value).toBe('debug')
  })

  it('件停了,盘上那份还在,但标成不 live', () => {
    const { reg } = fresh()
    const off = reg.define(alice, { key: 'level', title: '级别', type: 'string' })
    reg.put(reg.locate(alice, 'level')!, 'debug')
    expect(reg.all().find((v) => v.key === 'level')?.live).toBe(true)
    off()
    const row = reg.all().find((v) => v.key === 'level')
    expect(row?.live).toBe(false)
    expect(row?.value).toBe('debug')
  })

  it('all 两份一起交出去，带着各自的位置', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'level', title: '级别', type: 'string' })
    reg.define(alice, { key: 'api-key', title: 'Key', type: 'secret', scope: 'machine', shared: true })
    expect(reg.all().map((v) => `${v.scope}/${v.section}/${v.key}`).sort()).toEqual([
      'home/home:alice/level',
      'machine/*/api-key',
    ])
  })
})

describe('并份:machine.json 跨 home 共享，写前要并一次', () => {
  it('盘上有而内存没有的分区留着——那多半是另一个 home 写的', () => {
    const disk = { '@a': { x: { value: 1 } }, '@b': { y: { value: 2 } } }
    const mine = { '@a': { x: { value: 9 } } }
    expect(mergeFiles(disk, mine)).toEqual({ '@a': { x: { value: 9 } }, '@b': { y: { value: 2 } } })
  })

  it('同一分区里，盘上多出来的那一项也留着', () => {
    const disk = { '*': { a: { value: 1 }, b: { value: 2 } } }
    const mine = { '*': { a: { value: 9 } } }
    expect(mergeFiles(disk, mine)).toEqual({ '*': { a: { value: 9 }, b: { value: 2 } } })
  })

  it('并出来的是新对象，不动传进来的两份', () => {
    const disk = { '@a': { x: { value: 1 } } }
    const mine = { '@a': { x: { value: 9 } } }
    mergeFiles(disk, mine)
    expect(disk['@a']!['x']!.value).toBe(1)
  })
})

describe('盘上读来的东西要收窄', () => {
  it('顶层不是对象:整份当没有，并 warn', () => {
    const warn = vi.fn()
    expect(toSettingsFile([1, 2], warn, 'x.json')).toEqual({})
    expect(warn).toHaveBeenCalledOnce()
  })

  it('坏掉的只丢那一格，不是整份不认', () => {
    const warn = vi.fn()
    const out = toSettingsFile({ '@a': { good: { value: 1 }, bad: 'nope' }, '@b': 'nope' }, warn, 'x.json')
    expect(out).toEqual({ '@a': { good: { value: 1 } } })
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('空表是正当结果，不 warn', () => {
    const warn = vi.fn()
    expect(toSettingsFile({}, warn, 'x.json')).toEqual({})
    expect(warn).not.toHaveBeenCalled()
  })
})

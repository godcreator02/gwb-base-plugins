import { describe, expect, it, vi } from 'vitest'
import { createRegistry, toOwners, toSettingsFile, type Owner } from '../src/registry.js'

const alice: Owner = { entryId: 'home:alice', pkg: '@godcreator/gwb-alice' }
const bob: Owner = { entryId: 'home:bob', pkg: '@godcreator/gwb-bob' }
/** 同一个包挂的第二条条目——包名一样，entryId 不一样 */
const alice2: Owner = { entryId: 'home:alice-2', pkg: '@godcreator/gwb-alice' }

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
  it('按条目 id 的末段分区', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'level', title: '级别', type: 'string' })
    expect(reg.locate(alice, 'level')).toEqual({ section: 'alice', key: 'level' })
  })

  it('shared 落公共区', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'theme', title: '主题', type: 'string', shared: true })
    reg.define(alice, { key: 'api-key', title: 'Key', type: 'secret', shared: true })
    expect(reg.locate(alice, 'theme')?.section).toBe('*')
    expect(reg.locate(alice, 'api-key')).toEqual({ section: '*', key: 'api-key' })
  })

  it('同一个包挂两条:各存各的，互不覆盖', () => {
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
    reg.define(alice, { key: 'api-key', title: 'Key', type: 'secret', shared: true })
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

  it('条目 id 不合规当场抛——它要当分区名用,跟 gwb-data 那边一套字符集', () => {
    const { reg } = fresh()
    const bad: Owner = { entryId: 'home:Alice', pkg: '@godcreator/gwb-alice' }
    expect(() => reg.define(bad, { key: 'level', title: '级别', type: 'string' })).toThrow(/kebab-case/)
  })

  it('条目 id 超过两段当场抛——group 嵌套之后同名末段会撞进同一个分区', () => {
    const { reg } = fresh()
    const nested: Owner = { entryId: 'home:group:alice', pkg: '@godcreator/gwb-alice' }
    expect(() => reg.define(nested, { key: 'level', title: '级别', type: 'string' })).toThrow(/段/)
  })

  it('抛在动表之前——坏 id 那条不该在定义表里留下半条', () => {
    const { reg } = fresh()
    const bad: Owner = { entryId: 'home:Alice', pkg: '@godcreator/gwb-alice' }
    expect(() => reg.define(bad, { key: 'level', title: '级别', type: 'string' })).toThrow()
    expect(reg.all()).toEqual([])
  })
})

describe('元信息：代码是权威，盘上是快照', () => {
  it('件挂上时用代码里的 title 覆盖盘上那份，值不动', () => {
    const warn = vi.fn()
    const reg = createRegistry(warn)
    reg.load({ alice: { level: { title: '盘上的旧标题', type: 'string', value: 'debug' } } }, {})
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

  it('all 一份全交出去，带着各自的位置', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'level', title: '级别', type: 'string' })
    reg.define(alice, { key: 'api-key', title: 'Key', type: 'secret', shared: true })
    expect(reg.all().map((v) => `${v.section}/${v.key}`).sort()).toEqual(['*/api-key', 'alice/level'])
  })

  it('live 的项带着 default——界面拿它画灰占位；不落盘', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'frequency', title: '频率', type: 'number', default: 30 })
    reg.put(reg.locate(alice, 'frequency')!, 15)
    const row = reg.all().find((v) => v.key === 'frequency')
    expect(row?.default).toBe(30)
    expect(row?.value).toBe(15)
    // 定义表之外只有内存那份——落盘的文件里没有 default 键
    expect(JSON.stringify(reg.file())).not.toContain('"default"')
  })

  it('件停了 default 就不跟了——陈旧的默认没有显示的意义', () => {
    const { reg } = fresh()
    const off = reg.define(alice, { key: 'level', title: '级别', type: 'string', default: 'info' })
    off()
    expect(reg.all().find((v) => v.key === 'level')?.default).toBeUndefined()
  })

  it('string-list 型：值是字符串数组，逐行一项', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'sources', title: '白名单', type: 'string-list', default: ['D:/Notes'] })
    expect(reg.get(alice, 'sources')).toEqual(['D:/Notes'])
    reg.put(reg.locate(alice, 'sources')!, ['D:/Notes', 'D:/Projects'])
    expect(reg.get(alice, 'sources')).toEqual(['D:/Notes', 'D:/Projects'])
    expect(reg.all().find((v) => v.key === 'sources')?.type).toBe('string-list')
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

  it('户主表不当分区读', () => {
    const warn = vi.fn()
    expect(toSettingsFile({ $owners: { alice: '@a/alice' }, alice: {} }, warn, 'x.json')).toEqual({ alice: {} })
    expect(warn).not.toHaveBeenCalled()
  })

  it('户主表另读，坏的那格丢掉并 warn', () => {
    const warn = vi.fn()
    expect(toOwners({ $owners: { alice: '@a/alice', bob: 1, eve: '' } }, warn, 'x.json')).toEqual({ alice: '@a/alice' })
    expect(warn).toHaveBeenCalledTimes(2)
    expect(toOwners({}, warn, 'x.json')).toEqual({})
    expect(toOwners({ $owners: 'nope' }, warn, 'x.json')).toEqual({})
  })
})

describe('户主：分区归哪个包', () => {
  /** 跟 alice 算出同一个分区名，包名不同——scope 不同、短名相同的两个件就是这样 */
  const impostor: Owner = { entryId: 'home:alice', pkg: '@other/alice' }

  it('第一次 define 就记下户主——旧文件里没户主的分区谁先来归谁', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'level', title: '级别', type: 'string' })
    expect(reg.owners()).toEqual({ alice: '@godcreator/gwb-alice' })
  })

  it('分区名相同、包名不同：拒，而且不动表', () => {
    const warn = vi.fn()
    const reg = createRegistry(warn)
    reg.load({ alice: { level: { value: 'debug' } } }, { alice: '@godcreator/gwb-alice' })
    expect(() => reg.define(impostor, { key: 'level', title: '级别', type: 'string' })).toThrow(/@godcreator\/gwb-alice/)
    expect(reg.locate(impostor, 'level')).toBeUndefined()
    expect(reg.owners()).toEqual({ alice: '@godcreator/gwb-alice' })
  })

  it('同一个包再挂上来放行', () => {
    const warn = vi.fn()
    const reg = createRegistry(warn)
    reg.load({}, { alice: '@godcreator/gwb-alice' })
    expect(() => reg.define(alice, { key: 'level', title: '级别', type: 'string' })).not.toThrow()
  })

  it('过户之后新包名放行、旧包名拒', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'level', title: '级别', type: 'string' })
    reg.transfer('alice', '@other/alice')
    expect(() => reg.define(impostor, { key: 'level', title: '级别', type: 'string' })).not.toThrow()
    expect(() => reg.define(alice, { key: 'level', title: '级别', type: 'string' })).toThrow()
  })

  it('公共区不能过户', () => {
    const { reg } = fresh()
    expect(() => reg.transfer('*', '@a/x')).toThrow()
  })
})

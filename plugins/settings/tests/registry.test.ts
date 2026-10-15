import { describe, expect, it, vi } from 'vitest'
import { createRegistry, SECRET_MASK, toOwners, toSettingsFile, type Owner, type SettingGroupDef } from '../src/registry.js'

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

describe('一组设置', () => {
  const models: SettingGroupDef = {
    key: 'models',
    title: '模型',
    fields: [
      { key: 'model', title: '模型名', type: 'string' },
      { key: 'api', title: '请求地址', type: 'string', default: 'https://api.example.com' },
      { key: 'token', title: '令牌', type: 'secret' },
    ],
  }
  const listSlot = { section: 'alice', key: 'models' }
  const keysOf = (reg: ReturnType<typeof createRegistry>): string[] => reg.all().filter((v) => v.live).map((v) => v.key)

  it('名单是 string-list；名单里每个实例的每个字段派生一项，标题是「实例 · 字段」', () => {
    const warn = vi.fn()
    const reg = createRegistry(warn)
    reg.load({ alice: { models: { value: ['deepseek'] } } }, {})
    reg.defineGroup(alice, models)
    expect(keysOf(reg)).toEqual(['models', 'models.deepseek.model', 'models.deepseek.api', 'models.deepseek.token'])
    expect(reg.all().find((v) => v.key === 'models')).toMatchObject({ section: 'alice', title: '模型', type: 'string-list', value: ['deepseek'] })
    expect(reg.all().find((v) => v.key === 'models.deepseek.api')).toMatchObject({ title: 'deepseek · 请求地址', type: 'string', default: 'https://api.example.com' })
    expect(reg.status({ section: 'alice', key: 'models.deepseek.token' })).toMatchObject({ secret: true, isSet: false, live: true })
    expect(warn).not.toHaveBeenCalled()
  })

  it('名单加一个实例就补声明；去掉一个就撤销声明，值留着、live:false', () => {
    const { reg } = fresh()
    reg.defineGroup(alice, models)
    expect(keysOf(reg)).toEqual(['models'])
    reg.put(listSlot, ['deepseek', 'kimi'])
    expect(keysOf(reg)).toContain('models.kimi.token')
    reg.put({ section: 'alice', key: 'models.kimi.model' }, 'kimi-k2')
    reg.put(listSlot, ['deepseek'])
    expect(keysOf(reg).filter((key) => key.startsWith('models.kimi.'))).toEqual([])
    expect(reg.all().find((v) => v.key === 'models.kimi.model')).toMatchObject({ value: 'kimi-k2', live: false })
    expect(reg.locate(alice, 'models.kimi.model')).toBeUndefined()
    reg.put(listSlot, ['deepseek', 'kimi'])
    expect(reg.getGroup(alice, 'models').find((item) => item.name === 'kimi')?.values['model']).toBe('kimi-k2')
  })

  it('抹掉名单等于名单变空：全部实例撤销声明，值留着', () => {
    const { reg } = fresh()
    reg.defineGroup(alice, models)
    reg.put(listSlot, ['deepseek'])
    reg.put({ section: 'alice', key: 'models.deepseek.model' }, 'deepseek-chat')
    reg.drop(listSlot)
    expect(keysOf(reg)).toEqual(['models'])
    expect(reg.getGroup(alice, 'models')).toEqual([])
    expect(reg.read({ section: 'alice', key: 'models.deepseek.model' })).toBe('deepseek-chat')
  })

  it.each([
    ['不是数组', 'deepseek', '要是字符串数组'],
    ['含非字符串', ['deepseek', 1], '要是字符串数组'],
    ['不是 kebab-case', ['deepseek', 'Kimi'], '实例名不合规'],
    ['带点号', ['a.b'], '实例名不合规'],
    ['重复', ['deepseek', 'deepseek'], '实例名重复了'],
  ])('名单%s：整次拒绝，值与声明都不动', (_case, value, message) => {
    const { reg } = fresh()
    reg.defineGroup(alice, models)
    reg.put(listSlot, ['deepseek'])
    const before = reg.all()
    expect(() => reg.put(listSlot, value)).toThrow(message)
    expect(reg.all()).toEqual(before)
  })

  it('getGroup 按名单顺序回各实例，没值回 default，secret 回明文', () => {
    const { reg } = fresh()
    reg.defineGroup(alice, models)
    reg.put(listSlot, ['kimi', 'deepseek'])
    reg.put({ section: 'alice', key: 'models.deepseek.token' }, 'fake-group-token')
    reg.put({ section: 'alice', key: 'models.kimi.api' }, 'https://kimi.example.com')
    expect(reg.getGroup(alice, 'models')).toEqual([
      { name: 'kimi', values: { model: undefined, api: 'https://kimi.example.com', token: undefined } },
      { name: 'deepseek', values: { model: undefined, api: 'https://api.example.com', token: 'fake-group-token' } },
    ])
    expect(JSON.stringify(reg.all())).not.toContain('fake-group-token')
  })

  it('getGroup 只认自己 defineGroup 过的组', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'plain', title: '普通', type: 'string-list' })
    reg.defineGroup(alice, models)
    expect(() => reg.getGroup(alice, 'plain')).toThrow('没有用 defineGroup 声明过一组设置 plain')
    expect(() => reg.getGroup(bob, 'models')).toThrow('home:bob 没有用 defineGroup 声明过一组设置 models')
  })

  it('普通 define 不收带点号的键；组键、字段键也查 kebab-case，字段键重复报错', () => {
    const { reg } = fresh()
    expect(() => reg.define(alice, { key: 'models.deepseek.token', title: 'x', type: 'secret' })).toThrow('不合规')
    expect(() => reg.defineGroup(alice, { ...models, key: 'Models' })).toThrow('不合规')
    expect(() => reg.defineGroup(alice, { ...models, fields: [{ key: 'api_key', title: 'x', type: 'string' }] })).toThrow('不合规')
    expect(() => reg.defineGroup(alice, { ...models, fields: [models.fields[0]!, models.fields[0]!] })).toThrow('字段 model 重复了')
    expect(reg.all()).toEqual([])
  })

  it('盘上的名单不合规：defineGroup 报错，什么都不声明', () => {
    const warn = vi.fn()
    const reg = createRegistry(warn)
    reg.load({ alice: { models: { value: ['Bad Name'] } } }, {})
    expect(() => reg.defineGroup(alice, models)).toThrow('实例名不合规')
    expect(reg.all().filter((v) => v.live)).toEqual([])
    expect(reg.owners()).toEqual({})
  })

  it('注销把名单与全部派生声明一起撤销，值留着', () => {
    const { reg } = fresh()
    const off = reg.defineGroup(alice, models)
    reg.put(listSlot, ['deepseek'])
    reg.put({ section: 'alice', key: 'models.deepseek.model' }, 'deepseek-chat')
    off()
    expect(keysOf(reg)).toEqual([])
    expect(() => reg.getGroup(alice, 'models')).toThrow('没有用 defineGroup')
    expect(reg.read({ section: 'alice', key: 'models.deepseek.model' })).toBe('deepseek-chat')
    reg.put(listSlot, ['deepseek', 'kimi'])
    expect(keysOf(reg)).toEqual([])
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

/**
 * 枚举口那道门：`settings.all` 交出去的那一份**不带 secret 的明文**。
 * 服务面 `get` 与受信插件使用的 `read` 保持取值；MCP 和 UI 的 get 走不含值的 status。
 */
describe('secret 行不回明文', () => {
  /** 测试里的假凭据。**假值**——这一组断的就是「它不出现」 */
  const FAKE = 'sk-fake-0123456789abcdef'

  it('all：不出现明文，回「是 secret ＋ 设没设过 ＋ 定长掩码」三格', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'api-key', title: 'API Key', type: 'secret' })
    reg.put(reg.locate(alice, 'api-key')!, FAKE)

    const rows = reg.all()
    // 整份回执里一个字都不许有——不只是那一格
    expect(JSON.stringify(rows)).not.toContain(FAKE)
    const row = rows.find((v) => v.key === 'api-key')
    expect(row).toMatchObject({ section: 'alice', key: 'api-key', type: 'secret', secret: true, isSet: true, live: true })
    expect(row?.value).toBeUndefined()
    expect(row?.mask).toBe(SECRET_MASK)
  })

  it('掩码长度恒定——值多长都不从掩码里漏出去', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'short-key', title: '短', type: 'secret' })
    reg.define(alice, { key: 'long-key', title: '长', type: 'secret' })
    reg.put(reg.locate(alice, 'short-key')!, 'x')
    reg.put(reg.locate(alice, 'long-key')!, 'y'.repeat(200))
    const masks = reg.all().filter((v) => v.type === 'secret').map((v) => v.mask)
    expect(masks).toEqual([SECRET_MASK, SECRET_MASK])
    expect(masks[0]?.length).toBe(SECRET_MASK.length)
  })

  it('没设过：isSet 为 false，value 与 mask 都不带', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'api-key', title: 'API Key', type: 'secret' })
    const row = reg.all().find((v) => v.key === 'api-key')
    expect(row?.secret).toBe(true)
    expect(row?.isSet).toBe(false)
    expect(row?.value).toBeUndefined()
    expect(row?.mask).toBeUndefined()
  })

  it('件停了、盘上那份还在：照样按盘上的 type 打码，不 live', () => {
    const warn = vi.fn()
    const reg = createRegistry(warn)
    reg.load({ alice: { 'api-key': { title: 'API Key', type: 'secret', value: FAKE } } }, {})
    const rows = reg.all()
    expect(JSON.stringify(rows)).not.toContain(FAKE)
    expect(rows.find((v) => v.key === 'api-key')).toMatchObject({ secret: true, isSet: true, live: false, mask: SECRET_MASK })
  })

  it('公共区的 secret 一样收——跨件共享的凭据住那儿', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'api-key', title: 'API Key', type: 'secret', shared: true })
    reg.put(reg.locate(alice, 'api-key')!, FAKE)
    const rows = reg.all()
    expect(JSON.stringify(rows)).not.toContain(FAKE)
    expect(rows.find((v) => v.section === '*')).toMatchObject({ secret: true, isSet: true })
  })

  it('secret 的 default 也不回——默认值也是值，写死的凭据一样是凭据', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'api-key', title: 'API Key', type: 'secret', default: FAKE })
    const rows = reg.all()
    expect(JSON.stringify(rows)).not.toContain(FAKE)
    expect(rows.find((v) => v.key === 'api-key')?.default).toBeUndefined()
  })

  it('非 secret 行一个字节都不动，也不长新格', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'level', title: '级别', type: 'string', default: 'info' })
    reg.define(alice, { key: 'sources', title: '白名单', type: 'string-list' })
    reg.put(reg.locate(alice, 'level')!, 'debug')
    reg.put(reg.locate(alice, 'sources')!, ['D:/Notes'])
    const rows = reg.all()
    expect(rows.find((v) => v.key === 'level')).toEqual({
      section: 'alice',
      key: 'level',
      title: '级别',
      type: 'string',
      value: 'debug',
      default: 'info',
      live: true,
    })
    const list = rows.find((v) => v.key === 'sources')
    expect(list).toEqual({ section: 'alice', key: 'sources', title: '白名单', type: 'string-list', value: ['D:/Notes'], live: true })
    expect('secret' in list!).toBe(false)
    expect('isSet' in list!).toBe(false)
  })

  it('插件内部按位取用照旧拿得到真值：服务面 get 与 read', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'api-key', title: 'API Key', type: 'secret' })
    const slot = reg.locate(alice, 'api-key')!
    reg.put(slot, FAKE)
    expect(reg.get(alice, 'api-key')).toBe(FAKE)
    expect(reg.read(slot)).toBe(FAKE)
    // 内存表完整保留值；store 在落盘时拆成普通设置与凭据两份。
    expect(reg.file()).toEqual({ alice: { 'api-key': { title: 'API Key', type: 'secret', value: FAKE } } })
  })
})

describe('凭据状态与类型边界', () => {
  const fake = 'fake-status-secret'
  const slot = { section: 'alice', key: 'token' }

  it('status 只报告已保存与声明状态，不回值、默认值或描述', () => {
    const { reg } = fresh()
    const off = reg.define(alice, { key: 'token', title: '令牌', type: 'secret', description: '测试', default: fake })
    expect(reg.status(slot)).toEqual({ ...slot, type: 'secret', secret: true, isSet: false, live: true })
    reg.put(slot, fake)
    expect(reg.status(slot)).toEqual({ ...slot, type: 'secret', secret: true, isSet: true, live: true })
    expect(JSON.stringify(reg.status(slot))).not.toContain(fake)
    off()
    expect(reg.status(slot)).toMatchObject({ secret: true, isSet: true, live: false })
    reg.drop(slot)
    expect(reg.status(slot)).toMatchObject({ secret: true, isSet: false, live: false })
  })

  it('未知项没有状态，普通项也可以查状态且不返回值', () => {
    const { reg } = fresh()
    expect(reg.status(slot)).toBeUndefined()
    reg.define(alice, { key: 'level', title: '级别', type: 'string' })
    reg.put({ section: 'alice', key: 'level' }, 'debug')
    expect(reg.status({ section: 'alice', key: 'level' })).toEqual({ section: 'alice', key: 'level', type: 'string', secret: false, isSet: true, live: true })
  })

  it('已保存的 secret 不能由新声明降为普通项，拒绝后值仍被隐藏', () => {
    const { reg } = fresh()
    reg.load({ alice: { token: { title: '令牌', type: 'secret', value: fake } } }, {})
    expect(() => reg.define(alice, { key: 'token', title: '普通', type: 'string' })).toThrow('凭据项不能改成普通设置')
    expect(reg.status(slot)).toEqual({ ...slot, type: 'secret', secret: true, isSet: true, live: false })
    expect(reg.locate(alice, 'token')).toBeUndefined()
    expect(reg.owners()).toEqual({})
    expect(JSON.stringify(reg.all())).not.toContain(fake)
    expect(reg.read(slot)).toBe(fake)
  })

  it('清除值后仍是凭据项，重复声明失败不替换原有有效声明', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'token', title: '令牌', type: 'secret', default: fake })
    reg.put(slot, 'fake-saved')
    reg.drop(slot)
    expect(() => reg.define(alice, { key: 'token', title: '普通', type: 'string', default: 'unsafe-default' })).toThrow('凭据项不能改成普通设置')
    expect(reg.get(alice, 'token')).toBe(fake)
    expect(reg.status(slot)).toMatchObject({ secret: true, isSet: false, live: true })
    expect(JSON.stringify(reg.all())).not.toContain(fake)
  })

  it('shared 凭据也不能被另一插件用普通声明降级', () => {
    const { reg } = fresh()
    reg.define(alice, { key: 'token', title: '令牌', type: 'secret', shared: true })
    reg.put({ section: '*', key: 'token' }, fake)
    expect(() => reg.define(bob, { key: 'token', title: '普通', type: 'string', shared: true })).toThrow('凭据项不能改成普通设置')
    expect(reg.get(bob, 'token')).toBe(fake)
    expect(JSON.stringify(reg.all())).not.toContain(fake)
  })
})

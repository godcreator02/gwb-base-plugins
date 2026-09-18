import { describe, expect, it } from 'vitest'
import { mapLimited, parseSearch, readPluginMark } from '../src/search'

/**
 * 检索的解析与过滤。形状是实测钉的（2026-09-08，`/-/v1/search?text=@godcreator`）：
 * 顶层 `{ objects, total, time }`，每条 `object.package` 带 name/version/description；
 * 2026-09-15 起 name 有两种形状——npmjs/verdaccio 合着 scope、gitea 拆开单放，见下组用例。
 * 这组测试同时钉住两件定位上的事：**这里不认识任何具体的 registry**（只有协议）；
 * 「是不是件」自 2026-09-18 起只看 manifest 的 `gwb.plugin`（packument 读，`readPluginMark`）——
 * 名字（scope / `gwb-` 前缀）不再是判据，没有回退。
 */

const response = (objects: unknown[]): string => JSON.stringify({ objects, total: objects.length, time: 0 })

const entry = (name: string, patch: Record<string, unknown> = {}): unknown => ({
  downloads: { monthly: 0, weekly: 0 },
  searchScore: 0,
  package: { name, version: '0.0.1', description: `${name} 的一句话`, ...patch },
})

describe('parseSearch', () => {
  it('一份正经的响应原样收下，用不着的字段（downloads/score/publisher）不看', () => {
    const got = parseSearch(
      response([
        entry('@godcreator/gwb-plugin-manager', { version: '0.0.8', description: '管 home 里的包与条目' }),
        entry('@godcreator/gwb-shell'),
      ]),
    )
    expect(got).toEqual([
      { pkg: '@godcreator/gwb-plugin-manager', version: '0.0.8', description: '管 home 里的包与条目' },
      { pkg: '@godcreator/gwb-shell', version: '0.0.1', description: '@godcreator/gwb-shell 的一句话' },
    ])
  })

  it('不是 JSON、不是对象、没有 objects——整份回 undefined，让调用方给一句人话', () => {
    expect(parseSearch('Internal Error')).toBeUndefined()
    expect(parseSearch('[]')).toBeUndefined()
    expect(parseSearch('{"total": 0}')).toBeUndefined()
  })

  it('空 objects 是空结果，不是失败', () => {
    expect(parseSearch(response([]))).toEqual([])
  })

  it('**坏条目只跳过那一条**：缺 name、package 不是对象、整个条目是标量', () => {
    const got = parseSearch(
      response([
        entry(''),
        { package: { version: '1.0.0' } },
        'not-an-object',
        entry('@godcreator/gwb-data'),
      ]),
    )
    expect(got).toEqual([{ pkg: '@godcreator/gwb-data', version: '0.0.1', description: '@godcreator/gwb-data 的一句话' }])
  })

  it('version / description 缺了或不是字符串就当没有，不挡这一行', () => {
    const got = parseSearch(
      response([{ package: { name: '@godcreator/gwb-x', version: 7, description: '' } }]),
    )
    expect(got).toEqual([{ pkg: '@godcreator/gwb-x' }])
  })

  it('**响应不统一**：没有 version 的条目回退到 dist-tags.latest（实测同一份响应里两种并存）', () => {
    const got = parseSearch(
      response([
        { package: { name: '@godcreator/gwb-y', description: '旧索引的一条', 'dist-tags': { latest: '0.1.4' } } },
      ]),
    )
    expect(got).toEqual([{ pkg: '@godcreator/gwb-y', version: '0.1.4', description: '旧索引的一条' }])
  })

  it('gitea 形状：scope 拆开单放（name 只有 gwb-x），拼回全名', () => {
    const got = parseSearch(
      response([
        entry('gwb-plugin-manager', { scope: '@godcreator', version: '0.3.0' }),
        entry('gwb-bn-comment', { scope: '@godcreator', version: '0.3.1-dev.1' }),
      ]),
    )
    expect(got).toEqual([
      { pkg: '@godcreator/gwb-plugin-manager', version: '0.3.0', description: 'gwb-plugin-manager 的一句话' },
      { pkg: '@godcreator/gwb-bn-comment', version: '0.3.1-dev.1', description: 'gwb-bn-comment 的一句话' },
    ])
  })

  it('name 已带 @ 前缀时即使另有 scope 字段也不重复拼（混形状的源两边都对）', () => {
    const got = parseSearch(
      response([entry('@godcreator/gwb-z', { scope: '@godcreator' })]),
    )
    expect(got).toEqual([{ pkg: '@godcreator/gwb-z', version: '0.0.1', description: '@godcreator/gwb-z 的一句话' }])
  })

  it('scope 不是字符串就当没有，name 原样用（不猜）', () => {
    const got = parseSearch(response([entry('gwb-thing', { scope: 7 })]))
    expect(got).toEqual([{ pkg: 'gwb-thing', version: '0.0.1', description: 'gwb-thing 的一句话' }])
  })
})

describe('readPluginMark：从 packument 读件的身份声明（versions[latest].gwb.plugin）', () => {
  const packument = (gwb: unknown): string =>
    JSON.stringify({ 'dist-tags': { latest: '0.4.3' }, versions: { '0.4.3': { name: '@godcreator/gwb-x', gwb } } })

  it('声明了 true 就是件、false 明确不是（lib / 共享包 / 词汇表包可以显式写 false）', () => {
    expect(readPluginMark(packument({ plugin: true }))).toBe(true)
    expect(readPluginMark(packument({ plugin: false, title: '词汇表' }))).toBe(false)
  })

  it('**没声明过一律 undefined**（不是「不是件」）：没 gwb 段 / 段里没这个键 / 值不是 boolean', () => {
    expect(readPluginMark(JSON.stringify({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { name: 'x' } } }))).toBeUndefined()
    expect(readPluginMark(packument({ title: '只有标题' }))).toBeUndefined()
    expect(readPluginMark(packument({ plugin: 'yes' }))).toBeUndefined()
  })

  it('读不动的一律 undefined：不是 JSON、不是对象、缺 versions / dist-tags、latest 指不到版本', () => {
    expect(readPluginMark('Internal Error')).toBeUndefined()
    expect(readPluginMark('[]')).toBeUndefined()
    expect(readPluginMark(JSON.stringify({ versions: {} }))).toBeUndefined()
    expect(
      readPluginMark(JSON.stringify({ 'dist-tags': { latest: '9.9.9' }, versions: { '1.0.0': { gwb: { plugin: true } } } })),
    ).toBeUndefined()
  })

  it('只认 latest 那一版：旧版声明过、latest 没声明 → undefined，不拿旧版顶', () => {
    expect(
      readPluginMark(
        JSON.stringify({
          'dist-tags': { latest: '2.0.0' },
          versions: { '1.0.0': { gwb: { plugin: true } }, '2.0.0': { name: 'x' } },
        }),
      ),
    ).toBeUndefined()
  })
})

describe('mapLimited：限并发、结果按原顺序回', () => {
  it('结果顺序跟输入一致（哪怕先发的后回）', async () => {
    const got = await mapLimited([30, 10, 20], 2, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms))
      return ms
    })
    expect(got).toEqual([30, 10, 20])
  })

  it('同时在跑的条数不超过 limit', async () => {
    let live = 0
    let peak = 0
    await mapLimited([...Array(9).keys()], 3, async () => {
      live += 1
      peak = Math.max(peak, live)
      await new Promise((resolve) => setTimeout(resolve, 5))
      live -= 1
    })
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(1)
  })

  it('空表回空表；limit 比条数大也照跑', async () => {
    expect(await mapLimited([], 4, async () => 1)).toEqual([])
    expect(await mapLimited([1, 2], 40, async (n) => n * 2)).toEqual([2, 4])
  })
})

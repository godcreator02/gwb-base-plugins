import { describe, expect, it } from 'vitest'
import { isGwbLine, parseSearch } from '../src/search'

/**
 * 检索的解析与过滤。形状是实测钉的（2026-09-08，`/-/v1/search?text=@godcreator`）：
 * 顶层 `{ objects, total, time }`，每条 `object.package` 带 name/version/description；
 * 2026-09-15 起 name 有两种形状——npmjs/verdaccio 合着 scope、gitea 拆开单放，见下组用例。
 * 这组测试同时钉住两件定位上的事：**这里不认识任何具体的 registry**（只有协议），
 * 过滤只认「scope + gwb- 前缀」这一个字面规则。
 */

const response = (objects: unknown[]): string => JSON.stringify({ objects, total: objects.length, time: 0 })

const entry = (name: string, patch: Record<string, unknown> = {}): unknown => ({
  downloads: { monthly: 0, weekly: 0 },
  searchScore: 0,
  package: { name, version: '0.0.1', description: `${name} 的一句话`, ...patch },
})

describe('isGwbLine：scope 下、gwb- 前缀', () => {
  it('正线与废弃线的 gwb-* 都算——规则是字面的，不认正废', () => {
    expect(isGwbLine('@godcreator/gwb-plugin-manager')).toBe(true)
    expect(isGwbLine('@godcreator/gwb-api')).toBe(true)
  })

  it('共享包、词汇表包也算——它们本来就以 gwb- 开头', () => {
    expect(isGwbLine('@godcreator/gwb-shared-react')).toBe(true)
    expect(isGwbLine('@godcreator/gwb-plugin-api')).toBe(true)
  })

  it('没带前缀的废弃包、别人的 scope、裸名，都不算', () => {
    expect(isGwbLine('@godcreator/shell')).toBe(false)
    expect(isGwbLine('@godcreator/cli')).toBe(false)
    expect(isGwbLine('@someone/gwb-thing')).toBe(false)
    expect(isGwbLine('gwb-thing')).toBe(false)
  })
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

  it('gitea 形状：scope 拆开单放（name 只有 gwb-x），拼回全名——不拼的话 isGwbLine 整表落空', () => {
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
    expect(got?.every((row) => isGwbLine(row.pkg))).toBe(true)
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

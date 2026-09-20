import { describe, expect, it } from 'vitest'
import {
  BOOTSTRAP_SCOPE,
  isRegistryUrl,
  isScope,
  mergeSources,
  parseSources,
  registryKeyOf,
  removeSource,
  upsertSource,
} from '../src/sources'

/**
 * npmrc 纯逻辑的钉子。行形状对着这台机器的实际文件写的：
 * `@godcreator:registry=<gitea 源>`、`//<源路径>/:_authToken=<token>`、外加一行
 * npmjs 的 token 与注释——都不许被增删改弄丢。
 */

const GODCREATOR = 'https://git.example.com/api/packages/godcreator/npm/'
const J = 'https://git.example.com/api/packages/J/npm/'

const machineNpmrc = [
  '# 注释也在',
  `@godcreator:registry=${GODCREATOR}`,
  `//git.example.com/api/packages/godcreator/npm/:_authToken=t-god`,
  `@j:registry=${J}`,
  `//git.example.com/api/packages/J/npm/:_authToken=t-god`,
  '//registry.npmjs.org/:_authToken=t-npm',
  '',
].join('\n')

describe('isScope / isRegistryUrl', () => {
  it('认 @ 开头一段式的 scope，大小写都收（gitea 源上 @j 活得好好的）', () => {
    expect(isScope('@j')).toBe(true)
    expect(isScope('@godcreator')).toBe(true)
    expect(isScope('@my-team.tools')).toBe(true)
  })

  it('拦住手滑：包名、忘了 @、带斜杠、空串', () => {
    expect(isScope('@a/b')).toBe(false)
    expect(isScope('godcreator')).toBe(false)
    expect(isScope('@')).toBe(false)
    expect(isScope('')).toBe(false)
    expect(isScope(undefined)).toBe(false)
  })

  it('源地址只要 http(s) 起头且无空白', () => {
    expect(isRegistryUrl('https://x.example/npm/')).toBe(true)
    expect(isRegistryUrl('http://localhost:4873/')).toBe(true)
    expect(isRegistryUrl('git.example.com/npm/')).toBe(false)
    expect(isRegistryUrl('https://a b')).toBe(false)
  })
})

describe('registryKeyOf', () => {
  it('剥协议、补尾斜杠——带不带尾斜杠的同一源归成同一个键', () => {
    expect(registryKeyOf('https://h.example/p/npm/')).toBe('//h.example/p/npm/')
    expect(registryKeyOf('https://h.example/p/npm')).toBe('//h.example/p/npm/')
    expect(registryKeyOf('http://h.example:4873')).toBe('//h.example:4873/')
  })
})

describe('parseSources / mergeSources', () => {
  it('两行一组读出来：token 按源路径配上', () => {
    expect(parseSources(machineNpmrc)).toEqual([
      { scope: '@godcreator', registry: GODCREATOR, token: 't-god' },
      { scope: '@j', registry: J, token: 't-god' },
    ])
  })

  it('npmjs 那条 token 没有 scope 指着它，不进表（但删改时也不许弄丢它）', () => {
    expect(parseSources('//registry.npmjs.org/:_authToken=t-npm')).toEqual([])
  })

  it('token 配不上就没有这一格；注释与空行不碍事', () => {
    const got = parseSources(`# c\n\n@j:registry=${J}\n`)
    expect(got).toEqual([{ scope: '@j', registry: J }])
  })

  it('merge 带出处：同一 scope 在两层各自出现，两边都看得见', () => {
    const got = mergeSources([
      { file: 'user', text: `@j:registry=${J}` },
      { file: 'home', text: `@j:registry=https://h2.example/npm/` },
    ])
    expect(got).toEqual([
      { scope: '@j', registry: J, file: 'user' },
      { scope: '@j', registry: 'https://h2.example/npm/', file: 'home' },
    ])
  })
})

describe('upsertSource', () => {
  it('全新 scope：两行追加在末尾空行之前，原有行一个不动', () => {
    const { text, wrote, replaced } = upsertSource(machineNpmrc, {
      scope: '@z',
      registry: 'https://z.example/npm/',
      token: 't-z',
    })
    expect(replaced).toBe(false)
    expect(wrote).toEqual(['@z:registry=https://z.example/npm/', '//z.example/npm/:_authToken=t-z'])
    expect(text.split('\n')).toEqual([
      '# 注释也在',
      `@godcreator:registry=${GODCREATOR}`,
      '//git.example.com/api/packages/godcreator/npm/:_authToken=t-god',
      `@j:registry=${J}`,
      '//git.example.com/api/packages/J/npm/:_authToken=t-god',
      '//registry.npmjs.org/:_authToken=t-npm',
      '@z:registry=https://z.example/npm/',
      '//z.example/npm/:_authToken=t-z',
      '',
    ])
  })

  it('已有 scope：原位替换路由行；不给 token 时旧源那条 token 已成孤儿，跟着收走', () => {
    const { text, wrote, replaced } = upsertSource(machineNpmrc, { scope: '@j', registry: 'https://j2.example/npm/' })
    expect(replaced).toBe(true)
    expect(wrote).toEqual(['@j:registry=https://j2.example/npm/'])
    expect(text).toContain('@j:registry=https://j2.example/npm/')
    // 旧源没人指了，它的凭据行一并收走；godcreator 与 npmjs 的行原样
    expect(text).not.toContain('//git.example.com/api/packages/J/npm/:_authToken')
    expect(text).toContain('//git.example.com/api/packages/godcreator/npm/:_authToken=t-god')
    expect(text).toContain('//registry.npmjs.org/:_authToken=t-npm')
  })

  it('换源后旧 token 成了孤儿，跟着走；别的 scope 还指着的（@godcreator 同 token）不收', () => {
    const onlyJ = [`@j:registry=${J}`, '//git.example.com/api/packages/J/npm/:_authToken=t-god', ''].join('\n')
    const moved = upsertSource(onlyJ, { scope: '@j', registry: 'https://j2.example/npm/', token: 't-j2' })
    expect(moved.text).not.toContain('//git.example.com/api/packages/J/npm/:_authToken')
    expect(moved.text).toContain('//j2.example/npm/:_authToken=t-j2')

    // 同键换 token：原位替换，不叠行
    const again = upsertSource(moved.text, { scope: '@j', registry: 'https://j2.example/npm/', token: 't-j3' })
    expect(again.text.match(/_authToken/g)).toHaveLength(1)
    expect(again.text).toContain('t-j3')
    expect(again.replaced).toBe(true)
  })

  it('机器级现况：@j 与 @godcreator 共用一个 token，重写 @j 时 godcreator 那行必须还在', () => {
    const { text } = upsertSource(machineNpmrc, { scope: '@j', registry: J, token: 't-new' })
    expect(text).toContain('//git.example.com/api/packages/J/npm/:_authToken=t-new')
    expect(text).toContain('//git.example.com/api/packages/godcreator/npm/:_authToken=t-god')
    expect(text.match(/@j:registry/g)).toHaveLength(1)
  })

  it('空文件 / 没有尾换行的文件都能落出合法文本', () => {
    expect(upsertSource('', { scope: '@z', registry: 'https://z.example/npm/' }).text).toBe(
      '@z:registry=https://z.example/npm/\n',
    )
    const noNewline = '@a:registry=https://a.example/npm/'
    expect(upsertSource(noNewline, { scope: '@b', registry: 'https://b.example/npm/' }).text).toBe(
      `${noNewline}\n@b:registry=https://b.example/npm/`,
    )
  })
})

describe('removeSource', () => {
  it('整组拿走：路由行加孤儿 token 行，别的行原样', () => {
    const { text, removed, registry } = removeSource(machineNpmrc, '@j')
    expect(removed).toBe(true)
    expect(registry).toBe(J)
    expect(text).not.toContain('@j:registry')
    expect(text).not.toContain('//git.example.com/api/packages/J/npm/:_authToken')
    expect(text).toContain(`@godcreator:registry=${GODCREATOR}`)
    expect(text).toContain('//registry.npmjs.org/:_authToken=t-npm')
    expect(text).toContain('# 注释也在')
  })

  it('token 行还有别的 scope 指着同一条源就不收——删 @godcreator 只掉它那行路由与它自己路径的凭据', () => {
    // 真正的「共用一行」是两个 scope 指同一条源：@b 与 @a 都走 J 那条 npm 源
    const shared = [
      `@a:registry=${J}`,
      `@b:registry=${J}`,
      `//git.example.com/api/packages/J/npm/:_authToken=t-god`,
      `@godcreator:registry=${GODCREATOR}`,
      '//git.example.com/api/packages/godcreator/npm/:_authToken=t-god',
      '',
    ].join('\n')
    const dropped = removeSource(shared, '@a')
    expect(dropped.text).not.toContain('@a:registry')
    // @b 还指着 J 那条源，它的凭据行留下
    expect(dropped.text).toContain('//git.example.com/api/packages/J/npm/:_authToken=t-god')

    // 删引导 scope：godcreator 自己那条路径的凭据行成了孤儿、跟着走；
    // @j 那行同值凭据是**另一行**（按源的路径各自配对），不受牵连
    const solo = removeSource(machineNpmrc, '@godcreator')
    expect(solo.text).not.toContain('@godcreator:registry')
    expect(solo.text).not.toContain('//git.example.com/api/packages/godcreator/npm/:_authToken')
    expect(solo.text).toContain('//git.example.com/api/packages/J/npm/:_authToken=t-god')
  })

  it('没有这条 scope：一个字节不动，removed 是 false', () => {
    const { text, removed } = removeSource(machineNpmrc, '@nope')
    expect(removed).toBe(false)
    expect(text).toBe(machineNpmrc)
  })

  it('BOOTSTRAP_SCOPE 常量钉住引导线——命令层的守卫靠它', () => {
    expect(BOOTSTRAP_SCOPE).toBe('@godcreator')
  })
})

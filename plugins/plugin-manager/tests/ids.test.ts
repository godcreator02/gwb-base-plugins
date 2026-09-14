import { describe, expect, it } from 'vitest'
import {
  assertId,
  assertPkgName,
  assertSpec,
  bareId,
  defaultIdFor,
  installSpec,
  isValidId,
  uniqueId,
} from '../src/ids.js'

describe('条目 id 的字符集', () => {
  it('kebab-case 才认', () => {
    for (const good of ['commands', 'py-cli', 'a1-b2', 'x']) {
      expect(isValidId(good), good).toBe(true)
    }
  })

  it('大写、下划线、空串、点段、冒号一律不认', () => {
    for (const bad of ['Commands', 'a_b', '', 'a--b', '-a', 'a-', '.', '..', 'a.b', 'home:x', 'a/b']) {
      expect(isValidId(bad), bad).toBe(false)
    }
  })

  it('不合规当场抛，错话里带出规矩', () => {
    expect(() => assertId('Commands')).toThrow(/kebab-case/)
  })

  it('跟 gwb-data / gwb-settings 那两份是同一套——发得出去的 id 那边必须存得下数据', () => {
    // 那两个件按 id 的末段分区，字符集松了就等于发了一条谁也存不下东西的条目
    expect(isValidId('py-cli')).toBe(true)
    expect(isValidId('py_cli')).toBe(false)
  })
})

describe('完整 entryId → 裸 id', () => {
  it('只取末段——前缀 home: 是 loader 拼的，树上认的是末段', () => {
    expect(bareId('home:commands')).toBe('commands')
    expect(bareId('home:py-cli')).toBe('py-cli')
  })

  it('本来就是裸的照收', () => {
    expect(bareId('commands')).toBe('commands')
  })

  it('末段是空的当场抛', () => {
    expect(() => bareId('')).toThrow()
    expect(() => bareId('home:')).toThrow()
  })
})

describe('包名 → 默认 id', () => {
  it('去掉 scope 与 gwb- 前缀', () => {
    expect(defaultIdFor('@team/gwb-py-cli')).toBe('py-cli')
    expect(defaultIdFor('@team/gwb-commands')).toBe('commands')
    expect(defaultIdFor('@team/gwb-plugin-manager')).toBe('plugin-manager')
  })

  it('没 scope 没前缀的原样', () => {
    expect(defaultIdFor('koishi-plugin-echo')).toBe('koishi-plugin-echo')
  })

  it('只去掉最外那层 gwb-，包名里第二个 gwb 留着', () => {
    expect(defaultIdFor('@x/gwb-gwb-tools')).toBe('gwb-tools')
  })

  it('大写与点号收进 kebab-case——它要当目录名和分区名用', () => {
    expect(defaultIdFor('@x/Foo.Bar')).toBe('foo-bar')
    expect(defaultIdFor('@x/a_b')).toBe('a-b')
  })

  it('一个字符都剩不下时给个兜底名，后面还有撞名那一层兜着', () => {
    expect(defaultIdFor('@x/gwb-')).toBe('plugin')
  })

  it('编出来的默认 id 自己必须过校验', () => {
    for (const pkg of ['@team/gwb-py-cli', '@x/Foo.Bar', '@x/gwb-', 'a_b_c']) {
      expect(isValidId(defaultIdFor(pkg)), pkg).toBe(true)
    }
  })
})

describe('撞名加数字后缀', () => {
  it('没占就用本名', () => {
    expect(uniqueId('py-cli', new Set())).toBe('py-cli')
  })

  it('占了就 -2、-3 往下数', () => {
    expect(uniqueId('py-cli', new Set(['py-cli']))).toBe('py-cli-2')
    expect(uniqueId('py-cli', new Set(['py-cli', 'py-cli-2']))).toBe('py-cli-3')
  })

  it('中间空着的那个号补回去', () => {
    expect(uniqueId('py-cli', new Set(['py-cli', 'py-cli-3']))).toBe('py-cli-2')
  })

  it('编出来的照样过校验', () => {
    expect(isValidId(uniqueId('py-cli', new Set(['py-cli'])))).toBe(true)
  })
})

describe('包名与版本范围', () => {
  it('裸名与 scope 名都认', () => {
    expect(() => assertPkgName('cordis')).not.toThrow()
    expect(() => assertPkgName('@team/gwb-commands')).not.toThrow()
    expect(() => assertPkgName('a.b_c-d~e')).not.toThrow()
  })

  it('以 - 开头的不认——那会被 pnpm 读成开关', () => {
    expect(() => assertPkgName('--force')).toThrow()
    expect(() => assertPkgName('-r')).toThrow()
  })

  it('带空白、带路径、空串、大写一律不认', () => {
    for (const bad of ['a b', 'a/b/c', '', '../evil', 'Foo', '@scope']) {
      expect(() => assertPkgName(bad), bad).toThrow()
    }
  })

  it('版本范围松着收', () => {
    for (const good of ['^1.2.3', '0.0.3', 'latest', '>=0.0.1', 'workspace:*']) {
      expect(() => assertSpec(good), good).not.toThrow()
    }
  })

  it('空串、带空白、以 - 开头的范围不认', () => {
    // 带空格的复合范围（`>=1 <2`）也被这条挡了——认了这个代价：空白是开关注入的口子
    for (const bad of ['', ' ', '>=0.0.1 <1', '^1 --force', '-r']) {
      expect(() => assertSpec(bad), bad).toThrow()
    }
  })

  it('拼 pnpm add 的那个参数', () => {
    expect(installSpec('@team/gwb-commands')).toBe('@team/gwb-commands')
    expect(installSpec('@team/gwb-commands', '0.0.3')).toBe('@team/gwb-commands@0.0.3')
  })

  it('坏名字拼不出参数', () => {
    expect(() => installSpec('--force')).toThrow()
    expect(() => installSpec('cordis', '-r')).toThrow()
  })
})

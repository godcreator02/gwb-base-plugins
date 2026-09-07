import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertKey,
  assertSection,
  entrySection,
  homeFile,
  looksRandom,
  machineFile,
  SHARED_SECTION,
} from '../src/paths.js'

describe('设置名', () => {
  it('kebab-case 收下', () => {
    expect(() => assertKey('level')).not.toThrow()
    expect(() => assertKey('anthropic-api-key')).not.toThrow()
    expect(() => assertKey('h2')).not.toThrow()
  })

  it('带斜杠的拒掉——那是存储键的分隔符', () => {
    expect(() => assertKey('a/b')).toThrow()
  })

  it('大写、下划线、空串、首尾连字符一律拒', () => {
    for (const bad of ['Level', 'api_key', '', '-x', 'x-', 'a--b']) {
      expect(() => assertKey(bad), bad).toThrow()
    }
  })
})

describe('分区名', () => {
  it('包名与条目 id 的末段照收', () => {
    expect(() => assertSection('@godcreator02/gwb-hello')).not.toThrow()
    expect(() => assertSection('hello')).not.toThrow()
  })

  it('顶掉公共区的拒掉', () => {
    expect(() => assertSection(SHARED_SECTION)).toThrow()
  })

  it('空的拒掉', () => {
    expect(() => assertSection('')).toThrow()
  })
})

describe('条目 id 换分区名', () => {
  it('只取末段——前缀 home: 是 loader 拼的，跟着内核的 ENTRY_ROOT 走，不进分区名', () => {
    expect(entrySection('home:hello')).toBe('hello')
    expect(entrySection('home:py-cli')).toBe('py-cli')
  })

  it('没前缀的照收', () => {
    expect(entrySection('hello')).toBe('hello')
  })

  it('超过两段当场抛——group 嵌套之后同名末段会撞进同一个分区', () => {
    expect(() => entrySection('home:group:hello')).toThrow(/段/)
  })

  it('每一段都要 kebab-case,前缀那段也算——跟 gwb-data 的目录名一套字符集', () => {
    for (const bad of ['home:Hello', 'home:a_b', 'home:', ':hello', 'Home:hello', 'home:a--b', '']) {
      expect(() => entrySection(bad), bad).toThrow(/kebab-case/)
    }
  })

  it('点段与分隔符不认', () => {
    for (const bad of ['.', '..', 'home:..', 'home:a.b', 'home:a/b', 'home:a\\b']) {
      expect(() => entrySection(bad), bad).toThrow()
    }
  })

  it('顶掉公共区的那个名字连字符集这关都过不了', () => {
    expect(() => entrySection(SHARED_SECTION)).toThrow()
    expect(() => entrySection(`home:${SHARED_SECTION}`)).toThrow()
  })

  it('跟随机 id 那个守卫不重叠:随机 id 算得出分区名,只是每次启动换一个', () => {
    expect(entrySection('home:a3f9c210')).toBe('a3f9c210')
    expect(looksRandom('home:a3f9c210')).toBe(true)
  })
})

describe('两份文件的落点', () => {
  const dataDir = path.join('C:', 'u', 'gwb-kernel', 'homes', 'default')

  it('home 那份跟 cordis.yml 并排', () => {
    expect(homeFile(dataDir)).toBe(path.join(dataDir, 'settings.json'))
  })

  it('机器级那份跟 homes 并列，不在 home 里', () => {
    expect(machineFile(dataDir)).toBe(path.join('C:', 'u', 'gwb-kernel', 'machine.json'))
  })

  it('换个 home 名，机器级那份还是同一个文件', () => {
    const other = path.join('C:', 'u', 'gwb-kernel', 'homes', 'test-2609071530')
    expect(machineFile(other)).toBe(machineFile(dataDir))
  })

  it('父目录不叫 homes 就抛——内核改了排布，别把凭据写进意外的地方', () => {
    expect(() => machineFile(path.join('C:', 'u', 'gwb-kernel', 'home'))).toThrow(/homes/)
  })
})

describe('认出没手写 id 的条目', () => {
  it('8 位十六进制是 loader 发的随机 id', () => {
    expect(looksRandom('home:8a3f2b1c')).toBe(true)
    expect(looksRandom('home:d9509601')).toBe(true)
  })

  it('手写的短名不算', () => {
    expect(looksRandom('home:hello')).toBe(false)
    expect(looksRandom('home:data')).toBe(false)
    expect(looksRandom('home:settings')).toBe(false)
  })

  it('只看末段——前缀 home: 是 loader 拼的，不参与判断', () => {
    expect(looksRandom('8a3f2b1c')).toBe(true)
  })

  it('已知会误报:正好 8 位十六进制字母的手写 id', () => {
    // 拦不住，但代价只是一句 warn。真要治得让内核把随机 id 标出来
    expect(looksRandom('home:deadbeef')).toBe(true)
  })
})

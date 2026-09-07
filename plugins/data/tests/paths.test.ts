import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertDocName, docFileIn, entryDir, entryDirName, isValidDocName, looksRandom } from '../src/paths.js'

describe('文档名', () => {
  it('kebab-case 才认', () => {
    expect(isValidDocName('layout')).toBe(true)
    expect(isValidDocName('open-panes')).toBe(true)
    expect(isValidDocName('a1-b2')).toBe(true)
  })

  it('大写、下划线、空串、点段一律不认', () => {
    for (const bad of ['Layout', 'a_b', '', 'a--b', '-a', 'a-', '.', '..', 'a.b']) {
      expect(isValidDocName(bad), bad).toBe(false)
    }
  })

  it('带分隔符的名字不认——挡的是造出意外的嵌套目录', () => {
    for (const bad of ['a/b', 'a\\b', '../escape']) {
      expect(isValidDocName(bad), bad).toBe(false)
    }
  })

  it('不合规当场抛,错话里带出规矩', () => {
    expect(() => assertDocName('Layout')).toThrow(/kebab-case/)
  })
})

describe('条目 id 换目录名', () => {
  it('只取末段——前缀 home: 是 loader 拼的，冒号不进目录名', () => {
    expect(entryDirName('home:hello')).toBe('hello')
    expect(entryDirName('home:py-cli')).toBe('py-cli')
  })

  it('没前缀的照收', () => {
    expect(entryDirName('hello')).toBe('hello')
  })

  it('超过两段当场抛——group 嵌套之后同名末段会撞进同一个目录', () => {
    expect(() => entryDirName('home:group:hello')).toThrow(/段/)
  })

  it('每一段都要 kebab-case,前缀那段也算', () => {
    for (const bad of ['home:Hello', 'home:a_b', 'home:', ':hello', 'Home:hello', 'home:a--b']) {
      expect(() => entryDirName(bad), bad).toThrow(/kebab-case/)
    }
  })

  it('点段不认——它要当目录名用,`.` 与 `..` 就是穿越', () => {
    for (const bad of ['.', '..', 'home:.', 'home:..', 'home:a.b']) {
      expect(() => entryDirName(bad), bad).toThrow()
    }
  })

  it('带分隔符的不认', () => {
    for (const bad of ['home:a/b', 'home:a\\b', 'a/../b']) {
      expect(() => entryDirName(bad), bad).toThrow()
    }
  })

  it('空串不认', () => {
    expect(() => entryDirName('')).toThrow()
  })
})

describe('认出没手写 id 的条目', () => {
  it('8 位十六进制是 loader 发的随机 id', () => {
    expect(looksRandom('home:8a3f2b1c')).toBe(true)
    expect(looksRandom('home:a3f9c210')).toBe(true)
  })

  it('手写的短名不算', () => {
    expect(looksRandom('home:hello')).toBe(false)
    expect(looksRandom('home:data')).toBe(false)
  })

  it('只看末段——前缀 home: 是 loader 拼的，不参与判断', () => {
    expect(looksRandom('8a3f2b1c')).toBe(true)
  })

  it('跟字符集校验不重叠:随机 id 本身是合法 kebab-case', () => {
    // 两个守卫各管各的——这种 id 算得出目录，只是每次启动换一个
    expect(() => entryDirName('home:a3f9c210')).not.toThrow()
    expect(looksRandom('home:a3f9c210')).toBe(true)
  })

  it('已知会误报:正好 8 位十六进制字母的手写 id', () => {
    // 拦不住，但代价只是一句 warn。真要治得让内核把随机 id 标出来
    expect(looksRandom('home:deadbeef')).toBe(true)
  })
})

describe('路径', () => {
  it('数据目录按条目 id 的末段切', () => {
    expect(entryDir('D:/home', 'home:hello')).toBe(path.join('D:/home', 'data', 'hello'))
    expect(entryDir('D:/home', 'hello')).toBe(path.join('D:/home', 'data', 'hello'))
  })

  it('同一个包的两条条目各是各的目录——按包名切的话它们会互相覆盖', () => {
    expect(entryDir('D:/home', 'home:py-311')).not.toBe(entryDir('D:/home', 'home:py-312'))
  })

  it('文档落成同名 .json', () => {
    expect(docFileIn('D:/dir', 'layout')).toBe(path.join('D:/dir', 'layout.json'))
  })

  it('坏名字算不出路径', () => {
    expect(() => entryDir('D:/home', '../evil')).toThrow()
    expect(() => docFileIn('D:/dir', '../evil')).toThrow()
  })
})

import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertDocName, docFileIn, isValidDocName, isValidPackageName, packageDir } from '../src/paths.js'

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

describe('包名', () => {
  it('带不带 scope 都认', () => {
    expect(isValidPackageName('@godcreator02/gwb-shell')).toBe(true)
    expect(isValidPackageName('plain')).toBe(true)
    expect(isValidPackageName('with.dot')).toBe(true)
  })

  it('点段不认——npm 包名允许点号,但 `..` 做目录名就是穿越', () => {
    expect(isValidPackageName('..')).toBe(false)
    expect(isValidPackageName('@a/..')).toBe(false)
    expect(isValidPackageName('../evil')).toBe(false)
    expect(isValidPackageName('@a/../b')).toBe(false)
  })

  it('大写与空串不认', () => {
    expect(isValidPackageName('Shell')).toBe(false)
    expect(isValidPackageName('')).toBe(false)
    expect(isValidPackageName('@/b')).toBe(false)
  })
})

describe('路径', () => {
  it('数据目录用完整包名,scope 自然成两级', () => {
    expect(packageDir('D:/home', '@godcreator02/gwb-shell')).toBe(
      path.join('D:/home', 'data', '@godcreator02', 'gwb-shell'),
    )
    expect(packageDir('D:/home', 'plain')).toBe(path.join('D:/home', 'data', 'plain'))
  })

  it('文档落成同名 .json', () => {
    expect(docFileIn('D:/dir', 'layout')).toBe(path.join('D:/dir', 'layout.json'))
  })

  it('坏名字算不出路径', () => {
    expect(() => packageDir('D:/home', '../evil')).toThrow()
    expect(() => docFileIn('D:/dir', '../evil')).toThrow()
  })
})

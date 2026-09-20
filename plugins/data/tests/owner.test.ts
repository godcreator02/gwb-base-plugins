import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claimDir, listOwners, OWNER_FILE, readOwner, stampOwner } from '../src/owner.js'

let root: string
const warnings: string[] = []
const warn = (m: string): void => void warnings.push(m)

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-data-owner-'))
  warnings.length = 0
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('户主章', () => {
  it('没章的目录第一次被用就盖上——旧 home 里没章的目录谁先来归谁', () => {
    const dir = path.join(root, 'foo')
    claimDir(dir, '@a/gwb-foo')
    expect(readOwner(dir)).toBe('@a/gwb-foo')
  })

  it('目录原本有数据、没章：照样盖章，数据不动', () => {
    const dir = path.join(root, 'foo')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'layout.json'), '{"a":1}')
    claimDir(dir, '@a/gwb-foo')
    expect(readOwner(dir)).toBe('@a/gwb-foo')
    expect(fs.readFileSync(path.join(dir, 'layout.json'), 'utf8')).toBe('{"a":1}')
  })

  it('章是自己的放行', () => {
    const dir = path.join(root, 'foo')
    claimDir(dir, '@a/gwb-foo')
    expect(() => claimDir(dir, '@a/gwb-foo')).not.toThrow()
  })

  it('scope 不同、短名相同的包拿不到别人的目录——这就是要挡的事故', () => {
    const dir = path.join(root, 'foo')
    claimDir(dir, '@a/gwb-foo')
    expect(() => claimDir(dir, '@b/foo')).toThrow(/@a\/gwb-foo/)
    expect(readOwner(dir)).toBe('@a/gwb-foo')
  })

  it('章坏了当场抛，不当没章——当没章等于谁都能认领', () => {
    const dir = path.join(root, 'foo')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, OWNER_FILE), '{ 坏了')
    expect(() => claimDir(dir, '@b/foo')).toThrow(/认不出来/)
    fs.writeFileSync(path.join(dir, OWNER_FILE), '{"pkg":""}')
    expect(() => readOwner(dir)).toThrow()
  })

  it('过户直接换章', () => {
    const dir = path.join(root, 'foo')
    claimDir(dir, '@a/gwb-plugins')
    stampOwner(dir, '@a/gwb-plugin-manager')
    expect(() => claimDir(dir, '@a/gwb-plugin-manager')).not.toThrow()
    expect(() => claimDir(dir, '@a/gwb-plugins')).toThrow()
  })

  it('章文件名不会跟文档撞——文档名是 kebab-case，没有点', () => {
    expect(OWNER_FILE.startsWith('.')).toBe(true)
  })
})

describe('列户主', () => {
  it('按目录名列，没章的不列', async () => {
    claimDir(path.join(root, 'foo'), '@a/gwb-foo')
    claimDir(path.join(root, 'foo-2'), '@b/foo')
    fs.mkdirSync(path.join(root, 'bare'))
    expect(await listOwners(root, warn)).toEqual({ foo: '@a/gwb-foo', 'foo-2': '@b/foo' })
  })

  it('章坏了的不列，但要 warn', async () => {
    fs.mkdirSync(path.join(root, 'foo'))
    fs.writeFileSync(path.join(root, 'foo', OWNER_FILE), 'x')
    expect(await listOwners(root, warn)).toEqual({})
    expect(warnings).toHaveLength(1)
  })

  it('还没有 data 目录：空表', async () => {
    expect(await listOwners(path.join(root, 'nope'), warn)).toEqual({})
  })
})

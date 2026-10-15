import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyArgs, credentialSlot, generateArgs, importArgs, readCopiedCredential, readImportedCredential } from '../src/credentials.js'
import { writeSettings } from '../src/store.js'

let dir: string
const fake = 'fake-import-credential-012345'

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-credentials-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('凭据操作参数边界', () => {
  const to = { section: 'example', key: 'token' }

  it.each(['../default', 'C:/homes/default', 'a/b', 'a\\b', '..', ''])('跨 home 只接受名字，拒绝路径 %s', (home) => {
    expect(() => copyArgs({ from: { ...to, home }, to })).toThrow('只接受 home 名字')
  })

  it.each(['__proto__', 'constructor', 'prototype'])('拒绝原型字段 %s，既不能作槽位也不能作 JSON 路径', (key) => {
    expect(() => credentialSlot({ section: 'example', key })).toThrow()
    expect(() => credentialSlot({ section: key, key: 'token' })).toThrow()
    expect(() => importArgs({ from: { file: path.join(dir, 'source'), format: 'json', path: [key] }, to })).toThrow('JSON 字段路径')
  })

  it('槽位的键收 kebab-case 与一组设置派生的三段键，别的点号写法都拒绝', () => {
    expect(credentialSlot({ section: 'example', key: 'models.deepseek.token' })).toEqual({ section: 'example', key: 'models.deepseek.token' })
    for (const key of ['models.deepseek', 'a.b.c.d', 'models..token', 'models.DeepSeek.token', '.models.a']) {
      expect(() => credentialSlot({ section: 'example', key })).toThrow('有效的设置键')
    }
  })

  it('未知字段不回显内容，overwrite 必须是显式 boolean', () => {
    let message = ''
    try { copyArgs({ from: to, to, [fake]: fake }) } catch (error) { message = String(error) }
    expect(message).not.toContain(fake)
    expect(message).toContain('不支持的字段')
    expect(() => copyArgs({ from: to, to, overwrite: 'true' })).toThrow('boolean')
    expect(copyArgs({ from: to, to }).overwrite).toBe(false)
    expect(copyArgs({ from: to, to, overwrite: true }).overwrite).toBe(true)
  })

  it('导入文件必须是绝对路径，text 不接受字段选择', () => {
    expect(() => importArgs({ from: { file: 'relative.json', format: 'json' }, to })).toThrow('绝对路径')
    expect(() => importArgs({ from: { file: path.join(dir, 'source'), format: 'text', path: ['token'] }, to })).toThrow('text 导入不接受 path')
  })

  it.each([0, 15, 129, 16.5, '32', null])('拒绝无效随机字节数 %s', (bytes) => {
    expect(() => generateArgs({ to, bytes })).toThrow('16 到 128')
  })
})

describe('导入与复制只读取点名来源', () => {
  it('JSON 的 BOM、嵌套数组路径和字符串根值可读，来源文件保持原样', () => {
    const file = path.join(dir, 'source.json')
    const contents = `\uFEFF${JSON.stringify({ accounts: [{ token: fake }] })}`
    fs.writeFileSync(file, contents)
    expect(readImportedCredential({ file, format: 'json', path: ['accounts', '0', 'token'] })).toBe(fake)
    expect(fs.readFileSync(file, 'utf8')).toBe(contents)
    fs.writeFileSync(file, JSON.stringify(fake))
    expect(readImportedCredential({ file, format: 'json' })).toBe(fake)
  })

  it.each(['', ' \r\n', JSON.stringify({ token: 123 }), JSON.stringify({ token: null }), JSON.stringify({ token: { secret: fake } })])('空值或非字符串值拒绝，错误不包含内容 %#', (contents) => {
    const file = path.join(dir, 'source.json')
    fs.writeFileSync(file, contents)
    let message = ''
    try { readImportedCredential({ file, format: 'json', path: ['token'] }) } catch (error) { message = String(error) }
    expect(message).not.toBe('')
    expect(message).not.toContain(fake)
    expect(fs.readFileSync(file, 'utf8')).toBe(contents)
  })

  it('文本去掉一个文件末尾换行，保留凭据自身前后空格', () => {
    const file = path.join(dir, 'source.txt')
    fs.writeFileSync(file, ` ${fake} \r\n`)
    expect(readImportedCredential({ file, format: 'text' })).toBe(` ${fake} `)
    fs.writeFileSync(file, ' \t\r\n')
    expect(() => readImportedCredential({ file, format: 'text' })).toThrow('非空的凭据字符串')
  })

  it('不读取目录、不存在文件或超过 1 MiB 的来源', () => {
    expect(() => readImportedCredential({ file: dir, format: 'text' })).toThrow('普通文件')
    expect(() => readImportedCredential({ file: path.join(dir, 'missing'), format: 'text' })).toThrow('无法读取')
    const file = path.join(dir, 'large')
    fs.writeFileSync(file, Buffer.alloc(1024 * 1024 + 1, 65))
    expect(() => readImportedCredential({ file, format: 'text' })).toThrow('1 MiB')
  })

  it('来源路径不存在时不读原型属性，返回固定错误', () => {
    const file = path.join(dir, 'source.json')
    fs.writeFileSync(file, JSON.stringify({ token: fake }))
    expect(() => readImportedCredential({ file, format: 'json', path: ['missing'] })).toThrow('没有指定的 JSON 字段')
    expect(() => readImportedCredential({ file, format: 'json', path: ['toString'] })).toThrow('没有指定的 JSON 字段')
  })

  it('同 home 来源走服务内存，未声明 secret 的普通值不能复制', () => {
    const settingsFile = path.join(dir, 'current', 'settings.json')
    const from = { section: 'example', key: 'token' }
    const readLocal = vi.fn(() => fake)
    const statusLocal = () => ({ ...from, secret: true, isSet: true, live: true })
    expect(readCopiedCredential(settingsFile, from, readLocal, statusLocal)).toBe(fake)
    expect(readCopiedCredential(settingsFile, { ...from, home: 'current' }, readLocal, statusLocal)).toBe(fake)
    expect(() => readCopiedCredential(settingsFile, from, readLocal, () => ({ ...from, secret: false, isSet: true, live: true }))).toThrow('来源必须是 secret')
    expect(readLocal).toHaveBeenCalledTimes(2)
  })

  it('跨 home 可读取未迁移的旧 secret，但不会迁移或改写来源文件', async () => {
    const sourceDir = path.join(dir, 'source')
    fs.mkdirSync(sourceDir)
    const sourceFile = path.join(sourceDir, 'settings.json')
    const contents = JSON.stringify({ example: { token: { type: 'secret', value: fake } } })
    fs.writeFileSync(sourceFile, contents)
    const readLocal = vi.fn()
    expect(readCopiedCredential(path.join(dir, 'current', 'settings.json'), { home: 'source', section: 'example', key: 'token' }, readLocal, () => undefined)).toBe(fake)
    expect(readLocal).not.toHaveBeenCalled()
    expect(fs.readFileSync(sourceFile, 'utf8')).toBe(contents)
    expect(fs.existsSync(path.join(sourceDir, 'credentials.json'))).toBe(false)
    await writeSettings(sourceFile, { sections: { example: { ordinary: { type: 'string', value: fake } } }, owners: {} })
    expect(() => readCopiedCredential(path.join(dir, 'current', 'settings.json'), { home: 'source', section: 'example', key: 'ordinary' }, readLocal, () => undefined)).toThrow('没有指定的 secret')
  })
})

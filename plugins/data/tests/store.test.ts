import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readDoc, writeDoc } from '../src/store.js'

let dir: string
const warnings: string[] = []
const warn = (m: string): void => void warnings.push(m)

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-data-'))
  warnings.length = 0
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('readDoc 三档', () => {
  it('没这份文档:回 undefined,不吭声', async () => {
    expect(await readDoc(dir, 'layout', warn)).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('有:原样读回来', async () => {
    await writeDoc(dir, 'layout', { panes: ['a', 'b'], n: 1 })
    expect(await readDoc(dir, 'layout', warn)).toEqual({ panes: ['a', 'b'], n: 1 })
    expect(warnings).toEqual([])
  })

  it('坏了:回 undefined 但**要 warn**——悄悄变成「用默认值」是最难查的那种', async () => {
    fs.writeFileSync(path.join(dir, 'layout.json'), '{ 这不是 json')
    expect(await readDoc(dir, 'layout', warn)).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('layout.json')
  })
})

describe('writeDoc', () => {
  it('目录不存在就建出来——懒建,装了没用过的件不该在盘上留空目录', async () => {
    const deep = path.join(dir, 'data', '@scope', 'name')
    expect(fs.existsSync(deep)).toBe(false)
    await writeDoc(deep, 'layout', { ok: true })
    expect(await readDoc(deep, 'layout', warn)).toEqual({ ok: true })
  })

  it('整份替换,不是合并', async () => {
    await writeDoc(dir, 'layout', { a: 1, b: 2 })
    await writeDoc(dir, 'layout', { a: 9 })
    expect(await readDoc(dir, 'layout', warn)).toEqual({ a: 9 })
  })

  it('写完不留临时文件', async () => {
    await writeDoc(dir, 'layout', { ok: true })
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('序列化不了时当场抛,而且不留下半个文件', async () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    await expect(writeDoc(dir, 'layout', cyclic)).rejects.toThrow()
    expect(fs.existsSync(path.join(dir, 'layout.json'))).toBe(false)
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('覆盖失败不会毁掉原来那份——原子落盘的意义就在这', async () => {
    await writeDoc(dir, 'layout', { keep: 'me' })
    // 拿目录顶住目标路径：rename 必失败
    const blocked = path.join(dir, 'blocked.json')
    fs.mkdirSync(blocked)
    await expect(writeDoc(dir, 'blocked', { x: 1 })).rejects.toThrow()
    // 原来那份完好，临时文件也收干净了
    expect(await readDoc(dir, 'layout', warn)).toEqual({ keep: 'me' })
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('坏文档名进不来', async () => {
    await expect(writeDoc(dir, '../escape', { x: 1 })).rejects.toThrow()
  })
})

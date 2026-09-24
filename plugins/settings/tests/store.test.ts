import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSettings, writeSettings } from '../src/store.js'

let dir: string
const warnings: string[] = []
const warn = (m: string): void => void warnings.push(m)

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-settings-'))
  warnings.length = 0
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('一份文件两半', () => {
  it('写出去读回来：分区与户主表各归各', async () => {
    const file = path.join(dir, 'settings.json')
    const home = { sections: { alice: { level: { value: 'debug' } } }, owners: { alice: '@a/alice' } }
    await writeSettings(file, home)
    expect(readSettings(file, warn)).toEqual(home)
    expect(warnings).toEqual([])
  })

  it('户主表落在文件顶层 $owners 下', async () => {
    const file = path.join(dir, 'settings.json')
    await writeSettings(file, { sections: {}, owners: { alice: '@a/alice' } })
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ $owners: { alice: '@a/alice' } })
  })

  it('没有户主表的旧文件照读，户主表是空的', () => {
    const file = path.join(dir, 'settings.json')
    fs.writeFileSync(file, JSON.stringify({ alice: { level: { value: 1 } } }))
    expect(readSettings(file, warn)).toEqual({ sections: { alice: { level: { value: 1 } } }, owners: {} })
  })

  it('没文件：两半都空', () => {
    expect(readSettings(path.join(dir, 'nope.json'), warn)).toEqual({ sections: {}, owners: {} })
  })
})

describe('同一个文件同时写好几次', () => {
  it('都写成功，最后发起的那次留在文件里，不留临时文件', async () => {
    const file = path.join(dir, 'settings.json')
    const homes = Array.from({ length: 20 }, (_, index) => ({ sections: { alice: { round: { value: index } } }, owners: {} }))
    await Promise.all(homes.map((home) => writeSettings(file, home)))
    expect(readSettings(file, warn)).toEqual(homes.at(-1))
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})

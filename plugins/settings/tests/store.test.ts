import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSettings, writeSettings } from '../src/store.js'

let dir: string
const warnings: string[] = []
const warn = (m: string): void => void warnings.push(m)

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-settings-'))
  warnings.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('每个 home 的凭据保管', () => {
  const secret = 'fake-test-credential-do-not-echo'
  const withSecret = (value?: string) => ({
    sections: { alice: { token: { title: 'Token', type: 'secret', ...(value === undefined ? {} : { value }) }, level: { value: 'info' } } },
    owners: { alice: '@a/alice' },
  })
  const jsonAt = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8')) as unknown

  it('旧文件可读；写入后明文只在 credentials，重启读取仍合并为原值', async () => {
    const file = path.join(dir, 'settings.json')
    const home = withSecret(secret)
    fs.writeFileSync(file, JSON.stringify({ $owners: home.owners, ...home.sections }))
    expect(readSettings(file, warn)).toEqual(home)
    expect(fs.existsSync(path.join(dir, 'credentials.json'))).toBe(false)
    await writeSettings(file, readSettings(file, warn))
    expect(fs.readFileSync(file, 'utf8')).not.toContain(secret)
    expect(jsonAt(file)).toEqual({ $owners: home.owners, ...withSecret().sections })
    expect(jsonAt(path.join(dir, 'credentials.json'))).toEqual({ version: 1, sections: { alice: { token: { value: secret } } } })
    expect(readSettings(file, warn)).toEqual(home)
  })

  it('删除保留空槽；旧 settings 尚未清理时也不会复活旧凭据', async () => {
    const file = path.join(dir, 'settings.json')
    const home = withSecret(secret)
    fs.writeFileSync(file, JSON.stringify({ $owners: home.owners, ...home.sections }))
    const rename = fs.promises.rename.bind(fs.promises)
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (to === file) throw new Error(`mock failure ${secret}`)
      await rename(from, to)
    })
    await expect(writeSettings(file, withSecret())).rejects.toThrow('settings.json 写入失败')
    expect(fs.readFileSync(file, 'utf8')).toContain(secret)
    expect(jsonAt(path.join(dir, 'credentials.json'))).toEqual({ version: 1, sections: { alice: { token: {} } } })
    expect(readSettings(file, warn)).toEqual(withSecret())
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('凭据先写成功、settings 未写成功时，值仍被识别为 secret', async () => {
    const file = path.join(dir, 'settings.json')
    const rename = fs.promises.rename.bind(fs.promises)
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (to === file) throw new Error(`mock failure ${secret}`)
      await rename(from, to)
    })
    await expect(writeSettings(file, withSecret(secret))).rejects.toThrow('settings.json 写入失败')
    expect(fs.existsSync(file)).toBe(false)
    expect(readSettings(file, warn).sections).toEqual({ alice: { token: { type: 'secret', value: secret } } })
  })

  it('同名凭据按 home 隔离，空 home 不继承 default', async () => {
    const first = path.join(dir, 'default', 'settings.json')
    const second = path.join(dir, 'test-home', 'settings.json')
    await writeSettings(first, withSecret(secret))
    expect(readSettings(second, warn)).toEqual({ sections: {}, owners: {} })
    await writeSettings(second, withSecret('other-fake-credential'))
    expect(readSettings(first, warn)).toEqual(withSecret(secret))
    expect(readSettings(second, warn)).toEqual(withSecret('other-fake-credential'))
  })

  it.each([
    `{"version":1,"sections": ${secret}`,
    JSON.stringify({ version: 2, sections: { alice: { token: { value: secret } } } }),
    JSON.stringify({ version: 1, sections: { alice: { token: secret } } }),
  ])('凭据损坏必须拒绝读取和覆盖，不回显损坏内容 %#', async (broken) => {
    const file = path.join(dir, 'settings.json')
    const credentialFile = path.join(dir, 'credentials.json')
    fs.writeFileSync(file, JSON.stringify({ $owners: {}, alice: { level: { value: 'original' } } }))
    fs.writeFileSync(credentialFile, broken)
    const originalSettings = fs.readFileSync(file, 'utf8')
    let message = ''
    try { readSettings(file, warn) } catch (error) { message = String(error) }
    expect(message).toContain('credentials.json')
    expect(message).not.toContain(secret)
    await expect(writeSettings(file, withSecret('new-fake-value'))).rejects.toThrow('credentials.json')
    expect(fs.readFileSync(credentialFile, 'utf8')).toBe(broken)
    expect(fs.readFileSync(file, 'utf8')).toBe(originalSettings)
    expect(warnings.join('\n')).not.toContain(secret)
  })

  it('凭据文件 I/O 错误不能当作空凭据覆盖', async () => {
    const file = path.join(dir, 'settings.json')
    fs.mkdirSync(path.join(dir, 'credentials.json'))
    expect(() => readSettings(file, warn)).toThrow('credentials.json 读取失败')
    await expect(writeSettings(file, withSecret(secret))).rejects.toThrow('credentials.json 读取失败')
    expect(fs.existsSync(file)).toBe(false)
    expect(fs.statSync(path.join(dir, 'credentials.json')).isDirectory()).toBe(true)
  })

  it('凭据落盘失败保留原两份文件，隐藏底层错误内容且不堵住下一次写入', async () => {
    const file = path.join(dir, 'settings.json')
    const credentialFile = path.join(dir, 'credentials.json')
    await writeSettings(file, withSecret(secret))
    const originalSettings = fs.readFileSync(file, 'utf8')
    const originalCredentials = fs.readFileSync(credentialFile, 'utf8')
    const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error(`mock secret ${secret}`))
    let message = ''
    try { await writeSettings(file, withSecret('replacement')) } catch (error) { message = String(error) }
    expect(message).toContain('credentials.json 写入失败')
    expect(message).not.toContain(secret)
    expect(fs.readFileSync(file, 'utf8')).toBe(originalSettings)
    expect(fs.readFileSync(credentialFile, 'utf8')).toBe(originalCredentials)
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
    rename.mockRestore()
    await writeSettings(file, withSecret('replacement'))
    expect(readSettings(file, warn)).toEqual(withSecret('replacement'))
  })

  it('旧凭据槽从整份设置删掉后仍留删除记录，不从残留旧文件恢复', async () => {
    const file = path.join(dir, 'settings.json')
    const credentialFile = path.join(dir, 'credentials.json')
    await writeSettings(file, withSecret(secret))
    await writeSettings(file, { sections: {}, owners: {} })
    fs.writeFileSync(file, JSON.stringify({ alice: { token: { type: 'secret', value: secret } } }))
    expect(jsonAt(credentialFile)).toEqual({ version: 1, sections: { alice: { token: {} } } })
    expect(readSettings(file, warn).sections.alice?.token).toEqual({ type: 'secret' })
  })

  it('序列化失败不回显凭据，也不创建文件', async () => {
    const file = path.join(dir, 'settings.json')
    const unsafe = { toJSON() { throw new Error(secret) } }
    let message = ''
    try {
      await writeSettings(file, { sections: { alice: { token: { type: 'secret', value: unsafe } } }, owners: {} })
    } catch (error) { message = String(error) }
    expect(message).toContain('序列化失败')
    expect(message).not.toContain(secret)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('旧 settings 解析告警不包含凭据，修复前拒绝持久化覆盖', async () => {
    const file = path.join(dir, 'settings.json')
    const broken = `{"alice":{"token":{"type":"secret","value":"${secret}`
    fs.writeFileSync(file, broken)
    expect(readSettings(file, warn)).toEqual({ sections: {}, owners: {} })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain(secret)
    await expect(writeSettings(file, withSecret('replacement'))).rejects.toThrow('settings.json 解析失败')
    expect(fs.readFileSync(file, 'utf8')).toBe(broken)
    expect(fs.existsSync(path.join(dir, 'credentials.json'))).toBe(false)
  })

  it('并发设置与删除按照发起顺序写入，删除后再次写入普通设置不会复活', async () => {
    const file = path.join(dir, 'settings.json')
    const homes = Array.from({ length: 20 }, (_, index) => withSecret(index % 2 === 0 ? `${secret}-${index}` : undefined))
    await Promise.all(homes.map((home) => writeSettings(file, home)))
    expect(readSettings(file, warn)).toEqual(withSecret())
    await writeSettings(file, readSettings(file, warn))
    expect(readSettings(file, warn)).toEqual(withSecret())
    expect(fs.readFileSync(path.join(dir, 'credentials.json'), 'utf8')).not.toContain(secret)
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('排队时内存再次变化不改变此前提交的快照', async () => {
    const file = path.join(dir, 'settings.json')
    const home = withSecret(secret)
    const writing = writeSettings(file, home)
    home.sections.alice.token.value = 'changed-after-call'
    await writing
    expect(readSettings(file, warn)).toEqual(withSecret(secret))
  })

  it('既有凭据不能被普通设置类型降级回明文文件', async () => {
    const file = path.join(dir, 'settings.json')
    await writeSettings(file, withSecret(secret))
    const downgraded = withSecret(secret)
    downgraded.sections.alice.token.type = 'string'
    await writeSettings(file, downgraded)
    expect(readSettings(file, warn)).toEqual(withSecret(secret))
    expect(fs.readFileSync(file, 'utf8')).not.toContain(secret)
  })
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

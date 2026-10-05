import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpCredentials, CLIENT_TOKENS_KEY, clientTokenLifetime } from '../src/credentials.js'
import { gateRequest } from '../src/auth.js'

let home: string
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-mcp-credentials-')) })
afterEach(() => { vi.useRealTimers(); fs.rmSync(home, { recursive: true, force: true }) })

function settings(values: Record<string, unknown> = {}) {
  return {
    get: (key: string) => values[key],
    set: vi.fn(async (key: string, value: unknown) => { values[key] = value }),
  }
}

function legacyToken(token: string): string {
  const file = path.join(home, 'mcp', 'secret.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ token }))
  return file
}

describe('MCP 凭据迁入 settings', () => {
  it('不同home首次生成独立凭据；同一home重新初始化仍使用已保存值', async () => {
    const otherHome = path.join(home, 'other')
    fs.mkdirSync(otherHome)
    const firstStore = settings()
    const first = new McpCredentials(firstStore, home)
    const other = new McpCredentials(settings(), otherHome)
    await first.initialize()
    await other.initialize()
    expect(first.token).not.toBe(other.token)
    expect(first.token.length).toBeGreaterThanOrEqual(16)
    const restarted = new McpCredentials(firstStore, home)
    await restarted.initialize()
    expect(restarted.token).toBe(first.token)
    expect(fs.existsSync(path.join(home, 'mcp', 'secret.json'))).toBe(false)
  })

  it('迁入保留当前token，持久化成功后才删除legacy；再次启动不换', async () => {
    const oldFile = legacyToken('old-token-abcdefghijklmnop')
    const store = settings()
    const first = new McpCredentials(store, home)
    await first.initialize()
    expect(first.token).toBe('old-token-abcdefghijklmnop')
    expect(fs.existsSync(oldFile)).toBe(false)
    const again = new McpCredentials(store, home)
    await again.initialize()
    expect(again.token).toBe(first.token)
    expect(store.set).toHaveBeenCalledTimes(1)
  })

  it('迁入落盘失败保留legacy；不通过返回值或错误摘录输出凭据', async () => {
    const oldFile = legacyToken('old-token-abcdefghijklmnop')
    const store = settings()
    store.set.mockRejectedValue(new Error('磁盘满'))
    await expect(new McpCredentials(store, home).initialize()).rejects.toThrow('磁盘满')
    expect(fs.existsSync(oldFile)).toBe(true)
  })

  it('新的settings值优先；清理遗留副本，删除后再启动不会复活旧token', async () => {
    const oldFile = legacyToken('old-token-abcdefghijklmnop')
    const store = settings({ token: 'new-token-abcdefghijklmnop' })
    const credentials = new McpCredentials(store, home)
    await credentials.initialize()
    expect(credentials.token).toBe('new-token-abcdefghijklmnop')
    expect(fs.existsSync(oldFile)).toBe(false)
    await store.set('token', undefined)
    expect(credentials.token).toBe('')
    await credentials.initialize()
    expect(credentials.token).not.toBe('old-token-abcdefghijklmnop')
    expect(credentials.token).not.toBe('new-token-abcdefghijklmnop')
  })

  it('坏文件不被默默换发，错误不包含原文', async () => {
    const oldFile = legacyToken('old-token-abcdefghijklmnop')
    fs.writeFileSync(oldFile, '{"token":"test-secret-do-not-output"')
    await expect(new McpCredentials(settings(), home).initialize()).rejects.toThrow('旧 MCP 凭据文件损坏')
    expect(fs.readFileSync(oldFile, 'utf8')).toContain('test-secret-do-not-output')
  })
})

describe('独立临时凭据', () => {
  it('显式期限是整数且不接受客户端文件参数', () => {
    for (const raw of [undefined, {}, { expiresInSeconds: 0 }, { expiresInSeconds: 1.5 }, { expiresInSeconds: 31_536_001 }, { expiresInSeconds: '60' }, { expiresInSeconds: 60, file: 'client.json' }]) {
      expect(() => clientTokenLifetime(raw)).toThrow()
    }
    expect(clientTokenLifetime({ expiresInSeconds: 1 })).toBe(1)
    expect(clientTokenLifetime({ expiresInSeconds: 31_536_000 })).toBe(31_536_000)
  })

  it('持久化失败不回成功编号，不产生临时凭据或客户端文件', async () => {
    const store = settings({ token: 'main-token-abcdefghijklmnop' })
    store.set.mockRejectedValue(new Error('磁盘满'))
    const credentials = new McpCredentials(store, home)
    await expect(credentials.issue(60)).rejects.toThrow('磁盘满')
    expect(credentials.clients).toEqual([])
    expect(fs.readdirSync(home)).toEqual([])
  })

  it('到期与撤销由鉴权端执行，主token轮换不影响独立临时token', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 5) })
    const store = settings({ token: 'main-token-abcdefghijklmnop' })
    const credentials = new McpCredentials(store, home)
    const issued = await credentials.issue(60)
    const client = credentials.clients[0]!
    const authorized = () => gateRequest({ port: 3001, token: credentials.token, clients: credentials.clients, headers: { host: '127.0.0.1:3001', authorization: `Bearer ${client.token}` } })
    expect(issued.id).toBe(client.id)
    expect(credentials.list()).toEqual([{ id: issued.id, expiresAt: issued.expiresAt, expired: false }])
    expect(JSON.stringify(issued)).not.toContain(client.token)
    expect(authorized()).toBeUndefined()
    await credentials.rotate()
    expect(authorized()).toBeUndefined()
    vi.advanceTimersByTime(60_000)
    expect(authorized()).toBeDefined()
    vi.setSystemTime(Date.now() - 1)
    expect(authorized()).toBeUndefined()
    expect(await credentials.revoke(client.id)).toEqual({ id: client.id, revoked: true })
    expect(authorized()).toBeDefined()
    expect(store.get(CLIENT_TOKENS_KEY)).toBe('[]')
    expect(await credentials.revoke(client.id)).toEqual({ id: client.id, revoked: false })
  })

  it('并发签发不互相覆盖，每个客户端均可单独撤销', async () => {
    const credentials = new McpCredentials(settings({ token: 'main-token-abcdefghijklmnop' }), home)
    const issued = await Promise.all([1, 2].map(() => credentials.issue(300)))
    expect(credentials.clients).toHaveLength(2)
    await credentials.revoke(issued[0]!.id!)
    expect(credentials.clients.map((row) => row.id)).toEqual([issued[1]!.id])
  })
})

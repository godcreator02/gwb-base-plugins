import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { GwbSettingsApi } from '@godcreator/gwb-settings'
import { mintToken, SECRET_DIR, SECRET_FILE, type ClientToken } from './auth.js'
import { isRecord } from './vocab.js'

export const TOKEN_KEY = 'token'
export const CLIENT_TOKENS_KEY = 'client-tokens'
type Settings = Pick<GwbSettingsApi, 'get' | 'set'>

export function clientTokenLifetime(raw: unknown): number {
  if (!isRecord(raw) || Object.keys(raw).some((key) => key !== 'expiresInSeconds')) throw new Error('参数只接受 expiresInSeconds')
  const value = raw.expiresInSeconds
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 31_536_000) throw new Error('expiresInSeconds 必须是 1 到 31536000 的整数')
  return value
}

function validToken(value: unknown): value is string { return typeof value === 'string' && value.length >= 16 }

/** 设置服务在本机内部供值；命令的输出只能取状态，不能序列化本对象。 */
export class McpCredentials {
  readonly file: string
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly settings: Settings, private readonly home: string) {
    this.file = path.join(home, 'credentials.json')
  }

  get token(): string {
    const token = this.settings.get(TOKEN_KEY)
    return validToken(token) ? token : ''
  }

  get clients(): ClientToken[] {
    const raw = this.settings.get(CLIENT_TOKENS_KEY)
    if (raw === undefined || raw === '') return []
    let rows: unknown
    try { rows = typeof raw === 'string' ? JSON.parse(raw) : undefined } catch { throw new Error('MCP 客户端凭据记录格式损坏') }
    if (!Array.isArray(rows) || !rows.every((row: unknown) => isRecord(row) && typeof row.id === 'string' && validToken(row.token) && typeof row.expiresAt === 'number' && Number.isFinite(row.expiresAt))) {
      throw new Error('MCP 客户端凭据记录格式损坏')
    }
    return rows as ClientToken[]
  }

  /** 成功持久化后才删除旧文件并开放入口；失败不丢弃旧凭据。 */
  async initialize(): Promise<void> {
    const legacy = path.join(this.home, SECRET_DIR, SECRET_FILE)
    if (this.token !== '') {
      try { fs.unlinkSync(legacy) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('旧 MCP 凭据文件无法清理')
      }
      return
    }
    let text: string | undefined
    try { text = fs.readFileSync(legacy, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('旧 MCP 凭据文件无法读取')
    }
    let doc: unknown
    if (text !== undefined && text.trim() !== '') {
      try { doc = JSON.parse(text) } catch { throw new Error('旧 MCP 凭据文件损坏；未覆盖或换发凭据') }
      if (!isRecord(doc) || !validToken(doc.token)) throw new Error('旧 MCP 凭据文件缺少有效 token；未覆盖或换发凭据')
    }
    await this.settings.set(TOKEN_KEY, isRecord(doc) ? doc.token : mintToken())
    if (text !== undefined) fs.unlinkSync(legacy)
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work)
    this.queue = run.catch(() => undefined)
    return run
  }

  rotate(): Promise<void> { return this.exclusive(() => this.settings.set(TOKEN_KEY, mintToken())) }

  list(): { id: string; expiresAt: string; expired: boolean }[] {
    const now = Date.now()
    return this.clients.map(({ id, expiresAt }) => ({ id, expiresAt: new Date(expiresAt).toISOString(), expired: expiresAt <= now }))
  }

  issue(expiresInSeconds: number): Promise<{ id: string; expiresAt: string }> {
    return this.exclusive(async () => {
      clientTokenLifetime({ expiresInSeconds })
      const clients = this.clients
      const issued: ClientToken = { id: randomUUID(), token: mintToken(), expiresAt: Date.now() + expiresInSeconds * 1000 }
      await this.settings.set(CLIENT_TOKENS_KEY, JSON.stringify([...clients, issued]))
      return { id: issued.id, expiresAt: new Date(issued.expiresAt).toISOString() }
    })
  }

  revoke(id: string): Promise<{ id: string; revoked: boolean }> {
    return this.exclusive(async () => {
      const clients = this.clients
      const retained = clients.filter((client) => client.id !== id)
      if (retained.length === clients.length) return { id, revoked: false }
      await this.settings.set(CLIENT_TOKENS_KEY, JSON.stringify(retained))
      return { id, revoked: true }
    })
  }
}

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// MCP 入口的随机凭据生成与请求检查；保管与迁移统一在 credentials.ts 经 settings 完成。

/** 旧凭据文件的位置，只用于迁入 settings。 */
export const SECRET_DIR = 'mcp'

export const SECRET_FILE = 'secret.json'

/** 客户端带 token 的请求头 */
export const TOKEN_HEADER = 'authorization'

/** 请求头里 token 的前缀 */
export const TOKEN_SCHEME = 'Bearer'

/** 环境变量名：命令行客户端与 MCP 客户端都认这一个 */
export const TOKEN_ENV = 'GWB_MCP_TOKEN'

/** 沙箱化 iframe 与本地文件页面带的 Origin 值 */
const NULL_ORIGIN = 'null'

/** 32 字节随机、base64url：这份 token 会出现在客户端配置、命令行参数、环境变量里，`+/=` 在 shell 里要转义 */
export function mintToken(): string {
  return randomBytes(32).toString('base64url')
}

/** 先各自过一遍 SHA-256 再比：`timingSafeEqual` 对长度不等直接抛，靠长度做前置判断会泄露长度 */
function sameToken(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest()
  const digestB = createHash('sha256').update(b).digest()
  return timingSafeEqual(digestA, digestB)
}

/**
 * 从请求头里取 token。认 `Authorization: Bearer <token>`；也认只写一个值
 * （有的客户端的请求头配置只写得下一格，用户会直接填 token）
 */
export function bearerIn(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  // `.+` 保证捕获组一定在；`?? ''` 只为类型收窄
  const match = /^Bearer\s+(.+)$/i.exec(trimmed)
  return match === null ? trimmed : (match[1] ?? '').trim()
}

/** 同名请求头来了两条时值是数组，只看第一条 */
function firstHeaderValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw
}

/** 入口只绑 127.0.0.1，能来的只有这两个 host 名加端口 */
export function allowedHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`]
}

/** 入口允许的 Origin：它自己的两个回环写法。没有「空表＝不校验」这种默认 */
export function allowedOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
}

/** 检查的结果。`refused` 是要写进日志的原因 */
export type GateVerdict = { refused: string } | undefined

export interface ClientToken { id: string; token: string; expiresAt: number }

/**
 * token、Host、Origin 三项检查，在派发任何请求之前调。
 * 不带 `Origin` 的非浏览器客户端照常放行，它们要过的是 token；`Origin: null` 不认
 */
export function gateRequest(input: {
  headers: Record<string, string | string[] | undefined>
  token: string
  port: number
  clients?: readonly ClientToken[]
  now?: number
}): GateVerdict {
  const { headers, token, port } = input

  const given = bearerIn(headers[TOKEN_HEADER])
  if (given === undefined) return { refused: '没带 Authorization 头' }
  const now = input.now ?? Date.now()
  const clientAccepted = (input.clients ?? []).some((client) => client.expiresAt > now && sameToken(given, client.token))
  if (!(token !== '' && sameToken(given, token)) && !clientAccepted) return { refused: 'Authorization 里的 token 对不上或已过期' }

  const host = firstHeaderValue(headers.host)
  if (host === undefined || !allowedHosts(port).includes(host)) {
    return { refused: `Host 不在允许名单里（收到 ${host ?? '(空)'}）` }
  }

  const origin = firstHeaderValue(headers.origin)
  if (origin !== undefined && (origin === NULL_ORIGIN || !allowedOrigins(port).includes(origin))) {
    return { refused: `Origin 不在允许名单里（收到 ${origin}）` }
  }

  return undefined
}

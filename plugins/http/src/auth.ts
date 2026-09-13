import { randomBytes, timingSafeEqual } from 'node:crypto'
import { isRecord } from '@godcreator02/gwb-plugin-api'

/**
 * 鉴权原语。从 mcp 件原样继承（2026-09-13 门换代，纪律不动），从端点实现里抽出来于是可测。
 *
 * 纪律：token 首启生成（`randomBytes` 32 字节 → base64url 43 字符）落本件那格数据目录；
 * 逐请求 `timingSafeEqual` **定长**比较——长度先判，不让时序侧信道透出前缀。
 */

/** 生成 URL 安全的随机 token（256 位） */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/** 落 token 的那一格。收窄到用得着的两个方法——`ctx.gwbData` 满足它，测试给个替身也满足 */
export interface TokenStore {
  readDoc(doc: string): Promise<unknown>
  writeDoc(doc: string, value: unknown): Promise<void>
}

/**
 * 读或建 `token` 文档里的 token（已有且 ≥32 字符就沿用）。
 * 文档形状 `{ token, createdAt }`。
 */
export async function loadOrCreateToken(store: TokenStore): Promise<string> {
  const doc = await store.readDoc('token')
  const existing = isRecord(doc) ? doc.token : undefined
  if (typeof existing === 'string' && existing.length >= 32) return existing
  const token = generateToken()
  await store.writeDoc('token', { token, createdAt: new Date().toISOString() })
  return token
}

/**
 * 校验 Authorization 头。scheme 按 RFC 7235 大小写不敏感；比较走定长定时。
 * 头缺失 / scheme 不对 / token 变长或错值一律 false——**拒绝面不泄露任何信息**。
 */
export function bearerMatches(header: string | undefined, token: string): boolean {
  if (header === undefined) return false
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  if (match === null) return false
  const presented = Buffer.from(match[1] ?? '', 'utf8')
  const expected = Buffer.from(token, 'utf8')
  return presented.length === expected.length && timingSafeEqual(presented, expected)
}

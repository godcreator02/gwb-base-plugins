/**
 * `plugins.install` 回执里 `peers` 那一格 → 贴在窗格上的一行话。纯逻辑，不碰 DOM；形状按
 * node 半的 `PeerResult` 收，**不 import 那边的类型**（跨 IPC 过来的东西当 `unknown` 收窄，
 * 跟 `rows.ts` / `update-all.ts` 一个规矩）。
 *
 * **没装上的那几条要显形。** 装件时顺带装 peer 是件本身装成之后的一步，装不上不让整条
 * install 失败——那就意味着「绿色的成功提示」下面可能藏着一条件跑起来会扑空的依赖，
 * 所以这一行有失败时把整条提示压成红的。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface PeerView {
  /** 一条 peer 都没声明、或者认不出这一格时是空串——调用方按「没这回事」拼话 */
  line: string
  /** 有没有 peer 没装上 */
  ok: boolean
}

/** `peers` 那一格（外加 note 那句话）→ 一行。`raw` 是整份装机回执 */
export function describePeers(raw: unknown): PeerView {
  const data = isRecord(raw) ? raw : {}
  const list = Array.isArray(data['peers']) ? (data['peers'] as unknown[]) : []
  const pick = (action: string): string[] =>
    list
      .filter((item): item is Record<string, unknown> => isRecord(item) && item['action'] === action)
      .map((item) => (typeof item['pkg'] === 'string' ? item['pkg'] : ''))
      .filter((pkg) => pkg !== '')

  const installed = pick('installed')
  const failed = pick('failed')
  const stayed = pick('present').length + pick('skipped').length

  const parts: string[] = []
  if (installed.length > 0) parts.push(`装了 ${installed.join('、')}`)
  if (stayed > 0) parts.push(`${String(stayed)} 条本来就在或用不着装`)
  if (failed.length > 0) parts.push(`没装上 ${failed.join('、')}`)
  if (parts.length === 0) return { line: '', ok: true }
  return { line: `\nPeer：${parts.join('；')}`, ok: failed.length === 0 }
}

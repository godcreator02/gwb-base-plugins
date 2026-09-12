import type { CallResult } from './rows'

/**
 * `plugins.update-all` 的回执 → 贴在窗格上的那几行。纯逻辑，不碰 DOM；形状按 node 半的
 * `UpdateAllResult` 收，**不 import 那边的类型**（跨 IPC 过来的东西当 `unknown` 收窄，
 * 跟 rows.ts 一个规矩）。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export interface UpdateAllView {
  ok: boolean
  /** 贴上去的话，多行 */
  text: string
  /** 整页重载已经在路上（done / deferred）——窗格随时会没，busy 态别撤 */
  reloading: boolean
}

/** 一条条目那一行：`hello（remounted，ACTIVE）` */
function describeEntry(raw: unknown): string {
  if (!isRecord(raw)) return ''
  return `${str(raw['id'])}（${str(raw['action'])}，${str(raw['state'])}）`
}

export function describeUpdateAll(result: CallResult): UpdateAllView {
  const data = isRecord(result.data) ? result.data : {}
  if (!result.ok) {
    // 命令的信封里还套着一层回执（update-all 自己的 error/tail），同样不吞
    const tail = str(data['tail'])
    const detail = tail === '' ? '' : `\n${tail}`
    return { ok: false, text: `${result.error ?? '一键更新没成'}${detail}`, reloading: false }
  }
  const updated = Array.isArray(data['updated']) ? (data['updated'] as unknown[]) : []
  const lines: string[] = []
  if (updated.length === 0) {
    lines.push(str(data['note']) || '全都最新')
  } else {
    lines.push(`升了 ${updated.length} 个包：`)
    for (const item of updated) {
      if (!isRecord(item)) continue
      const entries = Array.isArray(item['entries']) ? (item['entries'] as unknown[]).map(describeEntry).filter((s) => s !== '') : []
      lines.push(`${str(item['pkg'])} ${str(item['from'])} → ${str(item['to'])}${entries.length > 0 ? `：${entries.join('、')}` : '（没挂条目）'}`)
    }
    if (data['selfDeferred'] === true) lines.push('插件管理件自己也升了：这一格随后先关再开')
    const reload = data['reload']
    if (reload === 'done') lines.push('界面已整页重载')
    else if (reload === 'deferred') lines.push('界面随后整页重载')
    const note = str(data['note'])
    if (note !== '') lines.push(note)
  }
  const reload = data['reload']
  return { ok: true, text: lines.join('\n'), reloading: reload === 'done' || reload === 'deferred' }
}

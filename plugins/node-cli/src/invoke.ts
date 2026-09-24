import fs from 'node:fs'
import path from 'node:path'

// `plugins/py-cli/src/invoke.ts` 是这份的副本，一字不差（除这一行）；改这份就要同步改那份

/** 一次调用能给的两样：追加参数，与按次的工作目录（原样带出，校验归 `checkCwd`） */
export interface Invocation {
  args: string[]
  cwd?: unknown
}

/**
 * 总线那头递来的参数：给一串就是追加参数；给 `{ args?, cwd? }` 也认；别的当空。
 * `cwd` 原样带出不收窄——给错了要让调用方看见一句拒绝，而不是静默当没给
 */
export function parseInvocation(raw?: unknown): Invocation {
  if (Array.isArray(raw)) return { args: raw.map(String) }
  if (typeof raw === 'object' && raw !== null) {
    const record = raw as { args?: unknown; cwd?: unknown }
    const args = Array.isArray(record.args) ? record.args.map(String) : []
    return 'cwd' in record ? { args, cwd: record.cwd } : { args }
  }
  return { args: [] }
}

export type CwdCheck = { ok: true; cwd: string | undefined } | { ok: false; error: string }

/** 按次给的 cwd：不给就用登记时的缺省；给了必须是存在的目录的绝对路径。不抛，错误文本回给调用方读 */
export function checkCwd(cwd: unknown, isDirectory: (p: string) => boolean = isExistingDirectory): CwdCheck {
  if (cwd === undefined) return { ok: true, cwd: undefined }
  if (typeof cwd !== 'string' || cwd === '') {
    return { ok: false, error: `cwd 要是一个字符串——存在的目录的绝对路径；给的是 ${describeNonString(cwd)}` }
  }
  if (!path.isAbsolute(cwd)) {
    return { ok: false, error: `cwd 要是绝对路径（这儿不知道该相对于谁），给的是：${cwd}` }
  }
  if (!isDirectory(cwd)) {
    return { ok: false, error: `cwd 得是一个存在的目录，这个不是（或不存在）：${cwd}` }
  }
  return { ok: true, cwd }
}

function describeNonString(value: unknown): string {
  return value === '' ? '空串' : typeof value
}

function isExistingDirectory(candidatePath: string): boolean {
  try {
    return fs.statSync(candidatePath).isDirectory()
  } catch {
    return false
  }
}

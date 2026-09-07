import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { findPnpmCjs, type LookupResult } from './pnpm-path.js'

/** 真去跑 pnpm。查盘与起进程都在这儿，纯逻辑那半在 `pnpm-path.ts` */

/** 出错时留几行尾巴回给调用方——pnpm 把原因放在最后几行 */
export const TAIL_LINES = 12

/** 输出在内存里最多留这么多字节。装一个大包的日志能有几 MB，全留着没意义 */
const MAX_TAIL_BYTES = 64_000

/**
 * 宿主是 electron 当 node 使起来的，所以 `process.execPath` 是 electron.exe——
 * 不带这个变量它会去开一扇窗，而不是跑那个 js。内核起宿主时同一个绕法。
 */
const ELECTRON_AS_NODE = '1'

export interface PnpmResult {
  /** 退出码 0 */
  ok: boolean
  exitCode: number | null
  /** 没成时才有：stdout 与 stderr 合起来的最后几行 */
  tail?: string
}

/** 取最后几行，两头的空行削掉。纯逻辑，单独测 */
export function tailLines(text: string, max = TAIL_LINES): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop()
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift()
  return lines.slice(-max).join('\n')
}

/** 查这台机器上的 pnpm.cjs。`configured` 是设置项 `pnpm-path` 的值 */
export function locatePnpm(configured?: string): LookupResult {
  return findPnpmCjs({
    configured,
    pathEnv: process.env['PATH'],
    delimiter: path.delimiter,
    sep: path.sep,
    platform: process.platform,
    exists: (file) => fs.existsSync(file),
  })
}

/**
 * 跑一趟 pnpm。**不抛**——起不来也收敛成一份回执，调用方只看 ok。
 *
 * **`spawn(process.execPath, [pnpm.cjs, ...])` 而不是 `spawn('pnpm')`**：Windows 上
 * PATH 里的 `pnpm.ps1` / `pnpm.cmd` 不是可执行映像，spawn 认不出；`shell: true` 能绕过去
 * 但会把引号转义的坑一起引进来。用**用户电脑上的 pnpm 包**加**我们自己的 node 运行时**，
 * 两边都不用赌。
 *
 * **不设超时**：装一个大包本来就可能几分钟，猜一个时限只会在慢网络上误杀一次正当的装机；
 * 网络那头的超时 pnpm 自己有。真卡住了，杀进程是用户那一侧的事。
 */
export function runPnpm(opts: { pnpmCjs: string; cwd: string; args: readonly string[] }): Promise<PnpmResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    const push = (chunk: Buffer): void => {
      chunks.push(chunk)
      size += chunk.length
      // 只保尾巴。整块整块地丢——切在多字节字符中间的风险留给最后那次 concat
      while (size > MAX_TAIL_BYTES && chunks.length > 1) size -= chunks.shift()!.length
    }
    const tail = (): string => tailLines(Buffer.concat(chunks).toString('utf8'))

    const proc = spawn(process.execPath, [opts.pnpmCjs, ...opts.args], {
      cwd: opts.cwd,
      // 全局 ~/.npmrc 的 scope 映射（@godcreator02 指着本机 Verdaccio）就是这么读到的
      env: { ...process.env, ELECTRON_RUN_AS_NODE: ELECTRON_AS_NODE },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let settled = false
    const done = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      // 成了就不留尾巴：那几十行「Progress: resolved 900」谁也不看
      resolve(exitCode === 0 ? { ok: true, exitCode } : { ok: false, exitCode, tail: tail() })
    }

    proc.stdout?.on('data', (c: Buffer) => push(c))
    proc.stderr?.on('data', (c: Buffer) => push(c))
    // 起不来（execPath 没了之类）：收成一份 exitCode null 的回执，原因进尾巴
    proc.on('error', (err) => {
      push(Buffer.from(`${String(err)}\n`, 'utf8'))
      done(null)
    })
    // close 而不是 exit：等两条管子都收完再回，不然尾巴可能缺最后一段——而原因正在那儿
    proc.on('close', (code) => done(code))
  })
}

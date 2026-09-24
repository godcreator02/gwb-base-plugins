import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// `plugins/py-cli/src/run.ts` 是这份的副本，一字不差（除这一行）；改这份就要同步改那份

/** 内存里留多少尾部。超过这个数就开始把全量写进临时文件 */
export const COLLECT_MAX_BYTES = 64_000

export interface CliStream {
  /** 尾部文本。`truncated` 为真时前面被截过 */
  text: string
  truncated: boolean
  /** 截过的时候才有：全量在这个文件里 */
  spillPath?: string
}

export interface CliRunResult {
  /** 退出码 0 且没超时 */
  ok: boolean
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  timeoutMs: number
  stdout: CliStream
  stderr: CliStream
  durationMs: number
}

export interface RunRequest {
  /** 可执行文件的绝对路径。node-cli 是 process.execPath，py-cli 是 venv 里的 exe */
  command: string
  args: readonly string[]
  cwd?: string
  /** 覆盖在 process.env 之上的几条 */
  env?: Record<string, string>
  timeoutMs: number
}

/** 只留尾部的收集器；一旦截过，就把全量边收边写进临时文件 */
class TailCollector {
  private tailChunks: Buffer[] = []
  private tailBytes = 0
  private truncated = false
  private spillPath: string | undefined
  private spillFd: number | undefined

  constructor(private readonly label: string) {}

  push(chunk: Buffer): void {
    if (this.spillFd !== undefined) fs.writeSync(this.spillFd, chunk)
    this.tailChunks.push(chunk)
    this.tailBytes += chunk.length
    if (this.tailBytes <= COLLECT_MAX_BYTES) return

    // 第一次超限时手里的就是至今的全量，一次写进临时文件
    if (this.spillFd === undefined) this.openSpillFileWithEverythingSoFar()
    this.truncated = true
    this.dropHeadBeyondLimit()
  }

  private dropHeadBeyondLimit(): void {
    while (this.tailBytes > COLLECT_MAX_BYTES) {
      const first = this.tailChunks[0]!
      if (this.tailBytes - first.length >= COLLECT_MAX_BYTES) {
        this.tailChunks.shift()
        this.tailBytes -= first.length
      } else {
        const cut = this.tailBytes - COLLECT_MAX_BYTES
        this.tailChunks[0] = first.subarray(cut)
        this.tailBytes -= cut
      }
    }
  }

  private openSpillFileWithEverythingSoFar(): void {
    try {
      const file = path.join(os.tmpdir(), `gwb-cli-${this.label}-${randomUUID()}.log`)
      const fd = fs.openSync(file, 'w')
      for (const chunk of this.tailChunks) fs.writeSync(fd, chunk)
      this.spillFd = fd
      this.spillPath = file
    } catch {
      // 写不了临时文件时照样给尾部，不因此让整条命令失败
    }
  }

  finish(): CliStream {
    if (this.spillFd !== undefined) {
      try {
        fs.closeSync(this.spillFd)
      } catch {
        /* 关闭失败不影响回执 */
      }
      this.spillFd = undefined
    }
    // 按字节截的，截点可能落在一个多字节字符中间，那个字符会变成 U+FFFD
    const text = Buffer.concat(this.tailChunks).toString('utf8')
    return this.truncated && this.spillPath !== undefined
      ? { text, truncated: true, spillPath: this.spillPath }
      : { text, truncated: this.truncated }
  }
}

function killProcessOnly(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    /* 进程已经结束 */
  }
}

/** Windows 上 `proc.kill()` 只结束直接子进程，所以用 taskkill `/T /F` 结束整棵树 */
function killProcessTree(pid: number): void {
  if (process.platform !== 'win32') {
    killProcessOnly(pid)
    return
  }
  const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  })
  // taskkill 启动失败或被拒绝（受限令牌下见过 Access denied）时，退回只结束直接子进程
  killer.on('error', () => killProcessOnly(pid))
  killer.on('exit', (code) => {
    if (code !== 0) killProcessOnly(pid)
  })
}

/** 运行一次。不抛——启动失败也收成一份回执，调用方只看 ok */
export function runProcess(req: RunRequest): Promise<CliRunResult> {
  const startedAt = Date.now()
  const stdoutTail = new TailCollector('out')
  const stderrTail = new TailCollector('err')

  return new Promise((resolve) => {
    let timedOut = false
    let settled = false

    const child = spawn(req.command, [...req.args], {
      cwd: req.cwd,
      env: { ...process.env, ...req.env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid !== undefined) killProcessTree(child.pid)
      else child.kill()
    }, req.timeoutMs)

    const settle = (exitCode: number | null, signal: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: exitCode === 0 && !timedOut,
        exitCode,
        signal,
        timedOut,
        timeoutMs: req.timeoutMs,
        stdout: stdoutTail.finish(),
        stderr: stderrTail.finish(),
        durationMs: Date.now() - startedAt,
      })
    }

    child.stdout?.on('data', (chunk: Buffer) => stdoutTail.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderrTail.push(chunk))

    // 启动失败（可执行文件不在之类）：收成 exitCode null 的回执，原因写进 stderr
    child.on('error', (spawnError) => {
      stderrTail.push(Buffer.from(`${String(spawnError)}\n`, 'utf8'))
      settle(null, null)
    })
    // 等 close 而不是 exit：两条管道都收完再回，不然尾部可能缺最后一段
    child.on('close', (code, signal) => settle(code, signal))
  })
}

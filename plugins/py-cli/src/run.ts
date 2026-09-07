import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 执行核：起一个进程、收输出、按时限收尾。不碰 ctx，所以能单独用、也好读。
 *
 * **`plugins/node-cli/src/run.ts` 是这份的正本，一字不差——有意的重复，不是漏抽。**
 * 件仓的运行时共享只有「做成包」一条路（node 半走 tsc 不打包，跨包相对 import 装出去
 * 就断），两个消费方还不够格开一个包。**出现第三个要跑进程的件时再抽**，判据见文档站。
 * 改那份就得同步改这份。
 *
 * 三条形状上的纪律，都是从 DSH 那套抄来的（见文档站）：
 * - **argv 全程数组，一次都不过 shell**——引号、空格、`&`、中文参数原样到达，不用转义
 * - **输出只保尾部**，超了把全量落一份临时文件、在回执里给路径。长输出不撑爆内存
 * - **超时要杀整棵树**——只杀直接子进程的话，孙子进程会变成零 CPU 的僵尸挂着占住目录
 */

/** 内存里保多少尾巴。超过这个数就开始落 spill 文件 */
export const COLLECT_MAX_BYTES = 64_000
/** SIGTERM 到强杀之间给多久 */
export const GRACE_MS = 3_000

export interface CliStream {
  /** 尾部文本。`truncated` 为真时前面被砍过 */
  text: string
  truncated: boolean
  /** 砍过的时候才有：全量落在这个文件里 */
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
  /** 可执行文件的绝对路径。node 那半是 process.execPath，py 那半是 venv 里的 exe */
  command: string
  args: readonly string[]
  cwd?: string
  /** 覆盖在 process.env 之上的几条 */
  env?: Record<string, string>
  timeoutMs: number
}

/**
 * 保尾部的收集器。一旦砍过，就把**全量**边收边写进一个临时文件——
 * 出错原因常常在被砍掉的那头，只留尾巴时人就没得查了。
 */
class TailCollector {
  private chunks: Buffer[] = []
  private size = 0
  private truncated = false
  private spillPath: string | undefined
  private spillFd: number | undefined

  constructor(private readonly label: string) {}

  push(chunk: Buffer): void {
    // spill 一旦开了就一直写:它存的是全量
    if (this.spillFd !== undefined) fs.writeSync(this.spillFd, chunk)
    this.chunks.push(chunk)
    this.size += chunk.length
    if (this.size <= COLLECT_MAX_BYTES) return

    // 第一次超限:开 spill,把此刻手里的（就是至今的全量）一次性写进去
    if (this.spillFd === undefined) this.openSpill()
    this.truncated = true
    while (this.size > COLLECT_MAX_BYTES) {
      const first = this.chunks[0]!
      if (this.size - first.length >= COLLECT_MAX_BYTES) {
        this.chunks.shift()
        this.size -= first.length
      } else {
        const cut = this.size - COLLECT_MAX_BYTES
        this.chunks[0] = first.subarray(cut)
        this.size -= cut
      }
    }
  }

  private openSpill(): void {
    try {
      const file = path.join(os.tmpdir(), `gwb-cli-${this.label}-${randomUUID()}.log`)
      const fd = fs.openSync(file, 'w')
      for (const c of this.chunks) fs.writeSync(fd, c)
      this.spillFd = fd
      this.spillPath = file
    } catch {
      // 落不下就算了——尾巴照给,不能因为写不了临时文件把整条命令弄失败
    }
  }

  finish(): CliStream {
    if (this.spillFd !== undefined) {
      try {
        fs.closeSync(this.spillFd)
      } catch {
        /* 关不上就算了 */
      }
      this.spillFd = undefined
    }
    // 尾巴从字节切的,切点可能落在一个多字节字符中间——那个字符会成 U+FFFD,认了
    const text = Buffer.concat(this.chunks).toString('utf8')
    return this.truncated && this.spillPath !== undefined
      ? { text, truncated: true, spillPath: this.spillPath }
      : { text, truncated: this.truncated }
  }
}

/**
 * 杀整棵进程树。
 *
 * Windows 上 `proc.kill()` 只结束直接子进程,孙子进程活下来变僵尸——DSH 实测残留过
 * 20 分钟,零 CPU 挂着占住目录,而那时父 pid 已经没了、事后再 taskkill 也找不到。
 * 所以这边**不发 SIGTERM 走两段**,直接 `/T` 整棵树 `/F` 强制。
 */
function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    // taskkill 拉不起或者拒绝时兜一手（DSH 在受限令牌下撞到过 Access denied）
    const fallback = (): void => {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* 已经没了 */
      }
    }
    killer.on('error', fallback)
    killer.on('exit', (code) => {
      if (code !== 0) fallback()
    })
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    /* 已经没了 */
  }
}

/** 跑一趟。**不抛**——起不来也收敛成一份回执，调用方只看 ok */
export function runProcess(req: RunRequest): Promise<CliRunResult> {
  const started = Date.now()
  const out = new TailCollector('out')
  const err = new TailCollector('err')

  return new Promise((resolve) => {
    let timedOut = false
    let settled = false

    const proc = spawn(req.command, [...req.args], {
      cwd: req.cwd,
      env: { ...process.env, ...req.env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timer = setTimeout(() => {
      timedOut = true
      if (proc.pid !== undefined) killProcessTree(proc.pid)
      else proc.kill()
    }, req.timeoutMs)

    const done = (exitCode: number | null, signal: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: exitCode === 0 && !timedOut,
        exitCode,
        signal,
        timedOut,
        timeoutMs: req.timeoutMs,
        stdout: out.finish(),
        stderr: err.finish(),
        durationMs: Date.now() - started,
      })
    }

    proc.stdout?.on('data', (c: Buffer) => out.push(c))
    proc.stderr?.on('data', (c: Buffer) => err.push(c))

    // 起不来（可执行文件不在之类）：收成一份 exitCode null 的回执,原因进 stderr
    proc.on('error', (e) => {
      err.push(Buffer.from(`${String(e)}\n`, 'utf8'))
      done(null, null)
    })
    // close 而不是 exit:等两条管子都收完再回,不然尾巴可能缺最后一段
    proc.on('close', (code, signal) => done(code, signal))
  })
}

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COLLECT_MAX_BYTES, runProcess } from '../src/run.js'

let workDir: string

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-py-cli-run-'))
})

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
})

/** 用 node 自己跑一段脚本：跑的是真进程，不经 shell */
const runNodeScript = (script: string, extra: { args?: string[]; cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}) =>
  runProcess({ command: process.execPath, args: ['-e', script, ...(extra.args ?? [])], cwd: extra.cwd, env: extra.env, timeoutMs: extra.timeoutMs ?? 20_000 })

describe('runProcess 跑一个真进程', () => {
  it('退出码 0 时 ok，收到 stdout 与 stderr', async () => {
    const result = await runNodeScript("process.stdout.write('出'); process.stderr.write('错')")
    expect(result).toMatchObject({ ok: true, exitCode: 0, signal: null, timedOut: false, timeoutMs: 20_000 })
    expect(result.stdout).toEqual({ text: '出', truncated: false })
    expect(result.stderr).toEqual({ text: '错', truncated: false })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('退出码非 0 时 ok 为 false，照回退出码', async () => {
    const result = await runNodeScript('process.exit(3)')
    expect(result).toMatchObject({ ok: false, exitCode: 3, timedOut: false })
  })

  it('参数原样到达：空格、引号、& 与中文都不经 shell 转义', async () => {
    const tricky = ['a b', '"quoted"', 'x & y', '中文 参数']
    const result = await runNodeScript('process.stdout.write(JSON.stringify(process.argv.slice(1)))', { args: tricky })
    expect(JSON.parse(result.stdout.text)).toEqual(tricky)
  })

  it('cwd 与 env 照给的用，env 覆盖在 process.env 之上', async () => {
    const result = await runNodeScript('process.stdout.write(JSON.stringify([process.cwd(), process.env.GWB_RUN_TEST, typeof process.env.PATH]))', {
      cwd: workDir,
      env: { GWB_RUN_TEST: '有' },
    })
    const [cwd, injected, pathType] = JSON.parse(result.stdout.text) as [string, string, string]
    expect(fs.realpathSync(cwd)).toBe(fs.realpathSync(workDir))
    expect(injected).toBe('有')
    expect(pathType).toBe('string')
  })

  it('超时就结束进程：timedOut 为真、ok 为 false', async () => {
    const result = await runNodeScript('setTimeout(() => {}, 60_000)', { timeoutMs: 300 })
    expect(result.timedOut).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.timeoutMs).toBe(300)
  })

  it('可执行文件不在：不抛，回 exitCode null 的回执，原因写进 stderr', async () => {
    const result = await runProcess({ command: path.join(workDir, 'no-such-exe'), args: [], timeoutMs: 5_000 })
    expect(result).toMatchObject({ ok: false, exitCode: null, timedOut: false })
    expect(result.stderr.text).not.toBe('')
  })

  it('输出超过上限只留尾部，全量写进临时文件并给出路径', async () => {
    const total = COLLECT_MAX_BYTES * 2
    const result = await runNodeScript(`process.stdout.write('a'.repeat(${total - 3}) + 'END')`)
    expect(result.stdout.truncated).toBe(true)
    expect(Buffer.byteLength(result.stdout.text)).toBe(COLLECT_MAX_BYTES)
    expect(result.stdout.text.endsWith('END')).toBe(true)
    const spillPath = result.stdout.spillPath!
    expect(fs.readFileSync(spillPath, 'utf8')).toHaveLength(total)
    fs.rmSync(spillPath)
  })
})

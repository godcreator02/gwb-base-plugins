import fs from 'node:fs'
import { execFile } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const { readHomeToken, readHomeUrl } = await import(new URL('../bin/client.mjs', import.meta.url).href) as {
  readHomeToken(this: void, directory: string): string | undefined
  readHomeUrl(this: void, directory: string, home: string): string | undefined
}

let directory: string
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-mcp-client-')) })
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }) })

function credentials(slot: unknown): void {
  fs.writeFileSync(path.join(directory, 'credentials.json'), JSON.stringify({ version: 1, sections: { mcp: { token: slot } } }))
}

describe('CLI 在本机内部取当前 home 凭据', () => {
  it('通过pnpm式目录链接启动真实CLI仍执行index握手与调用，不会空输出退出', async () => {
    const linkedBin = path.join(directory, 'linked-bin')
    fs.symlinkSync(fileURLToPath(new URL('../bin', import.meta.url)), linkedBin, process.platform === 'win32' ? 'junction' : 'dir')
    const methods: string[] = []
    const headers: (string | undefined)[] = []
    const server = http.createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { body += chunk })
      request.on('end', () => {
        const message = JSON.parse(body) as { id?: number; method: string }
        methods.push(message.method)
        headers.push(request.headers.authorization)
        if (message.id === undefined) { response.writeHead(202).end(); return }
        const result = message.method === 'initialize'
          ? { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fixture', version: '0' } }
          : { content: [{ type: 'text', text: JSON.stringify({ cliExecuted: true }) }] }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('测试HTTP入口没有监听')
      const result = await promisify(execFile)(process.execPath, [
        path.join(linkedBin, 'client.mjs'), '--url', `http://127.0.0.1:${address.port}/mcp`, '--token', 'fake-cli-token-abcdefghijklmnop', 'index',
      ], { timeout: 10_000 })
      expect(JSON.parse(result.stdout)).toEqual({ cliExecuted: true })
      expect(result.stderr).toBe('')
      expect(methods).toEqual(['initialize', 'notifications/initialized', 'tools/call'])
      expect(headers).toEqual(Array<string>(3).fill('Bearer fake-cli-token-abcdefghijklmnop'))
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      fs.unlinkSync(linkedBin)
    }
  })

  it('新存储优先，删除tombstone和损坏文件都不会复活legacy', () => {
    fs.mkdirSync(path.join(directory, 'mcp'))
    fs.writeFileSync(path.join(directory, 'mcp', 'secret.json'), JSON.stringify({ token: 'legacy-sentinel-token' }))
    expect(readHomeToken(directory)).toBe('legacy-sentinel-token')
    credentials({ value: 'settings-sentinel-token' })
    expect(readHomeToken(directory)).toBe('settings-sentinel-token')
    credentials(undefined)
    expect(readHomeToken(directory)).toBeUndefined()
    credentials({})
    expect(readHomeToken(directory)).toBeUndefined()
    fs.writeFileSync(path.join(directory, 'credentials.json'), '{invalid')
    expect(readHomeToken(directory)).toBeUndefined()
  })

  it('其他home缺少凭据时不继承default', () => {
    const other = path.join(directory, 'other')
    fs.mkdirSync(other)
    credentials({ value: 'default-sentinel-token' })
    expect(readHomeToken(other)).toBeUndefined()
  })

  it('隔离home用runtime地址；不信任非回环或带用户名的地址', () => {
    const runtime = path.join(directory, 'runtime.json')
    fs.writeFileSync(runtime, JSON.stringify({ mcp: { url: 'http://127.0.0.1:41234/mcp' } }))
    expect(readHomeUrl(directory, 'side')).toBe('http://127.0.0.1:41234/mcp')
    for (const url of ['https://example.test/mcp', 'http://user@127.0.0.1:1234/mcp', 'http://127.0.0.1:1234/mcp?token=x']) {
      fs.writeFileSync(runtime, JSON.stringify({ mcp: { url } }))
      expect(readHomeUrl(directory, 'side')).toBeUndefined()
    }
    expect(readHomeUrl(directory, 'default')).toBe('http://127.0.0.1:2870/mcp')
  })
})

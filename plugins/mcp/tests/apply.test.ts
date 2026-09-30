import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Context } from 'cordis'
import type { Fiber, Message, Plugin } from 'cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GwbResult } from '@godcreator/gwb-commands'
import * as mcpPlugin from '../src/index.js'

let homesRoot: string

beforeEach(() => {
  homesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-mcp-apply-'))
})

afterEach(() => {
  fs.rmSync(homesRoot, { recursive: true, force: true })
})

interface RegisteredCommand {
  def: { name: string; description?: string; usage?: string; plugin: string; effect: 'read' | 'write' | 'external'; hiddenFromAgents?: true }
  handler: (args: unknown, context: { via: string }) => unknown
}

/** 命令总线替身：登记、列出、按真总线的规矩执行（来源不给就是 plugin；带 ok 的原样回，其余包成 { ok: true, data }） */
function fakeCommandBus() {
  const commands = new Map<string, RegisteredCommand>()
  return {
    commands,
    register(def: RegisteredCommand['def'], handler: RegisteredCommand['handler']) {
      commands.set(def.name, { def, handler })
      return () => void commands.delete(def.name)
    },
    list: () => [...commands.values()].map((c) => ({ description: '', usage: '', ...c.def })),
    async run(commandName: string, args?: unknown, context: { via: string } = { via: 'plugin' }): Promise<GwbResult> {
      const command = commands.get(commandName)
      if (command === undefined) return { ok: false, error: `没有这条命令：${commandName}` }
      const handlerResult = await command.handler(args, context)
      if (handlerResult !== null && typeof handlerResult === 'object' && 'ok' in handlerResult) return handlerResult as GwbResult
      return { ok: true, data: handlerResult }
    },
  }
}

/** 设置服务替身：记下声明，按表回值 */
function fakeSettings(values: Record<string, unknown>) {
  const defined: { key: string; default?: unknown }[] = []
  return {
    defined,
    define(def: { key: string; default?: unknown }) {
      defined.push(def)
      return () => {}
    },
    get: (key: string) => values[key],
  }
}

interface Booted {
  root: Context
  home: string
  logs: Message[]
  bus: ReturnType<typeof fakeCommandBus>
  settings: ReturnType<typeof fakeSettings>
  mcpFiber: Fiber
  runCommand: (commandName: string, args?: unknown) => Promise<GwbResult>
}

async function bootMcp(homeName: string, options: { settingValues?: Record<string, unknown>; extras?: (root: Context) => void } = {}): Promise<Booted> {
  const home = path.join(homesRoot, homeName)
  fs.mkdirSync(home)
  const root = new Context()
  const logs: Message[] = []
  root.logger.exporter({ export: (message) => void logs.push(message) })
  const bus = fakeCommandBus()
  const settings = fakeSettings(options.settingValues ?? {})
  root.provide('gwbKernel', { dataDir: home, version: 'test', emit: () => {}, setShell: () => () => {} })
  root.provide('gwbCommands', bus)
  root.provide('gwbSettings', settings)
  options.extras?.(root)
  const mcpFiber = await root.plugin(mcpPlugin as unknown as Plugin)
  const runCommand = (commandName: string, args?: unknown): Promise<GwbResult> => bus.run(commandName, args)
  return { root, home, logs, bus, settings, mcpFiber, runCommand }
}

interface Connection {
  url: string
  port: number
  token: string
}

async function connectionOf(booted: Booted): Promise<Connection> {
  const info = await booted.runCommand('mcp.info')
  expect(info.ok).toBe(true)
  const data = info.data as { url: string; port: number; mcpServers: { gwb: { headers: { Authorization: string } } } }
  return { url: data.url, port: data.port, token: data.mcpServers.gwb.headers.Authorization.replace(/^Bearer /, '') }
}

/** 发一条原始 HTTP 请求，回状态码与正文 */
function rawRequest(port: number, options: { method?: string; path?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: options.method ?? 'POST', path: options.path ?? '/mcp', headers: options.headers }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end(options.body)
  })
}

async function mcpClient(connection: Connection): Promise<Client> {
  const client = new Client({ name: 'apply-test', version: '0' })
  const transport = new StreamableHTTPClientTransport(new URL(connection.url), { requestInit: { headers: { Authorization: `Bearer ${connection.token}` } } })
  await client.connect(transport)
  return client
}

const textsOf = (logs: Message[], type: string): string[] => logs.filter((m) => m.type === type).map((m) => m.args.map(String).join(' '))

describe('MCP 插件装上之后', () => {
  it('声明 port 设置：非 default home 缺省 0；登记 mcp.info 与 mcp.token，插件包名写在 plugin 上', async () => {
    const booted = await bootMcp('side')
    expect(booted.settings.defined).toEqual([expect.objectContaining({ key: 'port', title: 'MCP 端口', type: 'number', default: 0 })])
    expect(booted.bus.list().map((c) => [c.name, c.plugin])).toEqual([
      ['mcp.info', '@godcreator/gwb-mcp'],
      ['mcp.token', '@godcreator/gwb-mcp'],
    ])
    await booted.mcpFiber.dispose()
  })

  it('第一次装上生成 token 并写进 <home>/mcp/secret.json；mcp.info 回 url、端口与带 token 的 mcpServers 片段', async () => {
    const booted = await bootMcp('side')
    const connection = await connectionOf(booted)
    expect(connection.port).toBeGreaterThan(0)
    expect(connection.url).toBe(`http://127.0.0.1:${connection.port}/mcp`)
    const secret = JSON.parse(fs.readFileSync(path.join(booted.home, 'mcp', 'secret.json'), 'utf8')) as { token: string }
    expect(secret.token).toBe(connection.token)
    await booted.mcpFiber.dispose()
  })

  it('绑定成功后把端口写进 runtime.json，保留别的字段', async () => {
    const home = path.join(homesRoot, 'side')
    const booted = await bootMcp('side', {
      extras: () => fs.writeFileSync(path.join(home, 'runtime.json'), JSON.stringify({ pid: 42 })),
    })
    const connection = await connectionOf(booted)
    expect(JSON.parse(fs.readFileSync(path.join(booted.home, 'runtime.json'), 'utf8'))).toEqual({ pid: 42, mcp: { port: connection.port, url: connection.url } })
    await booted.mcpFiber.dispose()
  })

  it('没带 token、token 不对、Host 不对都回 401 并写 warn；401 正文说明 token 去哪拿', async () => {
    const booted = await bootMcp('side')
    const { port, token } = await connectionOf(booted)
    const noToken = await rawRequest(port, {})
    expect(noToken.status).toBe(401)
    expect(noToken.body).toContain('token 取法见 mcp.token 命令')
    expect((await rawRequest(port, { headers: { authorization: 'Bearer wrong-token-wrong-token' } })).status).toBe(401)
    expect((await rawRequest(port, { headers: { authorization: `Bearer ${token}`, host: `evil.example:${port}` } })).status).toBe(401)
    expect(textsOf(booted.logs, 'warn').filter((t) => t.startsWith('拒绝了一条请求'))).toHaveLength(3)
    await booted.mcpFiber.dispose()
  })

  it('带对 token 时：别的路径 404，不是 POST 回 405', async () => {
    const booted = await bootMcp('side')
    const { port, token } = await connectionOf(booted)
    const headers = { authorization: `Bearer ${token}` }
    expect((await rawRequest(port, { path: '/other', headers })).status).toBe(404)
    expect((await rawRequest(port, { method: 'GET', headers })).status).toBe(405)
    await booted.mcpFiber.dispose()
  })

  it('经 MCP 协议：工具是 index / search / run；run 调到命令总线并写一条 agent 调用日志；index 带 home 名与按插件分组的命令', async () => {
    const booted = await bootMcp('side')
    booted.bus.register({ name: 'demo.echo', plugin: '@t/demo', description: '回声', effect: 'read' }, (args) => args)
    const client = await mcpClient(await connectionOf(booted))
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(['index', 'run', 'search'])

    const ran = await client.callTool({ name: 'run', arguments: { command: 'demo.echo', args: '{"x":1}' } })
    expect(JSON.parse((ran.content as { text: string }[])[0]!.text)).toEqual({ ok: true, data: { x: 1 } })
    expect(textsOf(booted.logs, 'info')).toContain('agent 调了 demo.echo：成功')

    const failed = await client.callTool({ name: 'run', arguments: { command: 'nope' } })
    expect(failed.isError).toBe(true)

    const index = JSON.parse(((await client.callTool({ name: 'index', arguments: {} })).content as { text: string }[])[0]!.text) as {
      home: string
      commands: { plugin: string; names: string[] }[]
    }
    expect(index.home).toBe('side')
    expect(index.commands).toContainEqual({ plugin: '@t/demo', names: ['demo.echo'] })

    booted.bus.register({ name: 'demo.via', plugin: '@t/demo', description: '回请求来源', effect: 'read' }, (_args, context) => context.via)
    const via = await client.callTool({ name: 'run', arguments: { command: 'demo.via' } })
    expect(JSON.parse((via.content as { text: string }[])[0]!.text)).toEqual({ ok: true, data: 'mcp' })
    await client.close()
    await booted.mcpFiber.dispose()
  })

  it('instructions 末尾带这台 home 的目录：home 名、命令前缀；只给页面调用的命令不进前缀', async () => {
    const booted = await bootMcp('side')
    booted.bus.register({ name: 'demo.echo', plugin: '@t/demo', description: '回声', effect: 'read' }, (args) => args)
    booted.bus.register({ name: 'pageonly.sync', plugin: '@t/page', description: '页面专用', effect: 'write', hiddenFromAgents: true }, () => null)
    const client = await mcpClient(await connectionOf(booted))
    const instructions = client.getInstructions() ?? ''
    expect(instructions).toContain('MCP 工具只有 index / search / run 三个')
    expect(instructions).toContain('你连上的是 home「side」')
    expect(instructions).toMatch(/命令前缀.*demo/)
    expect(instructions).not.toContain('pageonly')
    await client.close()
    await booted.mcpFiber.dispose()
  })

  it('只给页面调用的命令：index、search 不列，run 拒绝且不执行；页面照常调得到', async () => {
    const booted = await bootMcp('side')
    let ranTimes = 0
    booted.bus.register({ name: 'demo.sync', plugin: '@t/demo', description: '页面推数据', effect: 'write', hiddenFromAgents: true }, () => {
      ranTimes += 1
      return null
    })
    const client = await mcpClient(await connectionOf(booted))
    const textOf = async (name: string, args: Record<string, unknown>): Promise<string> =>
      ((await client.callTool({ name, arguments: args })).content as { text: string }[])[0]!.text
    expect(await textOf('index', {})).not.toContain('demo.sync')
    expect(await textOf('search', { prefix: 'demo.' })).not.toContain('demo.sync')
    const refused = await client.callTool({ name: 'run', arguments: { command: 'demo.sync' } })
    expect(refused.isError).toBe(true)
    expect((refused.content as { text: string }[])[0]!.text).toContain('只给页面调用')
    expect(ranTimes).toBe(0)
    expect(await booted.bus.run('demo.sync', undefined, { via: 'ui' })).toEqual({ ok: true, data: null })
    await client.close()
    await booted.mcpFiber.dispose()
  })

  it('run 一条不存在的命令：isError 里告诉去哪找名字', async () => {
    const booted = await bootMcp('side')
    const client = await mcpClient(await connectionOf(booted))
    const failed = await client.callTool({ name: 'run', arguments: { command: 'demo.nope' } })
    expect(failed.isError).toBe(true)
    expect((failed.content as { text: string }[])[0]!.text).toMatch(/没有这条命令：demo\.nope。用 search/)
    await client.close()
    await booted.mcpFiber.dispose()
  })

  it('返回超过上限：run 不交回原文，isError 写明命令已执行、怎么缩小范围；search 带 effect 过滤、行里带 effect', async () => {
    const booted = await bootMcp('side')
    booted.bus.register({ name: 'demo.huge', plugin: '@t/demo', description: '大返回', effect: 'read' }, () => 'x'.repeat(50_000))
    booted.bus.register({ name: 'demo.poke', plugin: '@t/demo', description: '改点东西', effect: 'write' }, () => null)
    const client = await mcpClient(await connectionOf(booted))
    const huge = await client.callTool({ name: 'run', arguments: { command: 'demo.huge' } })
    expect(huge.isError).toBe(true)
    const hugeText = (huge.content as { text: string }[])[0]!.text
    expect(hugeText).toMatch(/demo\.huge 已经执行完.*超过单次返回的上限 40000/)
    expect(hugeText.length).toBeLessThan(1_000)

    const readOnly = JSON.parse(
      ((await client.callTool({ name: 'search', arguments: { prefix: 'demo.', effect: 'read' } })).content as { text: string }[])[0]!.text,
    ) as { commands: { name: string; effect?: string }[]; skills: unknown[] }
    expect(readOnly.commands).toEqual([expect.objectContaining({ name: 'demo.huge', effect: 'read' })])
    expect(readOnly.skills).toEqual([])
    await client.close()
    await booted.mcpFiber.dispose()
  })

  it('mcp.token 不带参数回当前 token；rotate 之后旧 token 立刻 401、新 token 立刻能用', async () => {
    const booted = await bootMcp('side')
    const before = await connectionOf(booted)
    expect(await booted.runCommand('mcp.token')).toMatchObject({ ok: true, data: { token: before.token, rotated: false } })
    const rotated = await booted.runCommand('mcp.token', { rotate: true })
    const newToken = (rotated.data as { token: string }).token
    expect(newToken).not.toBe(before.token)
    expect((await rawRequest(before.port, { headers: { authorization: `Bearer ${before.token}` } })).status).toBe(401)
    expect((await rawRequest(before.port, { method: 'GET', headers: { authorization: `Bearer ${newToken}` } })).status).toBe(405)
    await booted.mcpFiber.dispose()
  })

  it('有说明书服务就登记自带的 skills/ 目录；有 node-cli 就登记 mcp.client', async () => {
    const skillDirs: string[] = []
    const cliSpecs: { name: string; entry: string; plugin?: string }[] = []
    const booted = await bootMcp('side', {
      extras: (root) => {
        root.provide('gwbSkills', { register: (dir: URL) => (skillDirs.push(String(dir)), () => {}), list: () => [], read: async () => undefined })
        root.provide('gwbNodeCli', { register: (spec: { name: string; entry: string; plugin?: string }) => (cliSpecs.push(spec), () => {}), list: () => [], run: async () => ({ ok: true }) })
      },
    })
    expect(skillDirs).toHaveLength(1)
    expect(skillDirs[0]).toMatch(/\/skills\/$/)
    expect(cliSpecs).toEqual([expect.objectContaining({ name: 'mcp.client', plugin: '@godcreator/gwb-mcp' })])
    expect(path.basename(cliSpecs[0]!.entry)).toBe('client.mjs')
    await booted.mcpFiber.dispose()
  })

  it('非 default home 显式给的端口被占时，改用系统分配的端口', async () => {
    const blocker = net.createServer()
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve))
    const blockedPort = (blocker.address() as net.AddressInfo).port
    const booted = await bootMcp('side', { settingValues: { port: blockedPort } })
    const connection = await connectionOf(booted)
    expect(connection.port).not.toBe(blockedPort)
    expect(textsOf(booted.logs, 'warn').some((t) => t.includes(`127.0.0.1:${blockedPort} 已被占用`))).toBe(true)
    await booted.mcpFiber.dispose()
    blocker.close()
  })

  it('default home 的端口被占时不换端口、不开入口；mcp.info 与 mcp.token 回 ok:false 说原因', async () => {
    const blocker = net.createServer()
    const blockedByUs = await new Promise<boolean>((resolve) => {
      blocker.once('error', () => resolve(false))
      blocker.listen(2870, '127.0.0.1', () => resolve(true))
    })
    const booted = await bootMcp('default')
    const info = await booted.runCommand('mcp.info')
    expect(info.ok).toBe(false)
    expect(info.error).toContain('MCP 入口没在监听（default home 要的是 2870 端口）')
    expect((await booted.runCommand('mcp.token')).ok).toBe(false)
    expect(textsOf(booted.logs, 'error').some((t) => t.startsWith('default home 的 MCP 入口没能监听 2870 端口'))).toBe(true)
    await booted.mcpFiber.dispose()
    if (blockedByUs) blocker.close()
  })

  it('插件卸载时关掉 HTTP 服务', async () => {
    const booted = await bootMcp('side')
    const { port } = await connectionOf(booted)
    await booted.mcpFiber.dispose()
    await expect(rawRequest(port, {})).rejects.toThrow()
  })
})

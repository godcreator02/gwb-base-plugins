#!/usr/bin/env node
/**
 * gwb MCP 入口的命令行客户端。零依赖单文件：node ≥18（全局 fetch）就能运行，不用装任何包，
 * 把这一个文件复制到别处也能运行。
 *
 *   node client.mjs index                          # 取全部说明书与命令名（每个会话先调一次）
 *   node client.mjs search '{"prefix":"skill."}'   # 查用法；不给 JSON 就返回全部内容与用法
 *   node client.mjs run logger.where               # 按名字调用命令
 *   node client.mjs run skill.read '{"name":"mcp"}'
 *
 * 入口地址：--url 优先，其次环境变量 GWB_MCP_URL，缺省是 default home 的入口（2870 端口）。
 * token：--token 优先，其次环境变量 GWB_MCP_TOKEN，**缺省直接读 default home 的
 * 凭据文件**——default home 的端口与凭据文件位置都是固定的，所以加了鉴权之后，
 * 「什么参数都不给就能用」仍然成立。隔离 home 的端口与 token 都不是契约，用那两个参数显式给。
 *
 * MCP 入口是无状态的 streamableHTTP：每条 POST 都新建一对 server+transport，没有会话要
 * 维持；但协议握手照样做全（initialize → initialized → tools/call），所以这个脚本对
 * 任何 MCP 入口都能用，不只对本插件的实现。
 *
 * 回执约定与 MCP 入口一致：**业务失败不是协议错误**——工具回 isError 时照样打印正文（原因
 * 由调用方读），退出码 1；传输层与协议层的错误写 stderr，退出码也是 1。正文是 JSON，可以直接接管道。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_URL = 'http://127.0.0.1:2870/mcp'
const PROTOCOL_VERSION = '2025-06-18'
/** 客户端默认时限；长等待可用 --timeout 显式覆盖，并留出服务端回执余量。 */
const DEFAULT_TIMEOUT_MS = 130_000

/**
 * default home 的凭据文件。**两段路径分开写**：home 目录由内核按平台决定（这里是
 * `%APPDATA%\gwb-kernel\homes\<home>`），`mcp/secret.json` 这一段由 MCP 插件决定。
 * 两段都不是这个脚本能推断的，所以只作缺省值：哪一段不对，就退回到要求显式给 token
 */
function defaultSecretFile(home) {
  const roaming =
    process.platform === 'win32'
      ? process.env.APPDATA
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'))
  return roaming === undefined ? undefined : path.join(roaming, 'gwb-kernel', 'homes', home, 'mcp', 'secret.json')
}

/**
 * 从凭据文件取 token。**取不到不算错**：读不了就当没给，请求照常发出，
 * 由 MCP 入口返回的 401 说明原因——那句话写清了 token 该从哪来，比这个脚本自己写一句准确
 */
function readSecret(file) {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
    return typeof doc?.token === 'string' && doc.token !== '' ? doc.token : undefined
  } catch {
    return undefined
  }
}

/** token 的三个来源，按优先级：命令行 > 环境变量 > default home 的凭据文件 */

const HELP = `用法：node client.mjs [--url <入口地址>] [--token <token>] [--timeout <毫秒>] <动作> [参数]

动作：
  index                      取全部说明书与命令名（无参数，约两千 token）
  search [<JSON 筛选>]        找命令与说明书；筛选形如 {"plugin"|"prefix"|"q": …}，不给就返回全部（约八千 token）
  run <命令名> [<JSON 参数>]   按名字调用命令；命令失败返回 isError 文本，照常往下读

入口地址：--url > 环境变量 GWB_MCP_URL > ${DEFAULT_URL}（default home 固定用 2870 端口）
token：--token > 环境变量 GWB_MCP_TOKEN > default home 的凭据文件（mcp/secret.json，自动读）
其他 home：地址与 token 都显式给（端口看 devkit.home.list 回执里的 mcp 字段，token 在那个 home 的凭据文件里）`

/** 解命令行。--url / --token / --timeout 收开关，剩下的第一个非开关词是动作 */
function parseArgv(argv) {
  let url = process.env.GWB_MCP_URL ?? DEFAULT_URL
  let timeoutMs = DEFAULT_TIMEOUT_MS
  // 空串当没给：`--token ""` 与「设了个空环境变量」都不该让自动读凭据文件失效
  let token = process.env.GWB_MCP_TOKEN !== undefined && process.env.GWB_MCP_TOKEN !== '' ? process.env.GWB_MCP_TOKEN : undefined
  let tokenGiven = token !== undefined
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--url') {
      url = argv[++i]
      if (url === undefined) failArg('--url 后面得跟地址')
    } else if (a === '--token') {
      token = argv[++i]
      if (token === undefined || token === '') failArg('--token 后面得跟 token')
      tokenGiven = true
    } else if (a === '--timeout') {
      const n = Number(argv[++i])
      if (!Number.isInteger(n) || n <= 0) failArg('--timeout 要正整数毫秒')
      timeoutMs = n
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(`${HELP}\n`)
      process.exit(0)
    } else {
      rest.push(a)
    }
  }
  // 自动读凭据文件只对 default home 的入口成立——别的 home 的端口是随机的，这个脚本无从知道
  if (!tokenGiven && url === DEFAULT_URL) {
    const file = defaultSecretFile('default')
    if (file !== undefined) token = readSecret(file)
  }
  return { url, timeoutMs, token, action: rest[0], args: rest.slice(1) }
}

function failArg(message) {
  process.stderr.write(`${message}\n\n${HELP}\n`)
  process.exit(2)
}

/** 动作 → 要调的工具与它的参数。search / run 的 JSON 参数不对就当场报错，不发请求 */
function parseAction(action, args) {
  if (action === 'index') return { tool: 'index', toolArgs: {} }
  if (action === 'search') {
    if (args.length > 1) failArg('search 至多一个参数：JSON 筛选对象')
    return { tool: 'search', toolArgs: parseJsonArg(args[0], 'search 的筛选') }
  }
  if (action === 'run') {
    if (args.length < 1 || args.length > 2) failArg('run 要 1-2 个参数：命令名，可选 JSON 参数')
    return { tool: 'run', toolArgs: { command: args[0], args: parseJsonArg(args[1], 'run 的参数') } }
  }
  failArg(action === undefined ? '没给动作。' : `认不出动作「${action}」。`)
}

function parseJsonArg(text, what) {
  if (text === undefined) return {}
  try {
    const value = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('不是对象')
    }
    return value
  } catch {
    failArg(`${what}得是 JSON 对象，收到的是：${text}`)
  }
}

/**
 * JSON-RPC 的请求与回执。本插件的入口不返回会话头（无状态），返回了就带上——对有状态的 MCP 入口也能用。
 * 回执两种 Content-Type 都收：application/json 直取，text/event-stream 按 SSE 拆
 * （拆出带匹配 id 的那条消息为止；通知没有 id，跳过）。
 */
function makeTransport(url, timeoutMs, token) {
  let nextId = 1
  let sessionId

  async function post(message) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    // token 没取到就不带这个请求头：让 MCP 入口返回的 401 说明原因，比在这里自己写一句准确
    if (token !== undefined) headers.authorization = `Bearer ${token}`
    if (sessionId !== undefined) headers['mcp-session-id'] = sessionId
    let res
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw new Error(`连不上 MCP 入口（${url}）：${String(err)}——工作台没启动，或这个地址不是 MCP 入口`)
    }
    const sid = res.headers.get('mcp-session-id')
    if (sid !== null && sessionId === undefined) sessionId = sid
    return res
  }

  async function readMessage(res, id) {
    const type = res.headers.get('content-type') ?? ''
    const text = await res.text()
    if (type.includes('application/json')) return JSON.parse(text)
    if (type.includes('text/event-stream')) {
      for (const block of text.split(/\r?\n\r?\n/)) {
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')
        if (data === '') continue
        const message = JSON.parse(data)
        if (message.id === id) return message
      }
      return undefined
    }
    throw new Error(`MCP 入口返回的 Content-Type 认不出：${type || '(空)'}`)
  }

  async function request(method, params) {
    const id = nextId++
    const res = await post({ jsonrpc: '2.0', id, method, params })
    if (!res.ok) throw new Error(`MCP 入口返回了 ${res.status} ${res.statusText}`)
    const message = await readMessage(res, id)
    if (message === undefined) throw new Error(`${method} 没等到回执`)
    if (message.error !== undefined) {
      throw new Error(`JSON-RPC 错误 ${message.error.code}：${message.error.message}`)
    }
    return message.result
  }

  async function notify(method, params) {
    const res = await post({ jsonrpc: '2.0', method, params })
    if (!res.ok && res.status !== 202) throw new Error(`MCP 入口返回了 ${res.status} ${res.statusText}（${method}）`)
    await res.text().catch(() => {})
  }

  return { request, notify }
}

async function main() {
  const { url, timeoutMs, token, action, args } = parseArgv(process.argv.slice(2))
  const { tool, toolArgs } = parseAction(action, args)
  const transport = makeTransport(url, timeoutMs, token)

  await transport.request('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'gwb-client', version: '0.1.0' },
  })
  await transport.notify('notifications/initialized', {})

  const result = await transport.request('tools/call', { name: tool, arguments: toolArgs })
  const text = Array.isArray(result?.content)
    ? result.content
        .filter((part) => part?.type === 'text')
        .map((part) => part.text)
        .join('\n')
    : JSON.stringify(result, null, 2)
  if (text !== '') process.stdout.write(`${text}\n`)
  // 不调 process.exit：Windows 上会和还在关闭的 libuv 句柄冲突（fetch 的 async handle
  // 正在关闭时强制退出会触发 UV_HANDLE_CLOSING 断言）。MCP 入口随响应关闭连接，事件循环
  // 清空后进程立即退出；出错时只设置退出码
  if (result?.isError === true) process.exitCode = 1
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`)
  process.exitCode = 1
})

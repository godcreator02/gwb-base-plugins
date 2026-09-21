#!/usr/bin/env node
/**
 * gwb 门的命令行脸。零依赖单文件：node ≥18（全局 fetch）就能跑，连包都不用装——
 * 复制走单文件也一样跑。
 *
 *   node client.mjs index                          # 拿地图（每会话第一调）
 *   node client.mjs search '{"prefix":"skill."}'   # 找用法；不给 JSON ＝全貌全用法
 *   node client.mjs run logger.where               # 按名调命令
 *   node client.mjs run skill.read '{"name":"mcp"}'
 *
 * 门的地址：--url 优先，其次环境变量 GWB_MCP_URL，缺省 default home 那道（2870）。
 * 门的 token：--token 优先，其次环境变量 GWB_MCP_TOKEN，**缺省直接去 default home 的
 * 凭据文件里读**——默认那两个位置是固定的，所以「什么参数都不给就能用」这条在加了鉴权
 * 之后照旧成立。隔离 home 的口与 token 都不是契约，用那两个开关显式给。
 *
 * 这道门是无状态 streamableHTTP：每条 POST 都是一对新的 server+transport，没有会话要
 * 维持；但协议的握手照补全（initialize → initialized → tools/call），于是这支脚本对
 * 任何 MCP 门都成立，不只对本门的实现。
 *
 * 回执约定与门一致：**业务失败不是协议错误**——工具回 isError 时正文照印（原因自己
 * 读），退出码 1；传输层与协议层的错走 stderr，退出码也 1。正文是 JSON，直接进管道。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_URL = 'http://127.0.0.1:2870/mcp'
const PROTOCOL_VERSION = '2025-06-18'
/** 客户端默认时限；长等待可用 --timeout 显式覆盖，并留出服务端回执余量。 */
const DEFAULT_TIMEOUT_MS = 130_000

/**
 * default home 的凭据文件。**两段路径分开写**：home 目录由内核按平台定（这里是
 * `%APPDATA%\gwb-kernel\homes\<home>`），目录名 `mcp/secret.json` 由门那个件定。
 * 两段都不是这支脚本能猜的东西，所以它们各自是「猜错了就退成要求显式给 token」的软默认
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
 * 去凭据文件里取 token。**取不到不是错**：读不动就当没给，让请求原样发出去，
 * 由门那头的 401 说话——那句话说清了 token 该从哪来，比这支脚本自己编一句强
 */
function readSecret(file) {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
    return typeof doc?.token === 'string' && doc.token !== '' ? doc.token : undefined
  } catch {
    return undefined
  }
}

/** token 的三条来路，按优先级：命令行 > 环境变量 > default home 的凭据文件 */

const HELP = `用法：node client.mjs [--url <门的地址>] [--token <token>] [--timeout <毫秒>] <动作> [参数]

动作：
  index                      拿完整地图（无参数，约两千 token）
  search [<JSON 筛选>]        找命令与说明书；筛选形如 {"plugin"|"prefix"|"q": …}，不给＝全貌（约八千 token）
  run <命令名> [<JSON 参数>]   按名调命令；命令失败回 isError 文本，照常往下读

门的地址：--url > 环境变量 GWB_MCP_URL > ${DEFAULT_URL}（default home 认死 2870）
门的 token：--token > 环境变量 GWB_MCP_TOKEN > default home 的凭据文件（mcp/secret.json，自动读）
其他 home：地址与 token 都显式给（口看 devkit.home.list 的 mcp 格，token 在那个 home 的凭据文件里）`

/** 解命令行。--url / --token / --timeout 收开关，剩下的第一个非开关词是动作 */
function parseArgv(argv) {
  let url = process.env.GWB_MCP_URL ?? DEFAULT_URL
  let timeoutMs = DEFAULT_TIMEOUT_MS
  // 空串当没给：`--token ""` 与「设了个空环境变量」都不该把自动读文件那条路顶掉
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
  // 自动读文件只对 default home 那道口成立——别的 home 的口是随机数,那支脚本无从知道
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

/** 动作 → 那枚工具与它的参数。search / run 的 JSON 参数坏了当场说，不带病上路 */
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
 * JSON-RPC 的进出。会话头这道门不给（无状态），但给了就带上——对有状态的门也成立。
 * 回执两种 Content-Type 都收：application/json 直取，text/event-stream 按 SSE 拆
 * （拆出带匹配 id 的那条消息为止；通知没有 id，跳过）。
 */
function makeTransport(url, timeoutMs, token) {
  let nextId = 1
  let sessionId

  async function post(message) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    // token 没取到就不带这一格：让门那头的 401 说原因，比在这儿自己编一句强
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
      throw new Error(`够不着门（${url}）：${String(err)}——台没起，或这个口不是门`)
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
    throw new Error(`门回的 Content-Type 认不出：${type || '(空)'}`)
  }

  async function request(method, params) {
    const id = nextId++
    const res = await post({ jsonrpc: '2.0', id, method, params })
    if (!res.ok) throw new Error(`门回了 ${res.status} ${res.statusText}`)
    const message = await readMessage(res, id)
    if (message === undefined) throw new Error(`${method} 没等到回执`)
    if (message.error !== undefined) {
      throw new Error(`JSON-RPC 错误 ${message.error.code}：${message.error.message}`)
    }
    return message.result
  }

  async function notify(method, params) {
    const res = await post({ jsonrpc: '2.0', method, params })
    if (!res.ok && res.status !== 202) throw new Error(`门回了 ${res.status} ${res.statusText}（${method}）`)
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
  // 不 process.exit：Windows 上会跟还在收尾的 libuv 句柄打架（fetch 的 async handle
  // mid-closing 时强退触发 UV_HANDLE_CLOSING 断言）。门随响应关连接，循环自然排干、
  // 即刻退出；出错只是把码留下
  if (result?.isError === true) process.exitCode = 1
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`)
  process.exitCode = 1
})

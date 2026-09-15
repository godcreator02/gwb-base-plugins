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
 *
 * 这道门是无状态 streamableHTTP：每条 POST 都是一对新的 server+transport，没有会话要
 * 维持；但协议的握手照补全（initialize → initialized → tools/call），于是这支脚本对
 * 任何 MCP 门都成立，不只对本门的实现。
 *
 * 回执约定与门一致：**业务失败不是协议错误**——工具回 isError 时正文照印（原因自己
 * 读），退出码 1；传输层与协议层的错走 stderr，退出码也 1。正文是 JSON，直接进管道。
 */

const DEFAULT_URL = 'http://127.0.0.1:2870/mcp'
const PROTOCOL_VERSION = '2025-06-18'
/** 总线的红线在 120s，客户端比它宽一档——命长该走作业模式，不是加大这儿 */
const DEFAULT_TIMEOUT_MS = 130_000

const HELP = `用法：node client.mjs [--url <门的地址>] [--timeout <毫秒>] <动作> [参数]

动作：
  index                      拿完整地图（无参数，约两千 token）
  search [<JSON 筛选>]        找命令与说明书；筛选形如 {"plugin"|"prefix"|"q": …}，不给＝全貌（约八千 token）
  run <命令名> [<JSON 参数>]   按名调命令；命令失败回 isError 文本，照常往下读

门的地址：--url > 环境变量 GWB_MCP_URL > ${DEFAULT_URL}（default home 认死 2870）`

/** 解命令行。--url / --timeout 收开关，剩下的第一个非开关词是动作 */
function parseArgv(argv) {
  let url = process.env.GWB_MCP_URL ?? DEFAULT_URL
  let timeoutMs = DEFAULT_TIMEOUT_MS
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--url') {
      url = argv[++i]
      if (url === undefined) failArg('--url 后面得跟地址')
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
  return { url, timeoutMs, action: rest[0], args: rest.slice(1) }
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
function makeTransport(url, timeoutMs) {
  let nextId = 1
  let sessionId

  async function post(message) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
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
  const { url, timeoutMs, action, args } = parseArgv(process.argv.slice(2))
  const { tool, toolArgs } = parseAction(action, args)
  const transport = makeTransport(url, timeoutMs)

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

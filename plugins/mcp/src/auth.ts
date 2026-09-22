import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isRecord } from './vocab.js'

/**
 * 这道门的凭据与两道请求防线。纯函数加一个文件读写，从接线里抽出来于是可测。
 *
 * **为什么 0.4 摘掉的鉴权现在又回来了**：那次的理由写在接线文件的头注里——
 * 「口只绑 127.0.0.1、服务本机，本机进程本就同权」，外加一条实打实的代价
 * 「token 跟着内核重启换新，只会把 agent 侧的配置变成一桩要反复伺候的差事」。
 *
 * 前一半是**把「能连到这个口」当成了「有权调这个口」**：回环绑定分得开本机与外部网络，
 * 分不开本机上的**不同主体**——浏览器里的一个页面、另一个 home 的客户端配置、随手写的
 * 一个脚本，都够得着 127.0.0.1，而这道门后面是完整的命令注册表（含往 home 里装插件）。
 * 后一半则是可以消掉的技术债，不是鉴权本身的错：**token 落盘、重启不换**，那条「反复
 * 伺候」的代价就没了。于是 0.10 把 token 加回来，做法按这两条改。
 *
 * **Host / Origin 为什么自己判，不用 SDK 那三个开关**：锁的那版 SDK（`^1.30.0`）里
 * `enableDnsRebindingProtection` / `allowedHosts` / `allowedOrigins` 三个都标着
 * `@deprecated Use external middleware … instead`，而且 `allowedHosts` 不配时 Host 那一格
 * **整段跳过**（`webStandardStreamableHttp.js:145`）——只配 Origin 等于没防住重绑定。
 * 自己写十来行，还能把拒绝的原因记进日志。
 */

/** 凭据文件的目录名，落在 home 的数据目录下 */
export const SECRET_DIR = 'mcp'

/** 凭据文件名 */
export const SECRET_FILE = 'secret.json'

/** 客户端带的那个请求头 */
export const TOKEN_HEADER = 'authorization'

/** 请求头里 token 的前缀 */
export const TOKEN_SCHEME = 'Bearer'

/** 环境变量名：命令行客户端与 MCP 客户端都认这一个 */
export const TOKEN_ENV = 'GWB_MCP_TOKEN'

/** 没有 `Origin` 的浏览器请求用的那个值（有的客户端把它写成字面量 null） */
const NULL_ORIGIN = 'null'

/** 凭据文件里那份 JSON 的形状 */
interface SecretDoc {
  token?: unknown
}

/** 取凭据文件里那个 token；读不动、半截 JSON、根不是对象、token 不是人写的那种串，一律当没有 */
function tokenIn(text: string | undefined): string | undefined {
  let existing: unknown
  try {
    existing = text === undefined ? undefined : JSON.parse(text)
  } catch {
    existing = undefined
  }
  if (!isRecord(existing)) return undefined
  const { token } = existing as SecretDoc
  // 长度下限不是为了安全，是为了不把半截文件里的一小段当凭据用
  return typeof token === 'string' && token.length >= 16 ? token : undefined
}

/**
 * 取这道门的 token，没有就地生成一份。
 *
 * - **文件在且能用**：原样用。重启、热重挂都不换——这正是 0.4 那次摘鉴权的理由，解开它
 *   的办法不是不要 token，是别让它每次重启就作废
 * - **文件在但读不出 token**：**先留证再换**（改名成 `.broken-<时间戳>`），不静默覆盖。
 *   那种坏法（手改坏了、写到一半断电）留下的原始字节是唯一能查的东西
 * - **文件不在或本来就是空的**：现生成一份
 *
 * 返回值里的 `created` / `regenerated` 只用来让接线那边知道该记什么日志——判据不在这份里，
 * 这份只回事实。
 */
export function loadOrCreateToken(dataDir: string): { token: string; file: string; created: boolean; regenerated: boolean } {
  const file = path.join(dataDir, SECRET_DIR, SECRET_FILE)
  let text: string | undefined
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    text = undefined
  }

  const found = tokenIn(text)
  if (found !== undefined) return { token: found, file, created: false, regenerated: false }

  // 空文件（0 字节）不算「坏」——首次落盘写了个空壳也走这条，不留一份没意义的备份
  const broken = text !== undefined && text.trim() !== ''
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (broken) {
    // 时间戳进文件名：连坏两次不许互相盖掉
    fs.renameSync(file, `${file}.broken-${Date.now()}`)
  }
  const token = mint()
  fs.writeFileSync(file, writeSecret(token))
  return { token, file, created: !broken, regenerated: broken }
}

/** 换一份新的：写文件、回新 token。调用方负责把「旧客户端会 401」说给用户 */
export function rotateToken(dataDir: string): { token: string; file: string } {
  const file = path.join(dataDir, SECRET_DIR, SECRET_FILE)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const token = mint()
  fs.writeFileSync(file, writeSecret(token))
  return { token, file }
}

/** 凭据文件的正文：两格缩进、末尾一个换行，跟 `runtime.json` 一个规矩 */
function writeSecret(token: string): string {
  return JSON.stringify({ token }, null, 2) + '\n'
}

/**
 * 32 字节随机、base64url 编码。用 base64url 不是为了好看——这份 token 会出现在
 * `.mcp.json`、命令行 `--token`、环境变量三种地方，`+/=` 在 shell 与 env 里都要额外留心
 */
function mint(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * 比较两个 token。
 *
 * **先各自过一遍 SHA-256 再比**：`timingSafeEqual` 对长度不等直接抛，靠长度做前置判断
 * 会把长度泄露出去；哈希之后两边永远是 32 字节，比较也就没有可用的时序信号了。
 */
function sameToken(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest()
  const db = createHash('sha256').update(b).digest()
  return timingSafeEqual(da, db)
}

/**
 * 从请求头里取 token。认 `Authorization: Bearer <token>`；也认裸给一个值（有的客户端
 * 的 headers 配置只写得下一格，用户很自然就把 token 直接填进去）。
 */
export function bearerIn(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  // `.+` 保证捕获组一定在；`?? ''` 只是让类型收窄看得懂，不改变行为
  const match = /^Bearer\s+(.+)$/i.exec(trimmed)
  return match === null ? trimmed : (match[1] ?? '').trim()
}

/** 请求头的值可能是数组（同名头来了两条），判据只看得见第一条 */
function headerValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw
}

/** 这道口的两个 host 名。口是绑 127.0.0.1 的，所以能来敲门的只有这两个名字加这个口 */
export function allowedHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`]
}

/**
 * 这道口允许的 Origin：它自己的两个回环写法。
 *
 * **为什么不是「空表＝不校验」**：允许空表就等于给自己留一个「谁都能过」的默认，
 * 而这道门没有那种用法。
 */
export function allowedOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
}

/** 判据的结果。`refused` 那条是要写进日志的原因，别丢 */
export type GateVerdict = { refused: string } | undefined

/**
 * token 与 Host / Origin 三道判据。**在派发任何请求之前调**——位置在接线的 `handle` 里，
 * 早于建 server、早于碰命令总线。
 *
 * 三道管的是三件不同的事：
 * - **token**：本机上的**不同主体**（浏览器页面、别的 home 的配置、随手写的脚本）
 * - **Host**：DNS 重绑定——浏览器把攻击者的域名解析到 127.0.0.1，请求就从浏览器发出去了
 * - **Origin**：跨源页面直接背着你 POST（预检会挡住大多数，那一道不该当成唯一一道）
 *
 * 非浏览器客户端（curl、脚本、MCP 客户端）不带 `Origin`，照旧放行——它们要过的是 token
 * 那一关。`Origin: null` 不认：那是沙箱化 iframe 与本地文件页面才有的值。
 */
export function gateRequest(input: {
  headers: Record<string, string | string[] | undefined>
  token: string
  port: number
}): GateVerdict {
  const { headers, token, port } = input

  const given = bearerIn(headers[TOKEN_HEADER])
  if (given === undefined) return { refused: '没带 Authorization 头' }
  if (!sameToken(given, token)) return { refused: 'Authorization 里的 token 对不上' }

  const host = headerValue(headers.host)
  if (host === undefined || !allowedHosts(port).includes(host)) {
    return { refused: `Host 不在允许名单里（收到 ${host ?? '(空)'}）` }
  }

  const origin = headerValue(headers.origin)
  if (origin !== undefined && (origin === NULL_ORIGIN || !allowedOrigins(port).includes(origin))) {
    return { refused: `Origin 不在允许名单里（收到 ${origin}）` }
  }

  return undefined
}

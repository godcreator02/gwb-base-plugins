import { TOKEN_SCHEME } from './auth.js'

/**
 * MCP 入口开在哪个端口、怎么把地址与配置片段写给客户端。纯函数，从 apply 里抽出来以便测试。
 *
 * **`default` 这个 home 的端口是契约，不是首选。** 连上工作台的 agent 会话把
 * `http://127.0.0.1:2870/mcp` 写进自己的 `.mcp.json` 就不再问了，所以
 * default 的端口一旦换掉，那个会话连上的就是**另一个 home**——一个测试 home 先启动占住
 * 2870，后启动的 default 换到系统分配的端口，会话从此在测试 home 上干活而且不报错。
 *
 * 于是分成两种 home（端口从 `port` 设置来，缺省按 home 名给，见 `defaultPort`）：
 *
 * - **`default`**：用 `port` 设置里的端口（缺省 2870），**被占就不开入口**（报错，不换端口）。
 *   不开比开在别处强——开在别处是不报错地连错，不开是当场看得见
 * - **其它 home**：缺省用系统分配的端口（多个 home 同时运行是常态，没有哪个地址是它的契约）。
 *   设置里显式给了端口就试那个，被占时换成系统分配的端口
 */

/** 总控台会话永远连它 */
export const DEFAULT_HOME = 'default'

/** default home 的固定端口 */
export const DEFAULT_HOME_PORT = 2870

/** `.mcp.json` 里代表本工作台的那个键 */
const SERVER_KEY = 'gwb'

/** 选端口的结果 */
export interface PortChoice {
  /** 拿去 listen 的端口。`0` = 让系统挑一个 */
  port: number
  /** 这个端口被占（EADDRINUSE）时能不能换成 `0` */
  fallback: boolean
}

/**
 * home 目录 → home 名：最后一段。`ctx.gwbKernel.dataDir` 就是 home 目录。
 *
 * 两种分隔符都认、末尾的分隔符先去掉——这个判断不该随插件运行在哪个平台上而变。
 */
export function homeNameOf(dataDir: string): string {
  const trimmed = dataDir.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  return cut === -1 ? trimmed : trimmed.slice(cut + 1)
}

/**
 * 设置里的值能不能当端口用。设置插件不做运行时校验，这里收的是 unknown：不是整数、超出
 * 0-65535 一律当没给——不为一个笔误让入口开在别处。数字串也认（界面上的文本框写进来的）
 */
function askedPort(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 65535 ? n : undefined
}

/** `port` 设置的缺省：default 固定 2870，其它 home 0（系统分配的端口） */
export function defaultPort(homeName: string): number {
  return homeName === DEFAULT_HOME ? DEFAULT_HOME_PORT : 0
}

/** 按 home 名与 `port` 设置决定入口开在哪个端口、被占了怎么办 */
export function choosePort(homeName: string, configPort?: unknown): PortChoice {
  const asked = askedPort(configPort)
  // default：用哪个端口都行，唯独被占时不许换——换了就是把会话让给先启动的那个 home
  if (homeName === DEFAULT_HOME) return { port: asked ?? DEFAULT_HOME_PORT, fallback: false }
  // 其它 home 不给端口就用系统分配的；系统分配的端口不会被占，fallback 为 false
  if (asked === undefined || asked === 0) return { port: 0, fallback: false }
  return { port: asked, fallback: true }
}

/** 入口的地址。只服务本机，所以主机名固定是 127.0.0.1 */
export function endpointUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`
}

/** `.mcp.json` 里的一条 http server */
export interface McpServerEntry {
  type: 'http'
  url: string
  headers: { Authorization: string }
}

/**
 * 客户端配置里的标准片段：照抄进自己的 `.mcp.json` 就能连。形状照 Claude Code 的 `.mcp.json`。
 * url 与 `Authorization` 请求头一起拼好：客户端自己拼错的症状是连不上或 401，看不出原因。
 */
export function mcpServers(url: string, token: string): Record<string, McpServerEntry> {
  return { [SERVER_KEY]: { type: 'http', url, headers: { Authorization: `${TOKEN_SCHEME} ${token}` } } }
}

/** `mcp.info` 回执里 `data` 的形状 */
export interface ConnectionInfo {
  url: string
  port: number
  mcpServers: Record<string, McpServerEntry>
  /** 给人读的一句：片段里带的是哪个 token、存在哪、怎么换 */
  auth: string
}

/** `mcp.info` 的回执：连接地址加可照抄的片段，片段里带当前 token */
export function connectionInfo(port: number, token: string, secretFile: string): ConnectionInfo {
  const url = endpointUrl(port)
  return {
    url,
    port,
    mcpServers: mcpServers(url, token),
    auth: `片段里已带 Authorization: ${TOKEN_SCHEME} <当前 token>；token 存在 ${secretFile}，换一份用 mcp.token {"rotate":true}`,
  }
}

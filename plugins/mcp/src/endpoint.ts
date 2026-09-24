import { TOKEN_SCHEME } from './auth.js'

// MCP 入口开在哪个端口、怎么把地址与配置片段写给客户端。default 端口为什么被占就不开，见文档站插件页

/** 总控台会话连的那个 home */
export const DEFAULT_HOME = 'default'

/** default home 的固定端口 */
export const DEFAULT_HOME_PORT = 2870

/** 客户端配置 `mcpServers` 里代表本工作台的那个键 */
const SERVER_KEY = 'gwb'

export interface PortChoice {
  /** 拿去 listen 的端口。`0` = 让系统挑一个 */
  port: number
  /** 这个端口被占（EADDRINUSE）时能不能换成 `0` */
  fallback: boolean
}

/** home 目录 → home 名：最后一段。两种分隔符都认、末尾的分隔符先去掉，结果不随运行平台变 */
export function homeNameOf(dataDir: string): string {
  const trimmed = dataDir.replace(/[\\/]+$/, '')
  const lastSeparatorAt = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  return lastSeparatorAt === -1 ? trimmed : trimmed.slice(lastSeparatorAt + 1)
}

/** 设置里的值能不能当端口用：数字串也认（界面文本框写进来的）；不是 0-65535 的整数就当没给 */
function portFromSetting(value: unknown): number | undefined {
  const candidate = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0 && candidate <= 65535 ? candidate : undefined
}

/** `port` 设置的缺省：default 固定 2870，其它 home 0（系统分配的端口） */
export function defaultPort(homeName: string): number {
  return homeName === DEFAULT_HOME ? DEFAULT_HOME_PORT : 0
}

/** 按 home 名与 `port` 设置决定入口开在哪个端口、被占了怎么办 */
export function choosePort(homeName: string, configPort?: unknown): PortChoice {
  const asked = portFromSetting(configPort)
  // default 被占时不许换：换了就是把会话让给先启动的那个 home
  if (homeName === DEFAULT_HOME) return { port: asked ?? DEFAULT_HOME_PORT, fallback: false }
  // 系统分配的端口不会被占，fallback 为 false
  if (asked === undefined || asked === 0) return { port: 0, fallback: false }
  return { port: asked, fallback: true }
}

/** 入口的地址。只服务本机，主机名固定是 127.0.0.1 */
export function endpointUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`
}

/** 客户端配置 `mcpServers` 里的一条 http server */
export interface McpServerEntry {
  type: 'http'
  url: string
  headers: { Authorization: string }
}

/** 客户端配置里照抄就能连的片段，形状照 Claude Code 的 `.mcp.json`；url 与请求头一起拼好 */
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

export function connectionInfo(port: number, token: string, secretFile: string): ConnectionInfo {
  const url = endpointUrl(port)
  return {
    url,
    port,
    mcpServers: mcpServers(url, token),
    auth: `片段里已带 Authorization: ${TOKEN_SCHEME} <当前 token>；token 存在 ${secretFile}，换一份用 mcp.token {"rotate":true}`,
  }
}

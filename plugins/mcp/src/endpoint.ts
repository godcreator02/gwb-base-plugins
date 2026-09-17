/**
 * 这道口开在哪、怎么把它写给客户端。纯函数，从接线里抽出来于是可测。
 *
 * **`default` 这个 home 的口是契约，不是首选。** 连上工作台的 agent 会话认死
 * `http://127.0.0.1:2870/mcp` 这个串（它抄进自己的 `.mcp.json` 就不再问了），所以
 * default 的口一旦退让，那个会话连上的就是**另一个 home**——一台测试 home 先起来占住
 * 2870，后起的 default 退到系统随机口，会话从此在测试 home 上干活而且不报错。
 *
 * 于是分成两种 home（口从 `port` 设置来，缺省按 home 名给，见 `defaultPort`）：
 *
 * - **`default`**：要 `port` 设置里那个（缺省 2870），**被占就不开这道口**（报错，不退让）。
 *   不开比开在别处强——开在别处是静默连错，不开是当场看得见
 * - **其它 home**：缺省要系统随机口（多 home 同开是常态，没有哪个串是它的契约）。
 *   设置里显式给了口就试那个，被占照旧退让到随机口
 */

/** 总控台会话永远连它 */
export const DEFAULT_HOME = 'default'

/** default home 的固定口 */
export const DEFAULT_HOME_PORT = 2870

/** `.mcp.json` 里代表本工作台的那个键 */
const SERVER_KEY = 'gwb'

/** 挑口的结果 */
export interface PortChoice {
  /** 拿去 listen 的端口。`0` = 让系统挑一个 */
  port: number
  /** 这个口被占（EADDRINUSE）时许不许退让到 `0` */
  fallback: boolean
}

/**
 * home 目录 → home 名：末段。`ctx.gwbKernel.dataDir` 就是 home 目录。
 *
 * 两种分隔符都认、末尾的分隔符先剥掉——这个判断不该随件跑在哪个平台上变。
 */
export function homeNameOf(dataDir: string): string {
  const trimmed = dataDir.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  return cut === -1 ? trimmed : trimmed.slice(cut + 1)
}

/**
 * 设置里那个值当不当端口用。设置件不做运行时校验，这儿收的是 unknown：不是整数、出了
 * 0-65535 一律当没给——不为一个笔误让口开在别处。数字串也认（界面上一格文本框写进来的）
 */
function askedPort(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 65535 ? n : undefined
}

/** `port` 设置的缺省：default 认死 2870，其它 home 0（系统随机口） */
export function defaultPort(homeName: string): number {
  return homeName === DEFAULT_HOME ? DEFAULT_HOME_PORT : 0
}

/** 按 home 名与 `port` 设置定这道口开在哪、被占了怎么办 */
export function choosePort(homeName: string, configPort?: unknown): PortChoice {
  const asked = askedPort(configPort)
  // default：要哪个口都行，唯独不许退让——退让就是把会话让给先起来的那个 home
  if (homeName === DEFAULT_HOME) return { port: asked ?? DEFAULT_HOME_PORT, fallback: false }
  // 其它 home 不给端口就是系统随机口；随机口没有「被占」这回事，退让位留 false
  if (asked === undefined || asked === 0) return { port: 0, fallback: false }
  return { port: asked, fallback: true }
}

/** 这道口的地址。只服务本机，所以主机名是钉死的 */
export function endpointUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`
}

/** `.mcp.json` 里的一条 http server */
export interface McpServerEntry {
  type: 'http'
  url: string
}

/**
 * 客户端配置里的标准片段：照抄进自己的 `.mcp.json` 就能连。
 *
 * 报这个而不是只报 url，是因为**拼装那一步是每个客户端各拼一遍的**，
 * 拼错了症状是连不上而看不出为什么。片段的形状照 Claude Code 的 `.mcp.json`。
 * 无鉴权（绑 127.0.0.1，本机进程同权），没有 headers 那格
 */
export function mcpServers(url: string): Record<string, McpServerEntry> {
  return { [SERVER_KEY]: { type: 'http', url } }
}

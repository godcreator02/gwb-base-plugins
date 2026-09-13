/**
 * 这道口开在哪。纯函数，从接线里抽出来于是可测。
 *
 * 端口策略与退让规则继承自 mcp 件那份（2026-09-13 mcp 搁置、default 卸载，门由本件接，
 * 策略随门搬）。**`default` 这个 home 的口是契约，不是首选。** 日常车道认死
 * `http://127.0.0.1:2870` 这个基址，default 的口一旦退让，先起来占住 2870 的那台
 * 测试 home 就会安安静静接走请求——命令面、数据、说明书全是另一套，而两头都不报错。
 *
 * 于是分成两种 home（口从 `port` 设置来，缺省按 home 名给，见 `defaultPort`）：
 *
 * - **`default`**：要 `port` 设置里那个（缺省 2870），**被占就不开这道口**（报错，不退让）。
 *   不开比开在别处强——开在别处是静默打错门，不开是当场看得见
 * - **其它 home**：缺省要系统随机口（多 home 同开是常态，没有哪个串是它的契约）。
 *   设置里显式给了口就试那个，被占照旧退让到随机口
 */

/** 日常车道永远打它 */
export const DEFAULT_HOME = 'default'

/** default home 的固定口 */
export const DEFAULT_HOME_PORT = 2870

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
  // default：要哪个口都行，唯独不许退让——退让就是把车道让给先起来的那个 home
  if (homeName === DEFAULT_HOME) return { port: asked ?? DEFAULT_HOME_PORT, fallback: false }
  // 其它 home 不给端口就是系统随机口；随机口没有「被占」这回事，退让位留 false
  if (asked === undefined || asked === 0) return { port: 0, fallback: false }
  return { port: asked, fallback: true }
}

/** 这道口的基址。只服务本机，所以主机名是钉死的；两条路由都挂在它下面 */
export function endpointUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}

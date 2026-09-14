import path from 'node:path'

/**
 * 注册表本体，不碰 ctx——`warn` 由调用方给，真跑时是 cordis logger。
 * 校验放在**注册**这一刻，不放到调用时：登记不合规的东西当场就该炸，
 * 拖到跑的时候才发现的话，现场已经离注册点很远了。
 */

/** 默认给一分钟 */
export const DEFAULT_TIMEOUT_MS = 60_000
/**
 * 上限钉死 110 秒。**这条线原来卡的是内核那条 120 秒硬超时的 fd3 通道**；单进程内核里
 * 件与桥同进程、没有那道闸了,但这个上限留着：一条 CLI 跑过两分钟还不回,人要的是一句
 * timedOut 加一份 spillPath,不是一个永远不回的 promise。
 */
export const MAX_TIMEOUT_MS = 110_000

/** 消费方登记一条命令时给的东西 */
export interface NodeCliSpec {
  /** 命令名,同时是挂进 gwbCommands 总线的那个名字 */
  name: string
  description?: string
  /** 用法（参数形状、行为注意）——commands 0.4 起与 description 分家。缺省用运行器的调用形状说明 */
  usage?: string
  /**
   * 要跑的那个 js 的**绝对路径**。件自己算：
   * `path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'dist', 'cli.js')`
   *
   * 这儿不做任何解析——不读 `bin` 字段、不认 `.bin` 垫片、不查 PATH。判据见文档站
   */
  entry: string
  /** 固定前缀参数。调用时给的参数追加在它后面 */
  args?: readonly string[]
  /** 不给就落在 `entry` 自己旁边。**不继承宿主的 cwd**——那是内核的目录,跟这条命令无关 */
  cwd?: string
  env?: Record<string, string>
  /** 不给就是 DEFAULT_TIMEOUT_MS。超过 MAX_TIMEOUT_MS 当场拒绝注册 */
  timeoutMs?: number
  /**
   * 镜像成总线命令时的 `plugin` 归属。缺省取调用方的身份（包名）——
   * 那是 `@godcreator/gwb-<名>` 这种全名，`/surface` 按插件名过滤时对不上。
   * 登记方知道自己的插件名（`export const name`），点名就能对齐口径
   */
  plugin?: string
}

/** 表里存着的样子:该填的都填上了,加上注册方的身份 */
export interface RegisteredNodeCli {
  name: string
  description: string
  entry: string
  args: readonly string[]
  cwd: string | undefined
  env: Record<string, string> | undefined
  timeoutMs: number
  /** 哪个件登记的。由服务从 fiber 上取,件报不出别人的名字 */
  plugin: string
}

export interface NodeCliRegistry {
  register(plugin: string, spec: NodeCliSpec): () => void
  list(): RegisteredNodeCli[]
  get(name: string): RegisteredNodeCli | undefined
}

/** 收窄一条 spec,不合规当场抛。抛出的话是给写件的人看的,要说清哪儿不对 */
export function normalize(plugin: string, spec: NodeCliSpec): RegisteredNodeCli {
  const name = spec.name
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('命令名不能是空的')
  }
  if (/\s/.test(name)) {
    throw new Error(`命令名里不许有空白：${JSON.stringify(name)}`)
  }
  if (typeof spec.entry !== 'string' || spec.entry === '') {
    throw new Error(`命令 ${name} 没给 entry——要跑哪个 js 得说清楚`)
  }
  // 相对路径解释不了:这儿不知道该相对于谁。件自己用 import.meta.url 算绝对路径
  if (!path.isAbsolute(spec.entry)) {
    throw new Error(`命令 ${name} 的 entry 得是绝对路径,给的是：${spec.entry}`)
  }
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`命令 ${name} 的 timeoutMs 得是个正数,给的是：${String(spec.timeoutMs)}`)
  }
  if (timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(
      `命令 ${name} 的 timeoutMs ${timeoutMs} 超了上限 ${MAX_TIMEOUT_MS}——` +
        '跑过两分钟还不回的话,人要的是一句 timedOut 加一份 spillPath,不是一个永远不回的 promise',
    )
  }
  return {
    name,
    description: spec.description ?? '',
    entry: spec.entry,
    args: [...(spec.args ?? [])],
    cwd: spec.cwd,
    env: spec.env,
    timeoutMs,
    plugin,
  }
}

export function createRegistry(warn: (message: string) => void): NodeCliRegistry {
  const byName = new Map<string, RegisteredNodeCli>()

  return {
    register(plugin, spec) {
      const record = normalize(plugin, spec)
      const prev = byName.get(record.name)
      // 撞名后来者赢,但要告警
      if (prev !== undefined) {
        warn(`命令 ${record.name} 被重复注册,后来者生效：${prev.plugin} → ${record.plugin}`)
      }
      byName.set(record.name, record)
      // 只收自己那份:HMR 时新的先注册覆盖、旧的后 dispose,无条件删会把新的一起带走
      return () => {
        if (byName.get(record.name) === record) byName.delete(record.name)
      }
    },

    list() {
      return [...byName.values()]
    },

    get(name) {
      return byName.get(name)
    },
  }
}

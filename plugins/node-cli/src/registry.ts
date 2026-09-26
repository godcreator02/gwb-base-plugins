import path from 'node:path'
import type { GwbCommandEffect } from '@godcreator/gwb-commands'

// 这个文件不碰 ctx：`warn` 由调用方给，运行时是 cordis logger

export const DEFAULT_TIMEOUT_MS = 60_000
/** Node 定时器能表示的最大延迟；超过会被运行时截成 1ms，必须拒绝 */
export const MAX_TIMEOUT_MS = 2_147_483_647

/** 调用方登记一条命令时给的东西 */
export interface NodeCliSpec {
  /** 命令名，同时是登记到 gwbCommands 总线上的名字 */
  name: string
  /** 一句话介绍。登记成总线命令时命令总线要求非空，不给登记会被拒 */
  description?: string
  /** 用法（参数形状、注意事项）。缺省用运行插件写的参数形状说明 */
  usage?: string
  /** 登记成总线命令时写的 `effect`：这条工具运行起来会动到什么，含义见命令总线的 `GwbCommandEffect` */
  effect?: GwbCommandEffect
  /**
   * 要运行的那个 js 的绝对路径，登记方插件自己算：
   * `path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'dist', 'cli.js')`。
   * 这里不做任何解析：不读 `bin` 字段、不认 `.bin` 里的包装脚本、不查 PATH
   */
  entry: string
  /** 固定前缀参数。调用时给的参数追加在它后面 */
  args?: readonly string[]
  /** 不给就是 `entry` 所在目录。不继承宿主的 cwd——那是内核的目录，跟这条命令无关 */
  cwd?: string
  env?: Record<string, string>
  /** 不给就是 DEFAULT_TIMEOUT_MS；显式给可以延长，最大是 MAX_TIMEOUT_MS */
  timeoutMs?: number
  /**
   * 登记成总线命令时写的 `plugin`。缺省是调用方条目的包名（MCP 入口的 `search` 按它精确筛）；
   * 给了也必须是调用方的包名，不同的命令总线会拒
   */
  plugin?: string
}

/** 表里存的样子：该填的都填上，加上登记方的身份 */
export interface RegisteredNodeCli {
  name: string
  description: string
  entry: string
  args: readonly string[]
  cwd: string | undefined
  env: Record<string, string> | undefined
  timeoutMs: number
  /** 登记它的插件。由服务从 fiber 上取，登记方报不出别人的名字 */
  plugin: string
}

export interface NodeCliRegistry {
  register(plugin: string, spec: NodeCliSpec): () => void
  list(): RegisteredNodeCli[]
  get(name: string): RegisteredNodeCli | undefined
}

function assertValidCommandName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('命令名不能是空的')
  }
  if (/\s/.test(name)) {
    throw new Error(`命令名里不许有空白：${JSON.stringify(name)}`)
  }
}

function assertAbsoluteEntry(name: string, entry: unknown): void {
  if (typeof entry !== 'string' || entry === '') {
    throw new Error(`命令 ${name} 没给 entry——要写明运行哪个 js`)
  }
  // 相对路径没法解释：这里不知道该相对于谁
  if (!path.isAbsolute(entry)) {
    throw new Error(`命令 ${name} 的 entry 得是绝对路径,给的是：${entry}`)
  }
}

function timeoutWithinLimits(name: string, requestedTimeoutMs: number | undefined): number {
  const timeoutMs = requestedTimeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`命令 ${name} 的 timeoutMs 得是个正数,给的是：${String(requestedTimeoutMs)}`)
  }
  if (timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(
      `命令 ${name} 的 timeoutMs ${timeoutMs} 超了上限 ${MAX_TIMEOUT_MS}——` +
        '超过 Node 定时器范围会变成 1ms，不能用来表示无限等待',
    )
  }
  return timeoutMs
}

/** 收窄一条 spec，不合规当场抛。报错是给写登记方插件的人看的，要说清哪儿不对 */
export function normalize(plugin: string, spec: NodeCliSpec): RegisteredNodeCli {
  const name = spec.name
  assertValidCommandName(name)
  assertAbsoluteEntry(name, spec.entry)
  const timeoutMs = timeoutWithinLimits(name, spec.timeoutMs)
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
  const registrationsByName = new Map<string, RegisteredNodeCli>()

  return {
    register(plugin, spec) {
      const registration = normalize(plugin, spec)
      const previous = registrationsByName.get(registration.name)
      if (previous !== undefined) {
        warn(`命令 ${registration.name} 被重复注册,后来者生效：${previous.plugin} → ${registration.plugin}`)
      }
      registrationsByName.set(registration.name, registration)
      // 只删自己这条：热重载时新的先登记覆盖、旧的后注销，无条件删会把新的一起删掉
      return () => {
        if (registrationsByName.get(registration.name) === registration) registrationsByName.delete(registration.name)
      }
    },

    list() {
      return [...registrationsByName.values()]
    },

    get(name) {
      return registrationsByName.get(name)
    },
  }
}

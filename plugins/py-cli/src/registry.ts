import path from 'node:path'

// 这个文件不碰 ctx：`warn` 由调用方给，运行时是 cordis logger

export const DEFAULT_TIMEOUT_MS = 60_000
/** Node 定时器能表示的最大延迟；超过会被运行时截成 1ms，必须拒绝 */
export const MAX_TIMEOUT_MS = 2_147_483_647

/** 调用方登记一条命令时给的东西 */
export interface PyCliSpec {
  /** 命令名，同时是登记到 gwbCommands 总线上的名字 */
  name: string
  description?: string
  /** 用法（参数形状、注意事项）。缺省用运行插件写的参数形状说明 */
  usage?: string
  /**
   * 登记方插件自己的包根，venv 建在 `<packageRoot>/py/.venv`。登记方自己算：
   * `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')`
   */
  packageRoot: string
  /** `pyproject.toml` 里的项目名与版本。venv 检查拿它比对 `dist-info`，不启动 python */
  distName: string
  version: string
  /** `[project.scripts]` 里的入口点名 → 运行 `<venv>/Scripts/<command>.exe`。跟 `module` 二选一 */
  command?: string
  /** 或者模块名 → 运行 `<venv>/Scripts/python.exe -m <module>` */
  module?: string
  /** 固定前缀参数。调用时给的参数追加在它后面 */
  args?: readonly string[]
  /** 不给就是那个 python 项目目录（`<packageRoot>/py`） */
  cwd?: string
  env?: Record<string, string>
  /** 不给就是 DEFAULT_TIMEOUT_MS；显式给可以延长，最大是 MAX_TIMEOUT_MS */
  timeoutMs?: number
}

/** 表里存的样子 */
export interface RegisteredPyCli {
  name: string
  description: string
  packageRoot: string
  distName: string
  version: string
  command: string | undefined
  module: string | undefined
  args: readonly string[]
  cwd: string | undefined
  env: Record<string, string> | undefined
  timeoutMs: number
  /** 登记它的插件。由服务从 fiber 上取，登记方报不出别人的名字 */
  plugin: string
}

export interface PyCliRegistry {
  register(plugin: string, spec: PyCliSpec): () => void
  list(): RegisteredPyCli[]
  get(name: string): RegisteredPyCli | undefined
}

function assertValidCommandName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('命令名不能是空的')
  }
  if (/\s/.test(name)) {
    throw new Error(`命令名里不许有空白：${JSON.stringify(name)}`)
  }
}

function assertProjectIdentity(name: string, spec: PyCliSpec): void {
  if (typeof spec.packageRoot !== 'string' || !path.isAbsolute(spec.packageRoot)) {
    throw new Error(`命令 ${name} 的 packageRoot 得是绝对路径,给的是：${String(spec.packageRoot)}`)
  }
  if (typeof spec.distName !== 'string' || spec.distName === '') {
    throw new Error(`命令 ${name} 没给 distName——venv 检查拿它比对装没装对版本`)
  }
  if (typeof spec.version !== 'string' || spec.version === '') {
    throw new Error(`命令 ${name} 没给 version——venv 检查拿它比对装没装对版本`)
  }
}

/** `command` 与 `module` 恰好给一个 */
function whichEntryPointIsGiven(name: string, spec: PyCliSpec): { hasCommand: boolean; hasModule: boolean } {
  const hasCommand = typeof spec.command === 'string' && spec.command !== ''
  const hasModule = typeof spec.module === 'string' && spec.module !== ''
  if (!hasCommand && !hasModule) {
    throw new Error(`命令 ${name} 得说清跑什么：command（入口点垫片）或 module（python -m）给一个`)
  }
  if (hasCommand && hasModule) {
    throw new Error(`命令 ${name} 的 command 与 module 只能给一个`)
  }
  return { hasCommand, hasModule }
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
export function normalize(plugin: string, spec: PyCliSpec): RegisteredPyCli {
  const name = spec.name
  assertValidCommandName(name)
  assertProjectIdentity(name, spec)
  const { hasCommand, hasModule } = whichEntryPointIsGiven(name, spec)
  const timeoutMs = timeoutWithinLimits(name, spec.timeoutMs)
  return {
    name,
    description: spec.description ?? '',
    packageRoot: spec.packageRoot,
    distName: spec.distName,
    version: spec.version,
    command: hasCommand ? spec.command : undefined,
    module: hasModule ? spec.module : undefined,
    args: [...(spec.args ?? [])],
    cwd: spec.cwd,
    env: spec.env,
    timeoutMs,
    plugin,
  }
}

export function createRegistry(warn: (message: string) => void): PyCliRegistry {
  const registrationsByName = new Map<string, RegisteredPyCli>()

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

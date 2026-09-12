import path from 'node:path'

/**
 * 注册表本体，不碰 ctx——`warn` 由调用方给，真跑时是 cordis logger。
 * 校验放在**注册**这一刻：登记不合规的东西当场就该炸，拖到跑的时候才发现的话，
 * 现场已经离注册点很远了。
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
export interface PyCliSpec {
  /** 命令名,同时是挂进 gwbCommands 总线的那个名字 */
  name: string
  description?: string
  /**
   * 件自己的包根。venv 建在 `<packageRoot>/py/.venv`,件自己算：
   * `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')`
   */
  packageRoot: string
  /** `pyproject.toml` 里的项目名与版本。守卫拿它比对 `dist-info`,不起 python */
  distName: string
  version: string
  /**
   * `[project.scripts]` 里那个入口点名 → 跑 `<venv>/Scripts/<command>.exe`。
   * 跟 `module` 二选一
   */
  command?: string
  /** 或者模块形态 → 跑 `<venv>/Scripts/python.exe -m <module>` */
  module?: string
  /** 固定前缀参数。调用时给的参数追加在它后面 */
  args?: readonly string[]
  /** 不给就落在那个 python 项目目录（`<packageRoot>/py`）*/
  cwd?: string
  env?: Record<string, string>
  /** 不给就是 DEFAULT_TIMEOUT_MS。超过 MAX_TIMEOUT_MS 当场拒绝注册 */
  timeoutMs?: number
}

/** 表里存着的样子 */
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
  /** 哪个件登记的。由服务从 fiber 上取,件报不出别人的名字 */
  plugin: string
}

export interface PyCliRegistry {
  register(plugin: string, spec: PyCliSpec): () => void
  list(): RegisteredPyCli[]
  get(name: string): RegisteredPyCli | undefined
}

/** 收窄一条 spec,不合规当场抛。抛出的话是给写件的人看的,要说清哪儿不对 */
export function normalize(plugin: string, spec: PyCliSpec): RegisteredPyCli {
  const name = spec.name
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('命令名不能是空的')
  }
  if (/\s/.test(name)) {
    throw new Error(`命令名里不许有空白：${JSON.stringify(name)}`)
  }
  if (typeof spec.packageRoot !== 'string' || !path.isAbsolute(spec.packageRoot)) {
    throw new Error(`命令 ${name} 的 packageRoot 得是绝对路径,给的是：${String(spec.packageRoot)}`)
  }
  if (typeof spec.distName !== 'string' || spec.distName === '') {
    throw new Error(`命令 ${name} 没给 distName——守卫拿它比对装没装对版本`)
  }
  if (typeof spec.version !== 'string' || spec.version === '') {
    throw new Error(`命令 ${name} 没给 version——守卫拿它比对装没装对版本`)
  }
  const hasCommand = typeof spec.command === 'string' && spec.command !== ''
  const hasModule = typeof spec.module === 'string' && spec.module !== ''
  if (!hasCommand && !hasModule) {
    throw new Error(`命令 ${name} 得说清跑什么：command（入口点垫片）或 module（python -m）给一个`)
  }
  if (hasCommand && hasModule) {
    throw new Error(`命令 ${name} 的 command 与 module 只能给一个`)
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
  const byName = new Map<string, RegisteredPyCli>()

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

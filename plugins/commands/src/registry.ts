import type { GwbResult } from './result.js'

/**
 * 调这条命令会动到什么。agent 靠它判断能不能直接调：
 * `read` 什么都不改（联网只读也算）；`write` 改本机的文件、设置、数据或界面；
 * `external` 影响本机以外或打扰人：推送、发到远端、发消息、弹窗或通知
 */
export type GwbCommandEffect = 'read' | 'write' | 'external'

export const COMMAND_EFFECTS: readonly GwbCommandEffect[] = ['read', 'write', 'external']

/** 一条命令的说明 */
export interface GwbCommandDef {
  name: string
  /** 一句话介绍，出现在 MCP 入口 index 的清单里，作用与说明书的 description 相同 */
  description: string
  /** 用法：参数形状、注意事项。search 命中的那一行带它，调用之前看它；无参数的命令写「无参数」 */
  usage: string
  /** 登记方的包名。不给由服务从调用方取；给了必须与调用方的包名相同 */
  plugin?: string
  /** 调它会动到什么，必填；MCP 入口的 search 带出这一项 */
  effect: GwbCommandEffect
  /** 只给页面调用：MCP 入口不列出、agent 调不到。页面与别的插件照常调 */
  hiddenFromAgents?: true
}

/** 命令表里存的样子：`plugin` 是登记方的完整包名；`hiddenFromAgents` 没写就没有这一项 */
export type RegisteredCommandDef = Required<Pick<GwbCommandDef, 'name' | 'description' | 'usage' | 'plugin' | 'effect'>> &
  Pick<GwbCommandDef, 'hiddenFromAgents'>

/** 请求从哪来：`ui` 是页面请求处理器标注的，`mcp` 是 agent 经 MCP 入口调的，`plugin` 是别的插件直接调的 */
export type GwbRequestSource = 'ui' | 'mcp' | 'plugin'

/** 交给处理函数的第二个参数。命令总线只转交，不按来源限制谁能调什么 */
export interface GwbCommandContext {
  via: GwbRequestSource
}

export type GwbCommandHandler = (args: unknown, context: GwbCommandContext) => unknown

/** 命令总线对外的接口。插件之间的契约，放在提供方这个包里 */
export interface GwbCommands {
  /**
   * 登记一条命令，返回注销函数。name、description、usage 缺一或为空串、没写 effect、plugin 与调用方的包名不同都直接抛错。
   * 调用方卸载会自动注销；注销函数重复调用无副作用
   */
  register(def: GwbCommandDef, handler: GwbCommandHandler): () => void
  list(): RegisteredCommandDef[]
  /** 页面请求处理器（兼容入口由内核）带 `{ via: 'ui' }`，MCP 入口带 `{ via: 'mcp' }`；插件直接调不带，处理函数收到的是 `plugin` */
  run(name: string, args?: unknown, context?: GwbCommandContext): Promise<GwbResult>
}

/** 命令表写日志用的三个级别。运行时传入 cordis 的 logger，它有这三个级别 */
export interface RegistryLog {
  debug: (message: string) => void
  info: (message: string) => void
  warn: (message: string) => void
}

/** 命令表本身：只收检查过的定义，登记方是谁由调用者给出 */
export interface CommandTable {
  register(def: RegisteredCommandDef, handler: GwbCommandHandler): () => void
  list(): RegisteredCommandDef[]
  run(name: string, args?: unknown, context?: GwbCommandContext): Promise<GwbResult>
}

interface CommandRegistration {
  def: RegisteredCommandDef
  handler: GwbCommandHandler
}

const DIRECT_PLUGIN_CALL: GwbCommandContext = { via: 'plugin' }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

const HOW_TO_WRITE_REQUIRED_TEXT = {
  description: '写一句话说明这条命令做什么',
  usage: '写参数形状与注意事项，无参数的命令写「无参数」',
} as const

const EFFECT_MEANINGS =
  "'read' 什么都不改（联网只读也算），'write' 改本机的文件、设置、数据或界面，'external' 影响本机以外或打扰人（推送、发到远端、发消息、弹窗或通知）"

/**
 * 登记方传来的定义是外部输入：逐项检查，不合规抛错并写明哪个包、哪条命令、缺什么、该怎么写。
 * `callerPackage` 是服务从调用方取到的包名，`plugin` 不给就用它
 */
export function checkedCommandDef(callerPackage: string, def: GwbCommandDef): RegisteredCommandDef {
  if (!isNonEmptyString(def.name)) {
    throw new Error(`包 ${callerPackage} 登记的命令缺 name：name 要是非空字符串，写成「<短名>.<动作>」`)
  }
  for (const field of ['description', 'usage'] as const) {
    if (!isNonEmptyString(def[field])) {
      throw new Error(`包 ${callerPackage} 的命令 ${def.name} 缺 ${field}：${field} 要是非空字符串，${HOW_TO_WRITE_REQUIRED_TEXT[field]}`)
    }
  }
  if (def.plugin !== undefined && def.plugin !== callerPackage) {
    throw new Error(
      `包 ${callerPackage} 的命令 ${def.name} 的 plugin 写的是「${String(def.plugin)}」，与调用方的包名 ${callerPackage} 不同：删掉 plugin，或写成 ${callerPackage}`,
    )
  }
  if (def.effect === undefined) {
    throw new Error(`包 ${callerPackage} 的命令 ${def.name} 缺 effect：effect 必填，按调用的实际后果写 ${EFFECT_MEANINGS}`)
  }
  if (!COMMAND_EFFECTS.includes(def.effect)) {
    throw new Error(`包 ${callerPackage} 的命令 ${def.name} 的 effect 写的是「${String(def.effect)}」：只能是 ${COMMAND_EFFECTS.join(' / ')}，${EFFECT_MEANINGS}`)
  }
  if (def.hiddenFromAgents !== undefined && def.hiddenFromAgents !== true) {
    throw new Error(`包 ${callerPackage} 的命令 ${def.name} 的 hiddenFromAgents 写的是「${String(def.hiddenFromAgents)}」：只能是 true，或者不写`)
  }
  const checked: RegisteredCommandDef = { name: def.name, description: def.description, usage: def.usage, plugin: callerPackage, effect: def.effect }
  if (def.hiddenFromAgents === true) checked.hiddenFromAgents = true
  return checked
}

function logRegistrationOrOverride(log: RegistryLog, incoming: RegisteredCommandDef, previous: CommandRegistration | undefined): void {
  if (previous !== undefined) {
    log.warn(`命令 ${incoming.name} 被重复登记，后登记的生效：${previous.def.plugin} → ${incoming.plugin}`)
  } else {
    log.info(`命令 ${incoming.name} 已登记（${incoming.plugin}）`)
  }
}

function isReceiptShaped(handlerResult: unknown): handlerResult is GwbResult {
  return handlerResult !== null && typeof handlerResult === 'object' && 'ok' in handlerResult
}

/** 只读命令的成功不记：窗格与页面每秒都在轮询它们。其余命令的成功记 debug，内核默认不写进 gwb.log */
function logSuccess(log: RegistryLog, def: RegisteredCommandDef): void {
  if (def.effect === 'read') return
  log.debug(`命令 ${def.name} 执行完成`)
}

function logReceiptOutcome(log: RegistryLog, def: RegisteredCommandDef, receipt: GwbResult): void {
  if (receipt.ok) logSuccess(log, def)
  else log.warn(`命令 ${def.name} 返回失败：${receipt.error ?? '没有给出原因'}`)
}

/** 处理函数自己返回了带 ok 的对象就原样交回，其余一律包成 `{ ok: true, data }` */
function receiptFromHandlerResult(log: RegistryLog, def: RegisteredCommandDef, handlerResult: unknown): GwbResult {
  if (isReceiptShaped(handlerResult)) {
    logReceiptOutcome(log, def, handlerResult)
    return handlerResult
  }
  logSuccess(log, def)
  return { ok: true, data: handlerResult }
}

/** 命令表本身，不依赖 ctx；取登记方身份、注销跟着调用方走由服务类 `GwbCommandBus` 负责 */
export function createRegistry(log: RegistryLog): CommandTable {
  const registrationsByName = new Map<string, CommandRegistration>()

  return {
    register(def, handler) {
      const registration: CommandRegistration = { def, handler }
      logRegistrationOrOverride(log, def, registrationsByName.get(def.name))
      registrationsByName.set(def.name, registration)
      // 只删自己这条：同名命令被后来者替换后，先登记的一方注销时不能删掉接手的那条
      return () => {
        if (registrationsByName.get(def.name) === registration) registrationsByName.delete(def.name)
      }
    },

    list() {
      return [...registrationsByName.values()].map((registration) => registration.def)
    },

    async run(name, args, context = DIRECT_PLUGIN_CALL) {
      const registration = registrationsByName.get(name)
      if (registration === undefined) {
        log.warn(`调用了不存在的命令：${name}`)
        return { ok: false, error: `没有这条命令：${name}` }
      }
      try {
        return receiptFromHandlerResult(log, registration.def, await registration.handler(args, context))
      } catch (thrown) {
        log.warn(`命令 ${name} 抛出异常，已转成失败回执：${String(thrown)}`)
        return { ok: false, error: String(thrown) }
      }
    },
  }
}

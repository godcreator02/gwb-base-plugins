import type { GwbResult } from '@godcreator/gwb-plugin-api'

/** 一条命令的说明。`plugin` 由登记方自己填写 */
export interface GwbCommandDef {
  name: string
  /** 一句话介绍，出现在 MCP 入口 index 的清单里，作用与说明书的 description 相同 */
  description?: string
  /** 用法：参数形状、注意事项。search 命中的那一行带它，调用之前看它（无参数的命令可以不给） */
  usage?: string
  plugin: string
}

/** 命令总线对外的接口。插件之间的契约，放在提供方这个包里 */
export interface GwbCommands {
  /** 登记一条命令，返回注销函数。经服务 `ctx.gwbCommands` 登记时，调用方卸载会自动注销；注销函数重复调用无副作用 */
  register(def: GwbCommandDef, handler: (args?: unknown) => unknown): () => void
  list(): Required<GwbCommandDef>[]
  run(name: string, args?: unknown): Promise<GwbResult>
}

/** 命令表写日志用的两个级别。运行时传入 cordis 的 logger，它有这两个级别 */
export interface RegistryLog {
  info: (message: string) => void
  warn: (message: string) => void
}

type CommandHandler = (args?: unknown) => unknown

interface CommandRegistration {
  def: Required<GwbCommandDef>
  handler: CommandHandler
}

function withEmptyTextFilledIn(def: GwbCommandDef): Required<GwbCommandDef> {
  return { name: def.name, description: def.description ?? '', usage: def.usage ?? '', plugin: def.plugin }
}

function warnWhenPluginIsNotPackageName(log: RegistryLog, def: GwbCommandDef): void {
  if (!def.plugin.startsWith('@')) {
    log.warn(`命令 ${def.name} 的 plugin 该写包名（如 @godcreator/gwb-xxx），收到的是「${def.plugin}」`)
  }
}

function logRegistrationOrOverride(log: RegistryLog, incoming: Required<GwbCommandDef>, previous: CommandRegistration | undefined): void {
  if (previous !== undefined) {
    log.warn(`命令 ${incoming.name} 被重复登记，后登记的生效：${previous.def.plugin} → ${incoming.plugin}`)
  } else {
    log.info(`命令 ${incoming.name} 已登记（${incoming.plugin}）`)
  }
}

function isReceiptShaped(handlerResult: unknown): handlerResult is GwbResult {
  return handlerResult !== null && typeof handlerResult === 'object' && 'ok' in handlerResult
}

function logReceiptOutcome(log: RegistryLog, name: string, receipt: GwbResult): void {
  if (receipt.ok) log.info(`命令 ${name} 执行完成`)
  else log.warn(`命令 ${name} 返回失败：${receipt.error ?? '没有给出原因'}`)
}

/** 处理函数自己返回了带 ok 的对象就原样交回，其余一律包成 `{ ok: true, data }` */
function receiptFromHandlerResult(log: RegistryLog, name: string, handlerResult: unknown): GwbResult {
  if (isReceiptShaped(handlerResult)) {
    logReceiptOutcome(log, name, handlerResult)
    return handlerResult
  }
  log.info(`命令 ${name} 执行完成`)
  return { ok: true, data: handlerResult }
}

/** 命令表本身，不依赖 ctx；注销跟着调用方走由服务类 `GwbCommandBus` 负责 */
export function createRegistry(log: RegistryLog): GwbCommands {
  const registrationsByName = new Map<string, CommandRegistration>()

  return {
    register(def, handler) {
      warnWhenPluginIsNotPackageName(log, def)
      const registration: CommandRegistration = { def: withEmptyTextFilledIn(def), handler }
      logRegistrationOrOverride(log, registration.def, registrationsByName.get(def.name))
      registrationsByName.set(def.name, registration)
      // 只删自己这条：同名命令被后来者替换后，先登记的一方注销时不能删掉接手的那条
      return () => {
        if (registrationsByName.get(def.name) === registration) registrationsByName.delete(def.name)
      }
    },

    list() {
      return [...registrationsByName.values()].map((registration) => registration.def)
    },

    async run(name, args) {
      const registration = registrationsByName.get(name)
      if (registration === undefined) {
        log.warn(`调用了不存在的命令：${name}`)
        return { ok: false, error: `没有这条命令：${name}` }
      }
      try {
        return receiptFromHandlerResult(log, name, await registration.handler(args))
      } catch (thrown) {
        log.warn(`命令 ${name} 抛出异常，已转成失败回执：${String(thrown)}`)
        return { ok: false, error: String(thrown) }
      }
    },
  }
}

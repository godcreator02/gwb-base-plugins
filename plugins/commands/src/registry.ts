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
  /** 登记一条命令，返回注销函数；调用方用 ctx.effect 包住，卸载时自动注销 */
  register(def: GwbCommandDef, handler: (args?: unknown) => unknown): () => void
  list(): Required<GwbCommandDef>[]
  run(name: string, args?: unknown): Promise<GwbResult>
}

/** 命令表写日志用的两个级别。运行时传入 cordis 的 logger，它有这两个级别 */
export interface RegistryLog {
  info: (message: string) => void
  warn: (message: string) => void
}

/**
 * 命令表本身，不依赖 ctx。
 *
 * **每次登记与执行都写日志**：执行时的异常会转成失败回执交给调用方，不写日志的话，
 * 日志里查不到谁在什么时候调了哪条命令、结果如何。
 */
export function createRegistry(log: RegistryLog): GwbCommands {
  const byName = new Map<string, { def: Required<GwbCommandDef>; handler: (args?: unknown) => unknown }>()

  return {
    register(def, handler) {
      const entry = { name: def.name, description: def.description ?? '', usage: def.usage ?? '', plugin: def.plugin }
      // plugin 写包名：agent 按包名装卸、升级插件，按包名筛选命令。写成短名的只告警，照常登记
      if (!def.plugin.startsWith('@')) {
        log.warn(`命令 ${def.name} 的 plugin 该写包名（如 @godcreator/gwb-xxx），收到的是「${def.plugin}」`)
      }
      const record = { def: entry, handler }
      const prev = byName.get(def.name)
      // 同名时后登记的生效，但要告警：不告警的话调用方从此调到另一个插件上，两边都不报错
      if (prev !== undefined) {
        log.warn(`命令 ${def.name} 被重复登记，后登记的生效：${prev.def.plugin} → ${entry.plugin}`)
      } else {
        log.info(`命令 ${def.name} 已登记（${entry.plugin}）`)
      }
      byName.set(def.name, record)
      // 只删自己这条：同名命令被替换后，先登记的一方注销时不能删掉接手的那条
      return () => {
        if (byName.get(def.name) === record) byName.delete(def.name)
      }
    },

    list() {
      return [...byName.values()].map((r) => r.def)
    },

    async run(name, args) {
      const found = byName.get(name)
      if (found === undefined) {
        log.warn(`调用了不存在的命令：${name}`)
        return { ok: false, error: `没有这条命令：${name}` }
      }
      try {
        const result = await found.handler(args)
        // 处理函数返回了带 ok 的对象就原样返回，其余一律算成功
        if (result !== null && typeof result === 'object' && 'ok' in result) {
          const typed = result as GwbResult
          if (typed.ok) log.info(`命令 ${name} 执行完成`)
          else log.warn(`命令 ${name} 返回失败：${typed.error ?? '没有给出原因'}`)
          return typed
        }
        log.info(`命令 ${name} 执行完成`)
        return { ok: true, data: result }
      } catch (err) {
        // 不把异常抛给调用方：调用方可能是页面上的一次点击
        log.warn(`命令 ${name} 抛出异常，已转成失败回执：${String(err)}`)
        return { ok: false, error: String(err) }
      }
    },
  }
}

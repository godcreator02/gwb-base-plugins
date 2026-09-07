import type { GwbResult } from '@godcreator02/gwb-plugin-api'

/** 一条命令的自述。`plugin` 由注册方自带 */
export interface GwbCommandDef {
  name: string
  description?: string
  plugin: string
}

/** 命令总线的面。件之间的契约，住在提供方这个包里 */
export interface GwbCommands {
  /** 注册一条命令,返回注销函数（配 ctx.effect 用,消费者卸载时自动回收）*/
  register(def: GwbCommandDef, handler: (args?: unknown) => unknown): () => void
  list(): Required<GwbCommandDef>[]
  run(name: string, args?: unknown): Promise<GwbResult>
}

/** 注册表本体，不碰 ctx。`warn` 由调用方给，真跑时是 cordis logger */
export function createRegistry(warn: (message: string) => void): GwbCommands {
  const table = new Map<string, { def: Required<GwbCommandDef>; handler: (args?: unknown) => unknown }>()

  return {
    register(def, handler) {
      const entry = { name: def.name, description: def.description ?? '', plugin: def.plugin }
      const record = { def: entry, handler }
      const prev = table.get(def.name)
      // 撞名后来者赢，但要告警
      if (prev !== undefined) {
        warn(`命令 ${def.name} 被重复注册，后来者生效：${prev.def.plugin} → ${entry.plugin}`)
      }
      table.set(def.name, record)
      // 只收自己那份
      return () => {
        if (table.get(def.name) === record) table.delete(def.name)
      }
    },

    list() {
      return [...table.values()].map((r) => r.def)
    },

    async run(name, args) {
      const found = table.get(name)
      if (found === undefined) return { ok: false, error: `没有这条命令：${name}` }
      try {
        const result = await found.handler(args)
        // handler 自己判过成败就原样透传，没判的一律算成了
        if (result !== null && typeof result === 'object' && 'ok' in result) return result as GwbResult
        return { ok: true, data: result }
      } catch (err) {
        // 不炸到调用方
        return { ok: false, error: String(err) }
      }
    },
  }
}

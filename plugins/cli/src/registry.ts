import type { GwbResult } from '@godcreator02/gwb-plugin-api'

/** 一条命令的自述。`plugin` 由注册方自带——ctx.name 是 cordis 的追踪属性,没 inject 就读会抛 */
export interface GwbCommandDef {
  name: string
  description?: string
  plugin: string
}

/** 命令总线的面。**这是插件之间的契约,住在提供方这个包里**——内核不知道有它 */
export interface GwbCli {
  /** 注册一条命令,返回注销函数（配 ctx.effect 用,消费者卸载时自动回收）*/
  register(def: GwbCommandDef, handler: (args?: unknown) => unknown): () => void
  list(): Required<GwbCommandDef>[]
  run(name: string, args?: unknown): Promise<GwbResult>
}

/**
 * 注册表本体。抠成纯函数不碰 ctx:这样它可测,而 apply 里只剩接线。
 * `warn` 由调用方给（真跑时是 cordis logger）。
 */
export function createRegistry(warn: (message: string) => void): GwbCli {
  const table = new Map<string, { def: Required<GwbCommandDef>; handler: (args?: unknown) => unknown }>()

  return {
    register(def, handler) {
      const entry = { name: def.name, description: def.description ?? '', plugin: def.plugin }
      const record = { def: entry, handler }
      const prev = table.get(def.name)
      // 撞名后来者赢（件一律平等,换掉一条命令是应有之义),但不能静默地赢:
      // 调用方从此打到另一个件的处理器上,而两边谁都不会报错
      if (prev !== undefined) {
        warn(`命令 ${def.name} 被重复注册，后来者生效：${prev.def.plugin} → ${entry.plugin}`)
      }
      table.set(def.name, record)
      // 只收自己那份:撞名之后先卸载的那个件,不该把接手的那份一起带走
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
        // handler 自己判过成败就原样透传;没判的一律算成了
        if (result !== null && typeof result === 'object' && 'ok' in result) return result as GwbResult
        return { ok: true, data: result }
      } catch (err) {
        // 一条命令抛出来不该炸到调用方——它可能是界面上的一次点击
        return { ok: false, error: String(err) }
      }
    },
  }
}

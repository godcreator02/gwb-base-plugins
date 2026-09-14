import type { GwbResult } from '@godcreator02/gwb-plugin-api'

/** 一条命令的自述。`plugin` 由注册方自带 */
export interface GwbCommandDef {
  name: string
  /** 一句话介绍，进 index——与 skill 的 description 同义 */
  description?: string
  /** 用法：参数形状、行为注意——search 命中行带它，run 之前看它（无参数的命令可以不给） */
  usage?: string
  plugin: string
}

/** 命令总线的面。件之间的契约，住在提供方这个包里 */
export interface GwbCommands {
  /** 注册一条命令,返回注销函数（配 ctx.effect 用,消费者卸载时自动回收）*/
  register(def: GwbCommandDef, handler: (args?: unknown) => unknown): () => void
  list(): Required<GwbCommandDef>[]
  run(name: string, args?: unknown): Promise<GwbResult>
}

/** 注册表要的两级嗓门。真跑时给 cordis logger——它自带这两级 */
export interface RegistryLog {
  info: (message: string) => void
  warn: (message: string) => void
}

/**
 * 注册表本体，不碰 ctx。
 *
 * **每一条命令的登记与执行都出声**：run 过去把一切异常吞进回执，调用方看得到，
 * 日志里却毫无痕迹——「谁在什么时候调了什么、成没成」是命令总线最基本的账。
 */
export function createRegistry(log: RegistryLog): GwbCommands {
  const byName = new Map<string, { def: Required<GwbCommandDef>; handler: (args?: unknown) => unknown }>()

  return {
    register(def, handler) {
      const entry = { name: def.name, description: def.description ?? '', usage: def.usage ?? '', plugin: def.plugin }
      // 0.4 起的口径：plugin 写包名（@scope/pkg）——它是 agent 侧的操作键（装卸升、反馈投递
      // 都认包名），短名只住日志与散文。软守卫：旧口径 warn 一句不拦截，漏网的照挂
      if (!def.plugin.startsWith('@')) {
        log.warn(`命令 ${def.name} 的 plugin 该写包名（如 @godcreator02/gwb-xxx），收到的是「${def.plugin}」`)
      }
      const record = { def: entry, handler }
      const prev = byName.get(def.name)
      // 撞名后来者赢，但要告警
      if (prev !== undefined) {
        log.warn(`命令 ${def.name} 被重复注册，后来者生效：${prev.def.plugin} → ${entry.plugin}`)
      } else {
        log.info(`命令 ${def.name} 登记上了（${entry.plugin}）`)
      }
      byName.set(def.name, record)
      // 只收自己那份
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
        log.warn(`跑了条不存在的命令：${name}`)
        return { ok: false, error: `没有这条命令：${name}` }
      }
      try {
        const result = await found.handler(args)
        // handler 自己判过成败就原样透传，没判的一律算成了
        if (result !== null && typeof result === 'object' && 'ok' in result) {
          const typed = result as GwbResult
          if (typed.ok) log.info(`命令 ${name} 跑完了`)
          else log.warn(`命令 ${name} 回了失败：${typed.error ?? '没说原因'}`)
          return typed
        }
        log.info(`命令 ${name} 跑完了`)
        return { ok: true, data: result }
      } catch (err) {
        // 不炸到调用方
        log.warn(`命令 ${name} 抛了，收成回执：${String(err)}`)
        return { ok: false, error: String(err) }
      }
    },
  }
}

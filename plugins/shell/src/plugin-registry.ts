/**
 * 件级信息表：一条条目一条记录，件说「我叫什么」。不碰 ctx，测试在 node 里直接跑。
 *
 * **跟窗格表分开两张**：那张的键是 `(entryId, 窗格 id)`、一条条目可以有好几条；这张
 * 的键就是 `entryId`、一条条目至多一条。两张表也各有各的消费方（导航列件名吃这张，
 * 井里开格吃那张），合成一张只会让「哪条键管哪个」变含糊。
 *
 * **身份同样不由件自己报**——`entryId` 与 `pkg` 由服务那层从注册方的 fiber 上取。
 */

/** 件报自己名字时给的那几样 */
export interface PluginInfo {
  /** 给人看的名字。包名太长、也不是给人读的 */
  title: string
  /** lucide 的图标名（kebab-case）。画它是第四刀导航的事，这一刀只原样收下 */
  icon?: string
}

/** 表里一条：件给的那几样 + 服务填的身份 */
export interface RegisteredPlugin extends PluginInfo {
  entryId: string
  pkg: string
}

export interface PluginRegistry {
  /** 报一次名字，回注销函数（只收自己那份，摘两遍不炸） */
  describe(owner: { entryId: string; pkg: string }, info: PluginInfo): () => void
  /** 此刻表里有哪些件，按报名先后 */
  list(): RegisteredPlugin[]
}

/**
 * `warn` 由调用方给，真跑时是 cordis logger。
 *
 * 空 title 抛错、同一条条目报两次只告警——跟窗格注册一个规矩：「报了个空名字」是
 * 根本没说清，让它进表只会在导航里多出一行空白；「报了两次」则是两条都说得清、
 * 该听谁的问题。
 */
export function createPluginRegistry(warn: (message: string) => void): PluginRegistry {
  const table = new Map<string, RegisteredPlugin>()

  return {
    describe(owner, info) {
      if (info.title === '') throw new Error(`${owner.pkg} 报了个空标题`)
      const record: RegisteredPlugin = { ...info, entryId: owner.entryId, pkg: owner.pkg }
      const prev = table.get(owner.entryId)
      if (prev !== undefined) {
        warn(`条目 ${owner.entryId} 报了两次名字，后来者生效：${prev.title} → ${record.title}`)
      }
      table.set(owner.entryId, record)
      // 只收自己那份：这条被后来者顶掉之后再摘，摘的就不该是别人那条
      return () => {
        if (table.get(owner.entryId) === record) table.delete(owner.entryId)
      }
    },

    list() {
      return [...table.values()]
    },
  }
}

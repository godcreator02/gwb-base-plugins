import { Service } from 'cordis'
import type { GwbContext, GwbResult } from '@godcreator/gwb-plugin-api'
// 相对 import 必须带 .js：构建产物由 node 直接加载，ESM 不补扩展名
import { createRegistry, type GwbCommandDef, type GwbCommands } from './registry.js'

export type { GwbCommands, GwbCommandDef } from './registry.js'

/** 说明书服务里本插件用到的那一个方法。按形状声明：说明书插件依赖本插件，反过来 import 它会成环 */
interface SkillDirectoryRegistrar {
  register(dir: URL): () => void
}

const PLUGIN_NAME = 'gwb-commands'

/** 构建产物在 dist/ 下，包根的 skills/ 就是 '../skills/'；这个目录要列进 package.json 的 files */
const OWN_SKILLS_DIR = new URL('../skills/', import.meta.url)

export default class GwbCommandBus extends Service implements GwbCommands {
  /** 用 TS 的 `private` 不用 `#`：cordis 给每个调用方派生 `Object.create(this)`，`#` 字段在派生对象上一读就抛错 */
  private readonly commandTable: GwbCommands

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbCommands')
    // 构造时 this.ctx 是本插件自己的上下文，logger 记在本插件名下
    this.commandTable = createRegistry(ctx.logger(PLUGIN_NAME))
  }

  [Service.init](): void {
    this.ctx.logger(PLUGIN_NAME).info('命令总线就绪（ctx.gwbCommands）')
    this.registerOwnSkillsWheneverSkillsPluginIsLoaded()
  }

  private registerOwnSkillsWheneverSkillsPluginIsLoaded(): void {
    this.ctx.inject(['gwbSkills'], (contextWithSkills) => {
      const { gwbSkills } = contextWithSkills as typeof contextWithSkills & { gwbSkills: SkillDirectoryRegistrar }
      contextWithSkills.effect(() => gwbSkills.register(OWN_SKILLS_DIR))
    })
  }

  /**
   * `this.ctx` 是调用方的上下文，注销登记在调用方的 effect 上、随它卸载。
   * 返回 cordis 的 effect 注销函数：重复调用、或被调用方外层的 `ctx.effect` 包住，都只执行一次
   */
  register(def: GwbCommandDef, handler: (args?: unknown) => unknown): () => void {
    return this.ctx.effect(() => this.commandTable.register(def, handler), `命令 ${def.name}`)
  }

  list(): Required<GwbCommandDef>[] {
    return this.commandTable.list()
  }

  run(name: string, args?: unknown): Promise<GwbResult> {
    return this.commandTable.run(name, args)
  }
}

declare module 'cordis' {
  interface Context {
    gwbCommands?: GwbCommands
  }
}

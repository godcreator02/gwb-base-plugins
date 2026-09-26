import { Service } from 'cordis'
import type { GwbContext, GwbResult } from '@godcreator/gwb-kernel-desktop'
// 相对 import 必须带 .js：构建产物由 node 直接加载，ESM 不补扩展名
import {
  checkedCommandDef,
  createRegistry,
  type CommandTable,
  type GwbCommandContext,
  type GwbCommandDef,
  type GwbCommandHandler,
  type GwbCommands,
  type RegisteredCommandDef,
} from './registry.js'

export type {
  GwbCommandContext,
  GwbCommandDef,
  GwbCommandEffect,
  GwbCommandHandler,
  GwbCommands,
  GwbRequestSource,
  RegisteredCommandDef,
} from './registry.js'

/** loader 挂在 fiber 上的条目，只取用到的那一项；不在 cordis 的类型里 */
interface FiberWithLoaderEntry {
  entry?: { options?: { name?: unknown } }
}

/** 说明书服务里本插件用到的那一个方法。按形状声明：说明书插件依赖本插件，反过来 import 它会成环 */
interface SkillDirectoryRegistrar {
  register(dir: URL): () => void
}

const PLUGIN_NAME = 'gwb-commands'

/** 构建产物在 dist/ 下，包根的 skills/ 就是 '../skills/'；这个目录要列进 package.json 的 files */
const OWN_SKILLS_DIR = new URL('../skills/', import.meta.url)

export default class GwbCommandBus extends Service implements GwbCommands {
  /** 用 TS 的 `private` 不用 `#`：cordis 给每个调用方派生 `Object.create(this)`，`#` 字段在派生对象上一读就抛错 */
  private readonly commandTable: CommandTable

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
   * 方法里的 `this.ctx` 是调用方的上下文。包名取自 loader 放在 fiber 上的条目：调用方在 `ctx.inject`、
   * `ctx.plugin` 里建的子 fiber，loader 也挂上同一个条目，所以不用沿 `fiber.parent` 往上找
   */
  private packageNameOfCaller(commandName: unknown): string {
    const fiber = this.ctx.fiber as unknown as FiberWithLoaderEntry
    const packageName = fiber.entry?.options?.name
    if (typeof packageName !== 'string' || packageName === '') {
      throw new Error(`取不到登记命令 ${String(commandName)} 的插件的包名：ctx.gwbCommands.register 只能在经 cordis.yml 加载的插件里调用`)
    }
    return packageName
  }

  /**
   * 注销登记在调用方的 effect 上、随它卸载。
   * 返回 cordis 的 effect 注销函数：重复调用、或被调用方外层的 `ctx.effect` 包住，都只执行一次
   */
  register(def: GwbCommandDef, handler: GwbCommandHandler): () => void {
    const checkedDef = checkedCommandDef(this.packageNameOfCaller(def.name), def)
    return this.ctx.effect(() => this.commandTable.register(checkedDef, handler), `命令 ${checkedDef.name}`)
  }

  list(): RegisteredCommandDef[] {
    return this.commandTable.list()
  }

  run(name: string, args?: unknown, context?: GwbCommandContext): Promise<GwbResult> {
    return this.commandTable.run(name, args, context)
  }
}

declare module 'cordis' {
  interface Context {
    gwbCommands?: GwbCommands
  }
}

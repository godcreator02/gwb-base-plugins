import { Service } from 'cordis'
import type { GwbContext, GwbResult } from '@godcreator/gwb-plugin-api'
// 相对 import 必须带 .js：构建产物由 node 直接加载，ESM 不补扩展名
import { createRegistry, type GwbCommandDef, type GwbCommands } from './registry.js'

export type { GwbCommands, GwbCommandDef } from './registry.js'

/**
 * 只用到说明书服务的 `register(dir)`，按形状声明、不 import `@godcreator/gwb-skills`：说明书插件依赖本插件
 * （inject 命令总线、引用本包的类型），本插件反过来不依赖它，包之间没有依赖环
 */
interface SkillMount {
  register(dir: URL): () => void
}

/**
 * 命令总线：插件把能力登记成命令，所有调用方用同一张命令表。
 *
 * 它不运行命令行程序：处理函数是普通 JS 函数，在主进程里执行。启动子进程的是 `gwb-node-cli` /
 * `gwb-py-cli`，它们的命令也登记在这张表上。
 */

const PLUGIN_NAME = 'gwb-commands'

export default class GwbCommandBus extends Service implements GwbCommands {
  /**
   * 命令表本身。用 TS 的 `private` 不用 `#`：cordis 给每个调用方派生一份 `Object.create(this)`，
   * `#` 私有字段的内部槽不在原型链上，派生对象上一读就抛错
   */
  private readonly registry: GwbCommands

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbCommands')
    // 构造时 this.ctx 是本插件自己的上下文，logger 绑的是本插件
    this.registry = createRegistry(ctx.logger(PLUGIN_NAME))
  }

  [Service.init](): void {
    this.ctx.logger(PLUGIN_NAME).info('命令总线就绪（ctx.gwbCommands）')
    // 说明书用局部注入，不写进 static inject：没装说明书插件时命令总线也要能加载。
    // 构建产物在 dist/ 下，所以包根的 skills/ 是 '../skills/'，这个目录必须列进 package.json 的 files
    this.ctx.inject(['gwbSkills'], (scoped) => {
      const mount = scoped as typeof scoped & { gwbSkills: SkillMount }
      mount.effect(() => mount.gwbSkills.register(new URL('../skills/', import.meta.url)))
    })
  }

  /**
   * 方法里的 `this.ctx` 是调用方的上下文：注销登记在调用方的 effect 上，调用方卸载时自动注销。
   * 返回的是 cordis 的 effect 注销函数：手动调用会同时从调用方的 effect 列表里移除，调第二次什么也不做；
   * 调用方自己又包了一层 `ctx.effect` 时，这层 effect 成为外层的子项，卸载时只执行一次
   */
  register(def: GwbCommandDef, handler: (args?: unknown) => unknown): () => void {
    return this.ctx.effect(() => this.registry.register(def, handler), `命令 ${def.name}`)
  }

  list(): Required<GwbCommandDef>[] {
    return this.registry.list()
  }

  run(name: string, args?: unknown): Promise<GwbResult> {
    return this.registry.run(name, args)
  }
}

declare module 'cordis' {
  interface Context {
    gwbCommands?: GwbCommands
  }
}

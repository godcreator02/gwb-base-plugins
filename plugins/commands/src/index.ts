import type { GwbContext } from '@godcreator/gwb-plugin-api'
// 相对 import 必须带 .js：构建产物由 node 直接加载，ESM 不补扩展名
import { createRegistry, type GwbCommands } from './registry.js'

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

export const name = 'gwb-commands'

declare module 'cordis' {
  interface Context {
    gwbCommands?: GwbCommands
  }
}

export function apply(ctx: GwbContext): void {
  const api = createRegistry(ctx.logger(name))
  // 包在 effect 里：本插件卸载时服务自动撤销
  ctx.effect(() => {
    const unprovide = ctx.provide('gwbCommands', api)
    ctx.logger(name).info('命令总线就绪（ctx.gwbCommands）')
    return unprovide
  })

  // 说明书用局部注入，不写进 export const inject：没装说明书插件时命令总线也要能加载。
  // 构建产物在 dist/ 下，所以包根的 skills/ 是 '../skills/'，这个目录必须列进 package.json 的 files
  ctx.inject(['gwbSkills'], (scoped) => {
    const mount = scoped as typeof scoped & { gwbSkills: SkillMount }
    mount.effect(() => mount.gwbSkills.register(new URL('../skills/', import.meta.url)))
  })
}

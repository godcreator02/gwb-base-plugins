import type { GwbContext } from '@godcreator/gwb-plugin-api'
// 相对 import 必须带 .js
import { createRegistry, type GwbCommands } from './registry.js'

export type { GwbCommands, GwbCommandDef } from './registry.js'

/**
 * 本件对说明书服务只用挂目录这一个方法，按形状取、不引 `@godcreator/gwb-skills`：
 * skills 件依赖本件（静态 inject 总线、类型面引本件），本件对它零依赖，包依赖图无环
 */
interface SkillMount {
  register(dir: URL): () => void
}

/**
 * 命令总线：件把能力登记成一条命令，谁来调都走这一份注册表。取舍见文档站。
 *
 * **它不执行命令行**——handler 就是个普通 JS 函数，跑在宿主这个 node 进程里。
 * 真的起子进程跑 CLI 的是 `gwb-node-cli` / `gwb-py-cli`，而它们把自己登记的命令
 * **也挂进这条总线**，所以那两个件跟这个是叠着的、不是并列的。
 */

export const name = 'gwb-commands'

declare module 'cordis' {
  interface Context {
    gwbCommands?: GwbCommands
  }
}

export function apply(ctx: GwbContext): void {
  // logger 自带 info/warn 两级，正好是注册表要的那两张嘴
  const api = createRegistry(ctx.logger(name))
  // effect 包着：本件卸载时服务自动撤销
  ctx.effect(() => {
    const unprovide = ctx.provide('gwbCommands', api)
    ctx.logger(name).info('命令总线就绪（ctx.gwbCommands）')
    return unprovide
  })

  // 说明书那一格。**局部注入,不写进 export const inject**:没装 skills 件的 home 里,
  // 总线照样得能挂上——说明书不是它能不能干活的前提。产物在 dist/ 下,包根的 skills/
  // 是 '../skills/';那个目录得进 package.json 的 files
  ctx.inject(['gwbSkills'], (scoped) => {
    const mount = scoped as typeof scoped & { gwbSkills: SkillMount }
    mount.effect(() => mount.gwbSkills.register(new URL('../skills/', import.meta.url)))
  })
}

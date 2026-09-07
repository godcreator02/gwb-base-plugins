import type { GwbContext } from '@godcreator02/gwb-plugin-api'
// 相对 import 必须带 .js
import { createRegistry, type GwbCommands } from './registry.js'

export type { GwbCommands, GwbCommandDef } from './registry.js'

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
  const api = createRegistry((message) => ctx.logger(name).warn(message))
  // effect 包着：本件卸载时服务自动撤销
  ctx.effect(() => {
    const unprovide = ctx.provide('gwbCommands', api)
    ctx.logger(name).info('命令总线就绪（ctx.gwbCommands）')
    return unprovide
  })
}

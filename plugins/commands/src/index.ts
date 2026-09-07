import type { GwbContext } from '@godcreator02/gwb-plugin-api'
// 相对 import 必须带 .js
import { createRegistry, type GwbCli } from './registry.js'

export type { GwbCli, GwbCommandDef } from './registry.js'

/** 命令总线：件把能力登记成一条命令，谁来调都走这一份注册表。取舍见文档站 */

export const name = 'gwb-cli'

declare module 'cordis' {
  interface Context {
    gwbCli?: GwbCli
  }
}

export function apply(ctx: GwbContext): void {
  const api = createRegistry((message) => ctx.logger(name).warn(message))
  // effect 包着：本件卸载时服务自动撤销
  ctx.effect(() => {
    const unprovide = ctx.provide('gwbCli', api)
    ctx.logger(name).info('命令总线就绪（ctx.gwbCli）')
    return unprovide
  })
}

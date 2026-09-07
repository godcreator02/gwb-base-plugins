import type { GwbContext } from '@godcreator02/gwb-plugin-api'
// 相对 import 必须带 .js:产物由 node 直接加载,ESM 不做扩展名补全
import { createRegistry, type GwbCli } from './registry.js'

export type { GwbCli, GwbCommandDef } from './registry.js'

/**
 * 命令总线:件把能力登记成一条命令,谁来调都走这一份注册表。
 * 内核的 dispatch 除两条自省命令外全走 `ctx.gwbCli`——**没有这个件,界面调不到任何
 * node 侧的能力**。
 */

export const name = 'gwb-cli'

declare module 'cordis' {
  interface Context {
    gwbCli?: GwbCli
  }
}

export function apply(ctx: GwbContext): void {
  const api = createRegistry((message) => ctx.logger(name).warn(message))
  // 包 effect:本件卸载时服务自动撤销
  ctx.effect(() => {
    const unprovide = ctx.provide('gwbCli', api)
    ctx.logger(name).info('命令总线就绪（ctx.gwbCli）')
    return unprovide
  })
}

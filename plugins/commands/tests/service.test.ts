import { Context } from 'cordis'
import type { Message, Plugin } from 'cordis'
import { describe, expect, it } from 'vitest'
import type { GwbContext } from '@godcreator/gwb-plugin-api'
import GwbCommandBus, { type GwbCommands } from '../src/index.js'

/** 真实的 cordis 根上下文，装上命令总线；收集 error 级日志，cordis 在注销出错时写在这里 */
async function bootBus(): Promise<{ root: Context; bus: GwbCommands; errors: Message[] }> {
  const root = new Context()
  const errors: Message[] = []
  root.logger.exporter({ export: (message) => void (message.type === 'error' && errors.push(message)) })
  // 构造函数收的是 GwbContext（cordis Context 的子类型），cordis 按参数推断配置类型时匹配不上，这里按插件声明
  const busPlugin: Plugin = GwbCommandBus
  await root.plugin(busPlugin)
  let bus: GwbCommands | undefined
  await root.inject(['gwbCommands'], (ctx) => {
    bus = ctx.gwbCommands
  })
  if (bus === undefined) throw new Error('命令总线没有提供出来')
  return { root, bus, errors }
}

/** 一个调用方插件：inject 命令总线，apply 里做 setup 交给它的事 */
function callerPlugin(setup: (ctx: GwbContext) => void) {
  return { name: 'caller', inject: ['gwbCommands'], apply: setup }
}

const names = (bus: GwbCommands): string[] => bus.list().map((c) => c.name)

describe('GwbCommandBus 跟着调用方注销', () => {
  it('调用方卸载后，它登记的命令自动注销', async () => {
    const { root, bus, errors } = await bootBus()
    const caller = await root.plugin(
      callerPlugin((ctx) => {
        ctx.gwbCommands!.register({ name: 'caller.ping', usage: '无参数', plugin: '@t/caller' }, () => 'pong')
      }),
    )
    expect(await bus.run('caller.ping')).toEqual({ ok: true, data: 'pong' })
    await caller.dispose()
    expect(names(bus)).not.toContain('caller.ping')
    expect(errors).toEqual([])
  })

  it('调用方自己包了 ctx.effect 再卸载，不出错，命令照样注销', async () => {
    const { root, bus, errors } = await bootBus()
    const caller = await root.plugin(
      callerPlugin((ctx) => {
        ctx.effect(() => ctx.gwbCommands!.register({ name: 'caller.wrapped', plugin: '@t/caller' }, () => 1))
      }),
    )
    expect(names(bus)).toContain('caller.wrapped')
    await caller.dispose()
    expect(names(bus)).not.toContain('caller.wrapped')
    expect(errors).toEqual([])
  })

  it('返回的注销函数可以手动调、重复调，之后调用方卸载也不出错', async () => {
    const { root, bus, errors } = await bootBus()
    let off: (() => void) | undefined
    const caller = await root.plugin(
      callerPlugin((ctx) => {
        off = ctx.gwbCommands!.register({ name: 'caller.early', plugin: '@t/caller' }, () => 1)
      }),
    )
    off!()
    off!()
    expect(names(bus)).not.toContain('caller.early')
    await caller.dispose()
    expect(errors).toEqual([])
  })

  it('同名命令被另一个插件接手后，先登记的插件卸载不删接手的那条', async () => {
    const { root, bus } = await bootBus()
    const first = await root.plugin(
      callerPlugin((ctx) => {
        ctx.gwbCommands!.register({ name: 'dup', plugin: '@t/first' }, () => 1)
      }),
    )
    await root.plugin({
      name: 'second',
      inject: ['gwbCommands'],
      apply: (ctx: GwbContext) => {
        ctx.gwbCommands!.register({ name: 'dup', plugin: '@t/second' }, () => 2)
      },
    })
    await first.dispose()
    expect(await bus.run('dup')).toEqual({ ok: true, data: 2 })
  })
})

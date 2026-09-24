import { Context, Service } from 'cordis'
import type { Message, Plugin } from 'cordis'
import Loader, { type ModuleLoader } from '@cordisjs/plugin-loader'
import { describe, expect, it } from 'vitest'
import type { GwbContext } from '@godcreator/gwb-plugin-api'
import GwbCommandBus, { type GwbCommandDef, type GwbCommands } from '../src/index.js'

const BUS_PACKAGE = '@godcreator/gwb-commands'
const CALLER_PACKAGE = '@t/caller'

/** 一个 home 的最小复刻：真 cordis 加真 loader，插件按包名建成条目加载，fiber 上有 loader 放的条目 */
interface LoaderHome {
  root: Context
  bus: GwbCommands
  /** cordis 写 error 级日志的地方：插件 apply 抛错、注销出错都记在这里 */
  errors: Message[]
  /** 按包名建一个条目并等它加载完，交回条目 id */
  load(packageName: string, plugin: Plugin): Promise<string>
  unload(entryId: string): void
}

async function bootLoaderHome(): Promise<LoaderHome> {
  const root = new Context()
  const errors: Message[] = []
  root.logger.exporter({ export: (message) => void (message.type === 'error' && errors.push(message)) })
  await root.plugin(Loader, {})
  // 构造函数收的是 GwbContext（cordis Context 的子类型），cordis 按参数推断配置类型时匹配不上，这里按插件声明
  const pluginsByPackage = new Map<string, Plugin>([[BUS_PACKAGE, GwbCommandBus]])
  const importByPackageName = async (packageName: string): Promise<{ default: Plugin }> => {
    const plugin = pluginsByPackage.get(packageName)
    if (plugin === undefined) throw new Error(`测试 home 里没有包 ${packageName}`)
    return { default: plugin }
  }
  root.loader.internal = { import: importByPackageName } as unknown as ModuleLoader

  const load = async (packageName: string, plugin: Plugin): Promise<string> => {
    pluginsByPackage.set(packageName, plugin)
    const entryId = await root.loader.create({ name: packageName })
    await root.loader.await()
    return entryId
  }
  await load(BUS_PACKAGE, GwbCommandBus)

  let bus: GwbCommands | undefined
  await root.inject(['gwbCommands'], (ctx) => {
    bus = ctx.gwbCommands
  })
  if (bus === undefined) throw new Error('命令总线没有提供出来')
  return { root, bus, errors, load, unload: (entryId) => root.loader.remove(entryId) }
}

/** 一个调用方插件：inject 命令总线，apply 里做 setup 交给它的事 */
function callerPlugin(setup: (ctx: GwbContext) => void): Plugin {
  return { name: 'caller', inject: ['gwbCommands'], apply: setup }
}

function commandDef(name: string, overrides: Partial<GwbCommandDef> = {}): GwbCommandDef {
  return { name, description: '试', usage: '无参数', ...overrides }
}

const names = (bus: GwbCommands): string[] => bus.list().map((c) => c.name)

/** 在 apply 里调 setup，把它抛的错记下来交回；apply 自己不抛，免得 cordis 把插件标成出错 */
function capturingErrorOf(setup: (ctx: GwbContext) => void): { plugin: Plugin; thrown: () => unknown } {
  let thrown: unknown
  const plugin = callerPlugin((ctx) => {
    try {
      setup(ctx)
    } catch (error) {
      thrown = error
    }
  })
  return { plugin, thrown: () => thrown }
}

describe('GwbCommandBus 从调用方取包名', () => {
  it('plugin 不给就填调用方的包名，list 里是完整包名', async () => {
    const home = await bootLoaderHome()
    await home.load(CALLER_PACKAGE, callerPlugin((ctx) => void ctx.gwbCommands!.register(commandDef('caller.ping'), () => 'pong')))
    expect(home.bus.list()).toEqual([{ name: 'caller.ping', description: '试', usage: '无参数', plugin: CALLER_PACKAGE }])
    expect(await home.bus.run('caller.ping')).toEqual({ ok: true, data: 'pong' })
  })

  it('plugin 给了且与调用方的包名相同，照常登记', async () => {
    const home = await bootLoaderHome()
    await home.load(CALLER_PACKAGE, callerPlugin((ctx) => void ctx.gwbCommands!.register(commandDef('caller.same', { plugin: CALLER_PACKAGE }), () => 1)))
    expect(home.bus.list()).toEqual([expect.objectContaining({ name: 'caller.same', plugin: CALLER_PACKAGE })])
  })

  it('plugin 与调用方的包名不同就抛错，消息里写着两者，命令不进表', async () => {
    const home = await bootLoaderHome()
    const caller = capturingErrorOf((ctx) => void ctx.gwbCommands!.register(commandDef('caller.other', { plugin: 'gwb-short-name' }), () => 1))
    await home.load(CALLER_PACKAGE, caller.plugin)
    expect(String(caller.thrown())).toContain('gwb-short-name')
    expect(String(caller.thrown())).toContain(CALLER_PACKAGE)
    expect(names(home.bus)).toEqual([])
  })

  it('name、description、usage 为空时在服务这一层就被拒，消息里带包名', async () => {
    const home = await bootLoaderHome()
    const caller = capturingErrorOf((ctx) => void ctx.gwbCommands!.register(commandDef('caller.bare', { usage: '' }), () => 1))
    await home.load(CALLER_PACKAGE, caller.plugin)
    expect(String(caller.thrown())).toContain(CALLER_PACKAGE)
    expect(String(caller.thrown())).toContain('usage')
    expect(names(home.bus)).toEqual([])
  })

  it('在 ctx.inject 的回调里登记也取得到调用方的包名', async () => {
    const home = await bootLoaderHome()
    await home.load(
      CALLER_PACKAGE,
      { name: 'caller', apply: (ctx: GwbContext) => {
        ctx.inject(['gwbCommands'], (contextWithCommands) => {
          contextWithCommands.gwbCommands!.register(commandDef('caller.in-inject'), () => 1)
        })
      } },
    )
    expect(home.bus.list()).toEqual([expect.objectContaining({ name: 'caller.in-inject', plugin: CALLER_PACKAGE })])
    expect(home.errors).toEqual([])
  })

  it('在 ctx.plugin 装的子插件里登记也取得到调用方的包名，再套一层 inject 也一样', async () => {
    const home = await bootLoaderHome()
    const grandchild = (ctx: GwbContext): void => {
      ctx.inject(['gwbCommands'], (contextWithCommands) => {
        contextWithCommands.gwbCommands!.register(commandDef('caller.grandchild'), () => 2)
      })
    }
    const child = { name: 'child', inject: ['gwbCommands'], apply: (ctx: GwbContext) => {
      ctx.gwbCommands!.register(commandDef('caller.child'), () => 1)
      ctx.plugin({ name: 'grandchild', apply: grandchild })
    } }
    await home.load(CALLER_PACKAGE, { name: 'caller', apply: (ctx: GwbContext) => void ctx.plugin(child) })
    expect(home.bus.list().map((c) => [c.name, c.plugin])).toEqual([
      ['caller.child', CALLER_PACKAGE],
      ['caller.grandchild', CALLER_PACKAGE],
    ])
    expect(home.errors).toEqual([])
  })

  it('Service 插件在 Service.init 里登记也取得到自己的包名', async () => {
    const home = await bootLoaderHome()
    class SomeService extends Service {
      static inject = ['gwbCommands']
      constructor(ctx: GwbContext) {
        super(ctx, 'someService')
      }
      [Service.init](): void {
        ;(this.ctx as GwbContext).gwbCommands!.register(commandDef('service.ping'), () => 1)
      }
    }
    await home.load('@t/service', SomeService as unknown as Plugin)
    expect(home.bus.list()).toEqual([expect.objectContaining({ name: 'service.ping', plugin: '@t/service' })])
  })

  it('不经 loader 加载、fiber 上没有条目时抛错，写明只能在经 cordis.yml 加载的插件里调用', async () => {
    const home = await bootLoaderHome()
    const caller = capturingErrorOf((ctx) => void ctx.gwbCommands!.register(commandDef('stray.ping'), () => 1))
    await home.root.plugin(caller.plugin)
    expect(String(caller.thrown())).toContain('stray.ping')
    expect(String(caller.thrown())).toContain('cordis.yml')
    expect(names(home.bus)).toEqual([])
  })
})

describe('GwbCommandBus 跟着调用方注销', () => {
  it('调用方卸载后，它登记的命令自动注销', async () => {
    const home = await bootLoaderHome()
    const callerEntryId = await home.load(CALLER_PACKAGE, callerPlugin((ctx) => void ctx.gwbCommands!.register(commandDef('caller.ping'), () => 'pong')))
    expect(await home.bus.run('caller.ping')).toEqual({ ok: true, data: 'pong' })
    home.unload(callerEntryId)
    await home.root.loader.await()
    expect(names(home.bus)).not.toContain('caller.ping')
    expect(home.errors).toEqual([])
  })

  it('调用方自己包了 ctx.effect 再卸载，不出错，命令照样注销', async () => {
    const home = await bootLoaderHome()
    const callerEntryId = await home.load(
      CALLER_PACKAGE,
      callerPlugin((ctx) => {
        ctx.effect(() => ctx.gwbCommands!.register(commandDef('caller.wrapped'), () => 1))
      }),
    )
    expect(names(home.bus)).toContain('caller.wrapped')
    home.unload(callerEntryId)
    await home.root.loader.await()
    expect(names(home.bus)).not.toContain('caller.wrapped')
    expect(home.errors).toEqual([])
  })

  it('返回的注销函数可以手动调、重复调，之后调用方卸载也不出错', async () => {
    const home = await bootLoaderHome()
    let off: (() => void) | undefined
    const callerEntryId = await home.load(
      CALLER_PACKAGE,
      callerPlugin((ctx) => {
        off = ctx.gwbCommands!.register(commandDef('caller.early'), () => 1)
      }),
    )
    off!()
    off!()
    expect(names(home.bus)).not.toContain('caller.early')
    home.unload(callerEntryId)
    await home.root.loader.await()
    expect(home.errors).toEqual([])
  })

  it('同名命令被另一个插件接手后，先登记的插件卸载不删接手的那条', async () => {
    const home = await bootLoaderHome()
    const firstEntryId = await home.load('@t/first', callerPlugin((ctx) => void ctx.gwbCommands!.register(commandDef('dup'), () => 1)))
    await home.load('@t/second', callerPlugin((ctx) => void ctx.gwbCommands!.register(commandDef('dup'), () => 2)))
    home.unload(firstEntryId)
    await home.root.loader.await()
    expect(await home.bus.run('dup')).toEqual({ ok: true, data: 2 })
    expect(home.bus.list()).toEqual([expect.objectContaining({ name: 'dup', plugin: '@t/second' })])
  })
})

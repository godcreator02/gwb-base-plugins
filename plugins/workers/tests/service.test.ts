import { Context } from 'cordis'
import type { Message, Plugin } from 'cordis'
import Loader, { type ModuleLoader } from '@cordisjs/plugin-loader'
import { describe, expect, it } from 'vitest'
import type { GwbContext } from '@godcreator/gwb-kernel-desktop'
import GwbWorkerPools, { type GwbWorkers, type WorkerPool } from '../src/index.js'

const WORKERS_PACKAGE = '@godcreator/gwb-workers'
const CALLER_PACKAGE = '@t/caller'
const TASKS = new URL('./fixtures/tasks.mjs', import.meta.url)

/** 一个 home 的最小复刻：真 cordis 加真 loader，插件按包名建成条目加载，fiber 上有 loader 放的条目 */
async function bootLoaderHome() {
  const root = new Context()
  const errors: Message[] = []
  root.logger.exporter({ export: (message) => void (message.type === 'error' && errors.push(message)) })
  await root.plugin(Loader, {})
  const pluginsByPackage = new Map<string, Plugin>([[WORKERS_PACKAGE, GwbWorkerPools as unknown as Plugin]])
  root.loader.internal = {
    import: async (packageName: string) => {
      const plugin = pluginsByPackage.get(packageName)
      if (plugin === undefined) throw new Error(`测试 home 里没有包 ${packageName}`)
      return { default: plugin }
    },
  } as unknown as ModuleLoader
  const load = async (packageName: string, plugin: Plugin): Promise<string> => {
    pluginsByPackage.set(packageName, plugin)
    const entryId = await root.loader.create({ name: packageName })
    await root.loader.await()
    return entryId
  }
  await load(WORKERS_PACKAGE, GwbWorkerPools as unknown as Plugin)
  let workers: GwbWorkers | undefined
  await root.inject(['gwbWorkers'], (ctx) => {
    workers = ctx.gwbWorkers
  })
  if (workers === undefined) throw new Error('线程池服务没有提供出来')
  const unload = async (entryId: string): Promise<void> => {
    root.loader.remove(entryId)
    await root.loader.await()
  }
  return { root, workers, errors, load, unload }
}

/** 在 apply 里调 setup，把它抛的错记下来；apply 自己不抛，免得 cordis 把插件标成出错 */
function callerPlugin(setup: (ctx: GwbContext) => void): { plugin: Plugin; thrown: () => unknown } {
  let thrown: unknown
  const plugin = {
    name: 'caller',
    inject: ['gwbWorkers'],
    apply: (ctx: GwbContext) => {
      try {
        setup(ctx)
      } catch (error) {
        thrown = error
      }
    },
  }
  return { plugin, thrown: () => thrown }
}

describe('GwbWorkerPools', () => {
  it('线程池记在调用方的包名下', async () => {
    const home = await bootLoaderHome()
    await home.load(CALLER_PACKAGE, callerPlugin((ctx) => void ctx.gwbWorkers.pool({ name: 'db', module: TASKS, threads: 2 })).plugin)
    expect(home.workers.stats()).toEqual([expect.objectContaining({ plugin: CALLER_PACKAGE, name: 'db', threads: 2, alive: 0 })])
  })

  it('同一个插件里池名重了就抛错；别的插件可以用同一个池名', async () => {
    const home = await bootLoaderHome()
    const caller = callerPlugin((ctx) => {
      ctx.gwbWorkers.pool({ name: 'db', module: TASKS, threads: 1 })
      ctx.gwbWorkers.pool({ name: 'db', module: TASKS, threads: 1 })
    })
    await home.load(CALLER_PACKAGE, caller.plugin)
    expect(String(caller.thrown())).toContain(`${CALLER_PACKAGE} 已经开了线程池 db`)
    await home.load('@t/other', callerPlugin((ctx) => void ctx.gwbWorkers.pool({ name: 'db', module: TASKS, threads: 1 })).plugin)
    expect(home.workers.stats().map((stats) => stats.plugin)).toEqual([CALLER_PACKAGE, '@t/other'])
  })

  it('调用方卸载时线程池关闭：从现状里拿掉，之后的 run 报已卸载', async () => {
    const home = await bootLoaderHome()
    let pool: WorkerPool | undefined
    const entryId = await home.load(CALLER_PACKAGE, callerPlugin((ctx) => void (pool = ctx.gwbWorkers.pool({ name: 'db', module: TASKS, threads: 1 }))).plugin)
    await home.unload(entryId)
    expect(home.workers.stats()).toEqual([])
    await expect(pool!.run('echo', [1])).rejects.toThrow(`${CALLER_PACKAGE} 已卸载，线程池 db 已关闭`)
    expect(home.errors).toEqual([])
  })

  it('不经 loader 加载、fiber 上没有条目时抛错，写明只能在经 cordis.yml 加载的插件里调用', async () => {
    const home = await bootLoaderHome()
    const caller = callerPlugin((ctx) => void ctx.gwbWorkers.pool({ name: 'stray', module: TASKS, threads: 1 }))
    await home.root.plugin(caller.plugin)
    expect(String(caller.thrown())).toContain('cordis.yml')
    expect(home.workers.stats()).toEqual([])
  })
})

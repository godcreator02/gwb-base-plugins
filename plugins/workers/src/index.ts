import { Service } from 'cordis'
import type { GwbContext } from '@godcreator/gwb-kernel-desktop'
import type { GwbCommands } from '@godcreator/gwb-commands'
import type {} from '@godcreator/gwb-skills'
// 相对 import 必须带 .js：构建产物由 node 直接加载，ESM 不补扩展名
import { checkedPoolOptions, WorkerPoolCore, type WorkerPool, type WorkerPoolOptions, type WorkerPoolStats } from './pool.js'

export type { WorkerPool, WorkerPoolOptions, WorkerPoolStats, WorkerTaskRecord } from './pool.js'

/**
 * 线程池服务：插件把同步的重计算（同步数据库查询、大文件解析）放进自己的线程池，不占主线程。
 * 主线程上跑着界面、MCP 入口和所有插件，谁在这里同步算上几百毫秒，别的全都排队
 */
export interface GwbWorkers {
  /**
   * 给调用方插件开一个线程池，随调用方卸载关闭（排队与正在跑的任务报错、线程终止）。
   * 同一个插件里池名不能重；选项不对当场抛错
   */
  pool(options: WorkerPoolOptions): WorkerPool
  /** 各插件线程池的现状与最近的任务 */
  stats(): WorkerPoolStats[]
}

/** loader 挂在 fiber 上的条目，只取用到的那一项；不在 cordis 的类型里 */
interface FiberWithLoaderEntry {
  entry?: { options?: { name?: unknown } }
}

const PLUGIN_NAME = 'gwb-workers'
const PACKAGE_NAME = '@godcreator/gwb-workers'
const STATS_COMMAND = 'workers.stats'

/** 构建产物在 dist/ 下，线程入口是同目录的 thread.js；包根的 skills/ 就是 '../skills/'，要列进 package.json 的 files */
const THREAD_ENTRY = new URL('./thread.js', import.meta.url)
const OWN_SKILLS_DIR = new URL('../skills/', import.meta.url)

export default class GwbWorkerPools extends Service implements GwbWorkers {
  /** 用 TS 的 `private` 不用 `#`：cordis 给每个调用方派生 `Object.create(this)`，`#` 字段在派生对象上一读就抛错 */
  private readonly openPools: Map<string, WorkerPoolCore>

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbWorkers')
    this.openPools = new Map()
  }

  [Service.init](): void {
    this.registerStatsCommandWheneverCommandBusIsLoaded()
    this.registerOwnSkillsWheneverSkillsPluginIsLoaded()
    this.ctx.logger(PLUGIN_NAME).info('线程池服务就绪（ctx.gwbWorkers）')
  }

  private registerStatsCommandWheneverCommandBusIsLoaded(): void {
    this.ctx.inject(['gwbCommands'], (contextWithCommands) => {
      const commandBus: GwbCommands = contextWithCommands.gwbCommands!
      contextWithCommands.effect(() =>
        commandBus.register(
          {
            name: STATS_COMMAND,
            description: '各插件线程池的现状：线程开了几个、忙几个、排队几个，最近的任务各等了多久、跑了多久',
            usage: '无参数。回 [{ plugin, name, module, threads, alive, busy, queued, done, failed, recent }]，recent 是最近 20 个任务 { fn, waitMs, runMs, ok, endedAt }，新的在前',
            plugin: PACKAGE_NAME,
            effect: 'read',
          },
          () => this.stats(),
        ),
      )
    })
  }

  private registerOwnSkillsWheneverSkillsPluginIsLoaded(): void {
    this.ctx.inject(['gwbSkills'], (contextWithSkills) => {
      contextWithSkills.effect(() => contextWithSkills.gwbSkills.register(OWN_SKILLS_DIR))
    })
  }

  /** 方法里的 `this.ctx` 是调用方的上下文；包名取自 loader 放在 fiber 上的条目，跟命令总线同一个办法 */
  private packageNameOfCaller(poolName: unknown): string {
    const fiber = this.ctx.fiber as unknown as FiberWithLoaderEntry
    const packageName = fiber.entry?.options?.name
    if (typeof packageName !== 'string' || packageName === '') {
      throw new Error(`取不到开线程池 ${String(poolName)} 的插件的包名：ctx.gwbWorkers.pool 只能在经 cordis.yml 加载的插件里调用`)
    }
    return packageName
  }

  pool(options: WorkerPoolOptions): WorkerPool {
    const plugin = this.packageNameOfCaller(options.name)
    const checked = checkedPoolOptions(plugin, options)
    const key = `${plugin}\u0000${checked.name}`
    if (this.openPools.has(key)) throw new Error(`${plugin} 已经开了线程池 ${checked.name}，同一个插件里池名不能重`)
    const core = new WorkerPoolCore(plugin, checked, THREAD_ENTRY)
    this.ctx.effect(() => {
      this.openPools.set(key, core)
      return () => {
        core.close(`${plugin} 已卸载，线程池 ${checked.name} 已关闭`)
        this.openPools.delete(key)
      }
    }, `线程池 ${checked.name}`)
    return { run: (fn, args) => core.run(fn, args) }
  }

  stats(): WorkerPoolStats[] {
    return [...this.openPools.values()].map((core) => core.stats())
  }
}

declare module 'cordis' {
  interface Context {
    gwbWorkers: GwbWorkers
  }
}

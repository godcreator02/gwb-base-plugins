import path from 'node:path'
import { Service } from 'cordis'
import type { GwbContext } from '@godcreator/gwb-plugin-api'
import { requireKernel } from './vocab.js'
// 只为激活 commands 插件的 `declare module 'cordis'`——给 ctx 加上 gwbCommands
import type {} from '@godcreator/gwb-commands'

/**
 * 无界面的**日志插件**。
 *
 * 内核只做一件事：cordis 的日志全部写进 stderr 与 `<home>/gwb.log`，不装任何插件也看得见。
 * 这个插件提供的是缓冲、agent 查询命令、推给页面的事件：注册第二个 exporter 收全部日志、自己缓冲、
 * 注册之前的日志从 cordis 自带的环形缓冲补读、实时的经内核事件（`gwbKernel.emit`）推给页面。
 * 三个来源（插件、内核、页面）都经 cordis logger 过来——内核把页面的 console 转进了
 * `ctx.logger('renderer')`，所以这里一个 exporter 就收齐。
 *
 * 日志窗格不在这里，在界面插件仓的 `@godcreator/gwb-baseui`。
 */
export const name = 'gwb-logger'

/** 没有命令总线，历史日志取不出去（命令登记不上）。窗格在 gwb-baseui，不依赖外壳 */
export const inject = ['gwbCommands']

/** 事件载荷的记号：`{ t: EVENT, line: LogEntry }`。页面上订阅 window.gwb.on 的都收得到，靠它认出日志事件 */
export const EVENT = 'gwb-logger'
export const BACKLOG_COMMAND = 'logger.backlog'
export const WHERE_COMMAND = 'logger.where'

/** 缓冲多少条。够翻回开机那一段，又不至于占太多内存 */
const CAP = 2000

/**
 * 空服务：使用方的嵌套注入按**服务名**等待——没有这个服务，gwb-baseui 的日志窗格等的
 * `gwbLogger` 永远等不到、也不报错（界面插件仓拆出去时在隔离 home 里验出过）。
 * 服务上刻意**没有方法**：取数据走命令（`logger.backlog` / `where`）、推给页面走内核事件——
 * 别往这里加方法，除非出现第二个绕不开服务的使用方。
 */
class GwbLogger extends Service {}

declare module 'cordis' {
  interface Context {
    gwbLogger: GwbLogger
  }
}

export type LogSource = 'plugin' | 'kernel' | 'renderer'
export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export interface LogEntry {
  seq: number
  ts: number
  source: LogSource
  level: LogLevel
  name: string
  msg: string
}

/** cordis 递给 exporter 的那条消息，只取用得上的几样 */
interface LogMessage {
  ts?: number
  type?: string
  name?: string
  args?: unknown[]
}

/** 这几个 logger 名是内核在写日志：内核自己、loader 报加载过程的事。其余一律是插件 */
const KERNEL_NAMES = new Set(['kernel', 'loader'])

export function sourceOf(loggerName: string): LogSource {
  if (loggerName === 'renderer') return 'renderer'
  return KERNEL_NAMES.has(loggerName) ? 'kernel' : 'plugin'
}

/** cordis 的 type 有 success 这一档，窗格不分它，归 info */
function levelOf(type: string): LogLevel {
  if (type === 'error' || type === 'warn' || type === 'debug') return type
  return 'info'
}

export function apply(ctx: GwbContext): void {
  const kernel = requireKernel(ctx)
  const cli = ctx.gwbCommands
  // inject 保证了它在，这句只是把类型收窄（commands 插件把它声明成可选的）
  if (cli === undefined) return

  // 先提供服务再做别的：使用方的嵌套注入等的就是它，晚了日志窗格就开不出来
  new GwbLogger(ctx, 'gwbLogger')

  // Logger 类从一个实例的 constructor 上取，不 import cordis 的内部；format 是静态方法，%s/%o/Error 它都会
  const factory = ctx.logger as unknown as {
    (loggerName: string): { constructor: { format(exporter: unknown, message: unknown): string } }
    exporter(exporter: unknown): void
    /** cordis 自带的环形缓冲（LoggerService 构造时注册的第一个 exporter），info 及以上一千条 */
    buffer?: LogMessage[]
  }
  const Logger = factory(name).constructor

  const ring: LogEntry[] = []
  let seq = 0
  const keep = (entry: LogEntry): void => {
    ring.push(entry)
    if (ring.length > CAP) ring.splice(0, ring.length - CAP)
  }
  const exporter = {
    colors: 0,
    levels: { default: 3 },
    export: (message: LogMessage): void => {
      const entry = toEntry(message)
      keep(entry)
      kernel.emit({ t: EVENT, line: entry })
    },
  }
  const toEntry = (message: LogMessage): LogEntry => {
    let msg: string
    try {
      msg = Logger.format(exporter, message)
    } catch {
      msg = (message.args ?? []).map((a) => (a instanceof Error ? a.message : String(a))).join(' ')
    }
    const loggerName = String(message.name ?? '')
    return {
      seq: ++seq,
      ts: typeof message.ts === 'number' ? message.ts : Date.now(),
      source: sourceOf(loggerName),
      level: levelOf(String(message.type ?? 'info')),
      name: loggerName,
      msg,
    }
  }

  // 先补历史再注册 exporter：buffer 里是注册之前的日志，之后的由 exporter 收，两段不重叠
  for (const message of factory.buffer ?? []) keep(toEntry(message))
  factory.exporter(exporter)

  ctx.effect(() =>
    cli.register({ name: BACKLOG_COMMAND, description: '开机到此刻的日志', usage: '最近两千条。无参数', plugin: '@godcreator/gwb-logger' }, () => [...ring]),
  )
  ctx.effect(() =>
    cli.register(
      { name: WHERE_COMMAND, description: 'home 与日志文件在哪', usage: '无参数', plugin: '@godcreator/gwb-logger' },
      () => ({ home: kernel.dataDir, logFile: path.join(kernel.dataDir, 'gwb.log') }),
    ),
  )

  // 这句日志用来检查整条链路（exporter → 缓冲 → 内核事件）是否通了——装了 gwb-baseui
  // 的话，它就出现在日志窗格里（来源 plugin、名字 gwb-logger）
  ctx.logger(name).info(`日志件就绪：补了历史 ${ring.length} 条`)
}

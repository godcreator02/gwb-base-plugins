import path from 'node:path'
import { Service } from 'cordis'
import { requireKernel, type GwbContext } from '@godcreator/gwb-plugin-api'
// 只为激活那个件的 `declare module 'cordis'`——给 ctx 加上 gwbCommands
import type {} from '@godcreator/gwb-commands'

/**
 * 纯 core：**无头场景的日志件**。
 *
 * 内核只做一件事：cordis 的日志全量进 stderr 与 `<home>/gwb.log`，人不靠任何件也看得见。
 * 这儿卖的是聚合缓冲、agent 查询命令、页面事件流：挂第二个 exporter 收全量、自己缓冲、
 * 历史段从 cordis 自带的那圈 buffer 补、实时经内核事件口（`gwbKernel.emit`）推给页面。
 * 三路（件、内核、渲染层）都经 cordis logger 过来——内核把渲染层 console 转进了
 * `ctx.logger('renderer')`，所以这儿一个 exporter 收齐。
 *
 * 窗格（UI 面板）不住这儿——0.3 劈 core 后它住 `@godcreator/gwb-baseui`，装它找回。
 */
export const name = 'gwb-logger'

/** 没有总线历史段出不去（命令注册不上）。外壳不再是依赖——窗格住 gwb-baseui */
export const inject = ['gwbCommands']

/** 事件载荷的记号：`{ t: EVENT, line: LogEntry }`。页面上谁订 window.gwb.on 都收得到，靠它认 */
export const EVENT = 'gwb-logger'
export const BACKLOG_COMMAND = 'logger.backlog'
export const WHERE_COMMAND = 'logger.where'

/** 缓冲多少条。够翻回开机那一段，又不至于占太多内存 */
const CAP = 2000

/**
 * 薄服务：消费方的嵌套注入按**服务名**等待，而本件 0.2 时代只有命令没有服务——
 * gwb-baseui 那格日志窗格等的 `gwbLogger` 永远 PENDING、静默不注册（2026-09-12
 * 三仓拆分实机验出）。服务面刻意**留空**：取数走命令（`logger.backlog` / `where`）、
 * 页面推送走内核事件口——谁都别往这儿加方法，除非出现第二个绕不开服务的消费者。
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

/** 这几个 logger 名是内核在说话：内核自己、loader 报引导链的事。其余一律是件 */
const KERNEL_NAMES = new Set(['kernel', 'loader', 'gwb'])

function sourceOf(loggerName: string): LogSource {
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
  // inject 保证了它在，这句只是把类型收窄（commands 件把它声明成可选的）
  if (cli === undefined) return

  // 先把服务挂上再干活：消费方的嵌套注入等的就是它，晚了人家那格窗格就开不出来
  new GwbLogger(ctx, 'gwbLogger')

  // Logger 类从一个实例的 constructor 上取，不 import cordis 的内部；format 是静态方法，%s/%o/Error 它都会
  const factory = ctx.logger as unknown as {
    (loggerName: string): { constructor: { format(exporter: unknown, message: unknown): string } }
    exporter(exporter: unknown): void
    /** cordis 自带的那圈缓冲（LoggerService 构造时挂的第一个 exporter），info 及以上一千条 */
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

  // 先补历史再挂 exporter：buffer 里是挂上之前的那些，之后的两边都收、不交叠
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

  // 这句不是客套：它是整条链路（exporter → 缓冲 → 事件口）最省事的一次自检——装了 gwb-baseui
  // 的话，它就出现在日志窗格里（来源 plugin、名字 gwb-logger）
  ctx.logger(name).info(`日志件就绪：补了历史 ${ring.length} 条`)
}

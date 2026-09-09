import path from 'node:path'
import { requireKernel, type GwbContext } from '@godcreator02/gwb-plugin-api'
// 只为激活那两个件的 `declare module 'cordis'`——给 ctx 加上 gwbShell 与 gwbCommands
import type {} from '@godcreator02/gwb-shell'
import type {} from '@godcreator02/gwb-commands'

/**
 * node 半：**这回真的是日志件了**。
 *
 * 内核只做一件事：cordis 的日志全量进 stderr 与 `<home>/gwb.log`，人不靠任何件也看得见。
 * 其余全在这儿：挂第二个 exporter 收全量、自己缓冲、历史段从 cordis 自带的那圈 buffer 补、
 * 实时经内核事件口（`gwbKernel.emit`）推给窗格。三路（件、内核、渲染层）都经 cordis logger
 * 过来——内核把渲染层 console 转进了 `ctx.logger('renderer')`，所以这儿一个 exporter 收齐。
 */
export const name = 'gwb-logger'

/** 没有外壳就没有窗格；没有总线历史段出不去。两个都是硬等待 */
export const inject = ['gwbShell', 'gwbCommands']

/** 事件载荷的记号：`{ t: EVENT, line: LogEntry }`。页面上谁订 window.gwb.on 都收得到，靠它认 */
export const EVENT = 'gwb-logger'
export const BACKLOG_COMMAND = 'logger.backlog'
export const WHERE_COMMAND = 'logger.where'

/** 缓冲多少条。够翻回开机那一段，又不至于占太多内存 */
const CAP = 2000

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
  const here = import.meta.url
  // 两条都不用自己包 ctx.effect：件卸载时表上那两条自动摘掉。地址从本模块算：dist/ 下三个文件是邻居
  ctx.gwbShell.registerPane({
    id: 'main',
    title: '日志',
    icon: 'scroll-text',
    duplicable: true,
    client: new URL('./client.js', here).href,
    style: new URL('./style.css', here).href,
  })
  ctx.gwbShell.describeSelf({ title: '日志', icon: 'scroll-text' })

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
    cli.register({ name: BACKLOG_COMMAND, description: '开机到此刻的日志（最近两千条）。无参数', plugin: name }, () => [...ring]),
  )
  ctx.effect(() =>
    cli.register(
      { name: WHERE_COMMAND, description: 'home 与日志文件在哪。无参数', plugin: name },
      () => ({ home: kernel.dataDir, logFile: path.join(kernel.dataDir, 'gwb.log') }),
    ),
  )

  // 这句不是客套：它应该**出现在自己的窗格里**（来源 plugin、名字 gwb-logger），是整条链路最省事的一次自检
  ctx.logger(name).info(`日志件就绪：补了历史 ${ring.length} 条，窗格已注册`)
}

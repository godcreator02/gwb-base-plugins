import path from 'node:path'
import { Service } from 'cordis'
import type { GwbContext, GwbKernelApi } from '@godcreator/gwb-kernel-desktop'
import { requireKernel } from './vocab.js'
// 这个 import 同时激活命令插件的 `declare module 'cordis'`，给 ctx 加上 gwbCommands
import type { GwbCommands } from '@godcreator/gwb-commands'

export const name = 'gwb-logger'

export const inject = ['gwbCommands']

/** 事件载荷 `{ t: EVENT, line: LogEntry }`。页面上订阅 window.gwb.on 的都收得到，靠它认出日志事件 */
export const EVENT = 'gwb-logger'
export const BACKLOG_COMMAND = 'logger.backlog'
export const WHERE_COMMAND = 'logger.where'

const PACKAGE_NAME = '@godcreator/gwb-logger'
const BACKLOG_CAPACITY = 2000

/** 刻意没有方法：取数据走命令、推给页面走内核事件。日志窗格按服务名等它出现 */
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
interface CordisLogMessage {
  ts?: number
  type?: string
  name?: string
  args?: unknown[]
}

/** 与内核仓 main.ts、cordis loader 用的 logger 名靠约定对齐 */
const KERNEL_LOGGER_NAMES = new Set(['kernel', 'loader'])

export function sourceOf(loggerName: string): LogSource {
  if (loggerName === 'renderer') return 'renderer'
  return KERNEL_LOGGER_NAMES.has(loggerName) ? 'kernel' : 'plugin'
}

function levelOf(cordisType: string): LogLevel {
  if (cordisType === 'error' || cordisType === 'warn' || cordisType === 'debug') return cordisType
  return 'info'
}

/** `ctx.logger` 上本插件用到的部分 */
interface CordisLoggerFactory {
  (loggerName: string): { constructor: CordisLoggerClass }
  exporter(exporter: unknown): void
  /** cordis 自带的环形缓冲（LoggerService 构造时注册的第一个 exporter），info 及以上一千条 */
  buffer?: CordisLogMessage[]
}

interface CordisLoggerClass {
  format(exporter: unknown, message: unknown): string
}

/** exporter 不能抛错（会打断写这条日志的那次调用），所以格式化失败时退回把参数逐个转成文本 */
function formatMessageText(LoggerClass: CordisLoggerClass, exporter: unknown, message: CordisLogMessage): string {
  try {
    return LoggerClass.format(exporter, message)
  } catch {
    return (message.args ?? []).map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ')
  }
}

function entryFromCordisMessage(message: CordisLogMessage, seq: number, msg: string): LogEntry {
  const loggerName = String(message.name ?? '')
  return {
    seq,
    ts: typeof message.ts === 'number' ? message.ts : Date.now(),
    source: sourceOf(loggerName),
    level: levelOf(String(message.type ?? 'info')),
    name: loggerName,
    msg,
  }
}

function appendDroppingOldest(recentEntries: LogEntry[], entry: LogEntry): void {
  recentEntries.push(entry)
  if (recentEntries.length > BACKLOG_CAPACITY) recentEntries.splice(0, recentEntries.length - BACKLOG_CAPACITY)
}

/** 补读 cordis 缓冲里的历史，再注册 exporter 收之后的每一条并推给页面；返回持续更新的最近日志 */
function startCollectingLogs(ctx: GwbContext, kernel: GwbKernelApi): LogEntry[] {
  const loggerFactory = ctx.logger as unknown as CordisLoggerFactory
  // Logger 类从一个实例的 constructor 上取，不 import cordis 的内部；format 是它的静态方法
  const LoggerClass = loggerFactory(name).constructor
  const recentEntries: LogEntry[] = []
  let lastSeq = 0
  const toEntry = (message: CordisLogMessage): LogEntry => {
    const msg = formatMessageText(LoggerClass, forwardingExporter, message)
    return entryFromCordisMessage(message, ++lastSeq, msg)
  }
  const forwardingExporter = {
    colors: 0,
    levels: { default: 3 },
    export: (message: CordisLogMessage): void => {
      const entry = toEntry(message)
      appendDroppingOldest(recentEntries, entry)
      kernel.emit({ t: EVENT, line: entry })
    },
  }

  // 先补历史再注册 exporter：buffer 里是注册之前的日志，之后的由 exporter 收，两段不重叠
  for (const message of loggerFactory.buffer ?? []) appendDroppingOldest(recentEntries, toEntry(message))
  loggerFactory.exporter(forwardingExporter)
  return recentEntries
}

const LEVELS_FROM_LOWEST: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']

export const BACKLOG_USAGE =
  '参数 { limit?, minLevel?, name? }，都可省：limit 是正整数，只要筛完之后最近的几条；minLevel 是 debug / info / warn / error，只要这一级及以上；' +
  'name 是 logger 名，精确匹配（插件的 logger 名多是 gwb-<短名>）。都不给就回最多两千条（日志窗格这样取），agent 调时带上 limit。' +
  '回 [{ seq, ts, source, level, name, msg }]，从旧到新'

export interface BacklogFilter {
  limit?: number
  minLevel?: LogLevel
  name?: string
}

/** 参数是外部输入：认不出的键、类型不对都直接报错，不猜调用方的意思 */
export function backlogFilterFrom(args: unknown): BacklogFilter {
  if (args === undefined || args === null) return {}
  if (typeof args !== 'object' || Array.isArray(args)) throw new Error(`${BACKLOG_COMMAND} 的参数要是对象：${BACKLOG_USAGE}`)
  const raw = args as Record<string, unknown>
  const unknownKeys = Object.keys(raw).filter((key) => key !== 'limit' && key !== 'minLevel' && key !== 'name')
  if (unknownKeys.length > 0) throw new Error(`${BACKLOG_COMMAND} 不认识参数 ${unknownKeys.join('、')}：${BACKLOG_USAGE}`)
  const filter: BacklogFilter = {}
  if (raw['limit'] !== undefined) {
    if (typeof raw['limit'] !== 'number' || !Number.isInteger(raw['limit']) || raw['limit'] <= 0) {
      throw new Error(`${BACKLOG_COMMAND} 的 limit 要是正整数，拿到 ${JSON.stringify(raw['limit'])}`)
    }
    filter.limit = raw['limit']
  }
  if (raw['minLevel'] !== undefined) {
    if (!LEVELS_FROM_LOWEST.includes(raw['minLevel'] as LogLevel)) {
      throw new Error(`${BACKLOG_COMMAND} 的 minLevel 只能是 ${LEVELS_FROM_LOWEST.join(' / ')}，拿到 ${JSON.stringify(raw['minLevel'])}`)
    }
    filter.minLevel = raw['minLevel'] as LogLevel
  }
  if (raw['name'] !== undefined) {
    if (typeof raw['name'] !== 'string' || raw['name'] === '') throw new Error(`${BACKLOG_COMMAND} 的 name 要是非空字符串`)
    filter.name = raw['name']
  }
  return filter
}

/** 先按级别与名字筛，再取最近 limit 条；返回副本 */
export function selectBacklog(recentEntries: readonly LogEntry[], filter: BacklogFilter): LogEntry[] {
  const lowestIndex = filter.minLevel === undefined ? 0 : LEVELS_FROM_LOWEST.indexOf(filter.minLevel)
  const matching = recentEntries.filter(
    (entry) => LEVELS_FROM_LOWEST.indexOf(entry.level) >= lowestIndex && (filter.name === undefined || entry.name === filter.name),
  )
  return filter.limit === undefined ? matching : matching.slice(-filter.limit)
}

function registerLogCommands(ctx: GwbContext, commandBus: GwbCommands, kernel: GwbKernelApi, recentEntries: LogEntry[]): void {
  ctx.effect(() =>
    commandBus.register(
      { name: BACKLOG_COMMAND, description: '工作台启动以来的日志，可按级别、logger 名筛、只取最近几条', usage: BACKLOG_USAGE, plugin: PACKAGE_NAME, effect: 'read' },
      (args) => selectBacklog(recentEntries, backlogFilterFrom(args)),
    ),
  )
  ctx.effect(() =>
    commandBus.register(
      { name: WHERE_COMMAND, description: 'home 与日志文件在哪', usage: '无参数', plugin: PACKAGE_NAME, effect: 'read' },
      () => ({ home: kernel.dataDir, logFile: path.join(kernel.dataDir, 'gwb.log') }),
    ),
  )
}

export function apply(ctx: GwbContext): void {
  const kernel = requireKernel(ctx)
  const commandBus = ctx.gwbCommands
  // inject 保证了它在，这句只是把类型收窄（命令插件把它声明成可选的）
  if (commandBus === undefined) return

  // 先提供服务再做别的：日志窗格的嵌套注入等的就是它
  new GwbLogger(ctx, 'gwbLogger')

  const recentEntries = startCollectingLogs(ctx, kernel)
  registerLogCommands(ctx, commandBus, kernel, recentEntries)

  // 装了日志窗格的话，这一行出现在窗格里，可以用来确认整条链路是通的
  ctx.logger(name).info(`日志插件就绪：补收了加载之前的 ${recentEntries.length} 条日志`)
}

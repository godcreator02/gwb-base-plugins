import path from 'node:path'
import type { GwbContext } from '@godcreator/gwb-kernel-desktop'
import { requireKernel } from './vocab.js'
// 这个 import 同时激活命令插件的 `declare module 'cordis'`，给 ctx 加上 gwbCommands
import type {} from '@godcreator/gwb-commands'
import { QUERY_COMMAND, QUERY_USAGE, logQueryFrom, queryLogFile } from './query.js'

export { QUERY_COMMAND, QUERY_USAGE } from './query.js'
export type { LogQueryResult } from './query.js'
export type { LogEntry, LogLevel, LogSource } from './log-entry.js'

export const name = 'gwb-logger'

export const inject = ['gwbCommands']

const PACKAGE_NAME = '@godcreator/gwb-logger'
/** 内核写的日志文件名，与内核靠约定对齐；轮转出的旧文件是 `<它>.1` */
const LOG_FILE_NAME = 'gwb.log'

export function apply(ctx: GwbContext): void {
  const logFile = path.join(requireKernel(ctx).dataDir, LOG_FILE_NAME)
  const commandBus = ctx.gwbCommands
  // inject 保证了它在，这句只是把类型收窄（命令插件把它声明成可选的）
  if (commandBus === undefined) return

  ctx.effect(() =>
    commandBus.register(
      {
        name: QUERY_COMMAND,
        description: '查内核写的日志文件 gwb.log（含轮转出的 gwb.log.1）：可按级别、logger 名、子串筛，只取最近几条，或只取某个位置之后新写的',
        usage: QUERY_USAGE,
        plugin: PACKAGE_NAME,
        effect: 'read',
      },
      async (args) => queryLogFile(logFile, logQueryFrom(args)),
    ),
  )
}

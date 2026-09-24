import fs from 'node:fs'
import path from 'node:path'
import { isRecord } from './vocab.js'

// home 根下的运行记录里 MCP 插件那一项。文件由内核、本插件与读它的程序共用：只读改写、保留认不出的字段，进程退出不删

/** 运行记录的文件名。三个仓共用这一个名字 */
export const RUNTIME_FILE = 'runtime.json'

/** 本插件那一项的形状 */
export interface McpSlot {
  port: number
  url: string
}

/** 把自己那一项并进已有的记录，回要写回去的文本。读不出、半截 JSON、根不是对象，一律从空对象起 */
export function patchRuntime(text: string | undefined, mcp: McpSlot): string {
  let existing: unknown
  try {
    existing = text === undefined ? undefined : JSON.parse(text)
  } catch {
    existing = undefined
  }
  const base = isRecord(existing) ? existing : {}
  return JSON.stringify({ ...base, mcp }, null, 2) + '\n'
}

/** 读改写那份记录。不是原子写，见文档站 */
export function writeRuntimeMcp(dataDir: string, mcp: McpSlot): void {
  const file = path.join(dataDir, RUNTIME_FILE)
  let text: string | undefined
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    text = undefined
  }
  fs.writeFileSync(file, patchRuntime(text, mcp))
}

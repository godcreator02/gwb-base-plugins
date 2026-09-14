import fs from 'node:fs'
import path from 'node:path'
import { isRecord } from '@godcreator/gwb-plugin-api'

/**
 * home 根下那份运行记录里,本件占的那一格。
 *
 * **为什么这一格归本件**:这道口开在哪是**运行时才定的**——`default` 认死 2870,别的 home
 * 缺省要系统随机口,绑成功之后手里才有真正的那个数(见 `endpoint.ts`)。下游想「说出 home
 * 名就连得上它」,就得有人把这个数落在 home 里,而这个数只有这个件知道。
 *
 * 文件是**跨仓共用的契约**:内核开机时整份重写(pid / startedAt / appDir / cdp),本件在
 * 绑成之后补 `command-http` 这一格（格子名随插件短名：mcp 那格叫 `mcp`，一天名 `gwb-http`
 * 时叫 `http`，2026-09-13 正名后随它；旧格是「认不得的字段」，一律保留不动）。于是有两条纪律:
 *
 * - **只许读改写,保留一切不认得的字段**。整份覆盖会把内核那几格抹掉,而那几格是下游定位
 *   这个 home 的唯一凭据
 * - **进程退出不删**。崩溃与被 kill 是常态,「退出时清掉」那条路在那两种情况下本来就不跑;
 *   留着的记录还是「上一次它在哪儿」的唯一线索。**代价是记录随时可能是陈旧的,验活是读的
 *   人的事**（核 pid 还在、且那个 pid 真持着那个端口）
 */

/** 那份记录的文件名。跨仓共用这一个名字 */
export const RUNTIME_FILE = 'runtime.json'

/** 本件那一格的形状 */
export interface HttpSlot {
  port: number
  url: string
}

/**
 * 把自己那格并进已有的记录,回要写回去的文本。
 *
 * **读不动、半截 JSON、根不是对象,一律当没有**,从一个空对象起:这份记录是给人和别的进程
 * 定位用的辅助物,不是这道口能不能开的前提。为一份坏文件让这道门不写、或者抛出去,是把
 * 附属品的失败升格成主业的失败。
 */
export function patchRuntime(text: string | undefined, http: HttpSlot): string {
  let existing: unknown
  try {
    existing = text === undefined ? undefined : JSON.parse(text)
  } catch {
    existing = undefined
  }
  const base = isRecord(existing) ? existing : {}
  return JSON.stringify({ ...base, 'command-http': http }, null, 2) + '\n'
}

/**
 * 读改写那份记录。
 *
 * **不是原子写**:写到一半崩掉会留下一个半截文件。认下——读的那头本来就把读不动当没有,
 * 而内核下次开机整份重写。要原子就得落临时文件再 rename,为一份辅助记录不值。
 */
export function writeRuntimeHttp(dataDir: string, http: HttpSlot): void {
  const file = path.join(dataDir, RUNTIME_FILE)
  let text: string | undefined
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    text = undefined
  }
  fs.writeFileSync(file, patchRuntime(text, http))
}

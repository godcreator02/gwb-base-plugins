/** 命令总线的回执；data 的结构由具体命令决定。 */
export interface GwbResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

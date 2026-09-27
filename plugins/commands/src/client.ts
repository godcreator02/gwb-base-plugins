import type {} from '@godcreator/gwb-kernel-desktop'
import type { GwbResult } from './result.js'
export type { GwbResult } from './result.js'

/** 无主进程依赖的页面入口；由消费方打包，不要求浏览器共享实例。 */
export async function command<T = unknown>(name: string, args?: unknown): Promise<GwbResult<T>> {
  let result: unknown
  try {
    result = await window.gwb.request('commands.run', { name, args })
  } catch (error) {
    if (error instanceof Error && error.message === 'GWB_REQUEST_UNAVAILABLE: commands.run') {
      return { ok: false, error: `没有命令服务，无法执行 ${name}` }
    }
    throw error
  }
  if (result === null || typeof result !== 'object' || !('ok' in result) || typeof result.ok !== 'boolean' ||
    ('error' in result && result.error !== undefined && typeof result.error !== 'string')) {
    throw new Error('命令服务返回了无效回执')
  }
  return result as GwbResult<T>
}

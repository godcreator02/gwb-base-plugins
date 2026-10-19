import { parentPort, workerData } from 'node:worker_threads'

/**
 * 线程池里每个线程的入口：加载插件给的模块一次，之后逐条执行 `{ id, fn, args }`，交回 `{ id, ok, value | error }`。
 * 只写能被 node 直接去掉类型的写法：测试不经构建，直接拿这个 .ts 文件开线程
 */

interface ThreadTask { id: number; fn: string; args: unknown[] }

const port = parentPort!
const moduleHref = (workerData as { module: string }).module
const exported = (await import(moduleHref)) as Record<string, unknown>

function errorPayload(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) return { name: error.name, message: error.message, ...(error.stack === undefined ? {} : { stack: error.stack }) }
  return { name: 'Error', message: String(error) }
}

async function runTask(task: ThreadTask): Promise<void> {
  try {
    const target = exported[task.fn]
    if (typeof target !== 'function') throw new Error(`模块 ${moduleHref} 没有导出函数 ${task.fn}`)
    const value: unknown = await target(...task.args)
    port.postMessage({ id: task.id, ok: true, value })
  } catch (error) {
    port.postMessage({ id: task.id, ok: false, error: errorPayload(error) })
  }
}

port.on('message', (task: ThreadTask) => void runTask(task))

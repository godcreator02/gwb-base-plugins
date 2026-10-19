import { Worker } from 'node:worker_threads'

export interface WorkerPoolOptions {
  /** 池名：同一个插件里不重名，出现在报错与 workers.stats 里 */
  name: string
  /** 线程里加载的模块，file: 地址，一般写 `new URL('./worker.js', import.meta.url)`；run 调的是它导出的函数 */
  module: URL
  /** 最多开几个线程，1–16：有任务排队时才开，开了就常驻，模块在每个线程里只加载一次 */
  threads: number
  /** 一个任务最多跑多少毫秒，超了就终止它所在的线程、任务报错；不给就不限 */
  taskTimeoutMs?: number
}

export interface WorkerPool {
  /**
   * 在空闲线程上调模块导出的函数 `fn(...args)`，先来先跑；线程都忙就排队。
   * 参数与返回值过线程要能被结构化克隆（不能有函数、类的实例按普通对象过去）；
   * 函数抛错时按原来的 name 与 message 报错，自定义错误类的身份过不来，要分辨就在线程里换成返回值
   */
  run(fn: string, args: readonly unknown[]): Promise<unknown>
}

export interface WorkerTaskRecord {
  fn: string
  /** 排队等了多久 */
  waitMs: number
  /** 在线程上跑了多久 */
  runMs: number
  ok: boolean
  endedAt: string
}

export interface WorkerPoolStats {
  plugin: string
  name: string
  module: string
  threads: number
  /** 现在开着的线程 */
  alive: number
  busy: number
  queued: number
  done: number
  failed: number
  /** 最近的任务，新的在前 */
  recent: WorkerTaskRecord[]
}

const RECENT_TASKS = 20

interface QueuedTask {
  fn: string
  args: readonly unknown[]
  queuedAt: number
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

interface RunningTask { id: number; task: QueuedTask; startedAt: number; timer: ReturnType<typeof setTimeout> | undefined }

interface PoolThread { worker: Worker; running: RunningTask | null }

/** 线程交回的一条结果，形状由 thread.ts 定 */
type ThreadReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: { name: string; message: string; stack?: string } }

function errorFromThread(payload: { name: string; message: string; stack?: string }): Error {
  const error = new Error(payload.message)
  error.name = payload.name
  if (payload.stack !== undefined) error.stack = payload.stack
  return error
}

export class WorkerPoolCore {
  private readonly queue: QueuedTask[] = []
  private readonly threads: PoolThread[] = []
  private readonly recent: WorkerTaskRecord[] = []
  private nextTaskId = 1
  private done = 0
  private failed = 0
  private closedReason: string | null = null

  constructor(
    private readonly plugin: string,
    private readonly options: WorkerPoolOptions,
    /** 线程入口：构建产物里是 thread.js，测试里直接用 thread.ts */
    private readonly threadEntry: URL,
  ) {}

  run(fn: string, args: readonly unknown[]): Promise<unknown> {
    if (this.closedReason !== null) return Promise.reject(new Error(this.closedReason))
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, args, queuedAt: performance.now(), resolve, reject })
      this.startQueuedTasks()
    })
  }

  /** 关掉线程池：排队的与正在跑的任务都以 reason 报错，线程全部终止；之后的 run 也以 reason 报错 */
  close(reason: string): void {
    if (this.closedReason !== null) return
    this.closedReason = reason
    for (const task of this.queue.splice(0)) task.reject(new Error(reason))
    for (const thread of this.threads.splice(0)) {
      if (thread.running !== null) this.finishRunning(thread.running, new Error(reason))
      void thread.worker.terminate()
    }
  }

  stats(): WorkerPoolStats {
    return {
      plugin: this.plugin,
      name: this.options.name,
      module: this.options.module.href,
      threads: this.options.threads,
      alive: this.threads.length,
      busy: this.threads.filter((thread) => thread.running !== null).length,
      queued: this.queue.length,
      done: this.done,
      failed: this.failed,
      recent: [...this.recent],
    }
  }

  private get label(): string {
    return `${this.plugin} 的线程池 ${this.options.name}`
  }

  private startQueuedTasks(): void {
    while (this.queue.length > 0) {
      const thread = this.threads.find((candidate) => candidate.running === null) ?? (this.threads.length < this.options.threads ? this.openThread() : undefined)
      if (thread === undefined) return
      this.startOn(thread, this.queue.shift()!)
    }
  }

  private openThread(): PoolThread {
    const worker = new Worker(this.threadEntry, { workerData: { module: this.options.module.href } })
    const thread: PoolThread = { worker, running: null }
    this.threads.push(thread)
    worker.on('message', (reply: ThreadReply) => this.onReply(thread, reply))
    worker.on('error', (error) => this.dropThread(thread, new Error(`${this.label} 的线程出错：${error.message}`)))
    worker.on('exit', (code) => this.dropThread(thread, new Error(`${this.label} 的线程退出了（退出码 ${String(code)}）`)))
    return thread
  }

  /** 参数不能结构化克隆时 postMessage 在主线程同步抛错：只让这一个任务失败，线程放回空闲 */
  private startOn(thread: PoolThread, task: QueuedTask): void {
    const id = this.nextTaskId++
    const timeoutMs = this.options.taskTimeoutMs
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => this.timeOut(thread), timeoutMs)
    const running: RunningTask = { id, task, startedAt: performance.now(), timer }
    thread.running = running
    try {
      thread.worker.postMessage({ id, fn: task.fn, args: task.args })
    } catch (error) {
      thread.running = null
      this.finishRunning(running, error instanceof Error ? error : new Error(String(error)))
    }
  }

  private onReply(thread: PoolThread, reply: ThreadReply): void {
    const running = thread.running
    if (running === null || running.id !== reply.id) return
    thread.running = null
    this.finishRunning(running, reply.ok ? null : errorFromThread(reply.error), reply.ok ? reply.value : undefined)
    this.startQueuedTasks()
  }

  private timeOut(thread: PoolThread): void {
    const running = thread.running
    if (running === null) return
    this.dropThread(thread, new Error(`${this.label} 的任务 ${running.task.fn} 超过 ${String(this.options.taskTimeoutMs)} 毫秒没完成，已终止它所在的线程`))
    void thread.worker.terminate()
  }

  /** 线程出错、退出或超时：从池里拿掉，正在跑的任务以 error 报错，排队的换新线程接着跑。同一个线程只处理第一次 */
  private dropThread(thread: PoolThread, error: Error): void {
    const index = this.threads.indexOf(thread)
    if (index === -1) return
    this.threads.splice(index, 1)
    const running = thread.running
    thread.running = null
    if (running !== null) this.finishRunning(running, error)
    if (this.closedReason === null) this.startQueuedTasks()
  }

  private finishRunning(running: RunningTask, error: Error | null, value?: unknown): void {
    if (running.timer !== undefined) clearTimeout(running.timer)
    const endedAt = performance.now()
    this.recent.unshift({
      fn: running.task.fn,
      waitMs: Math.round(running.startedAt - running.task.queuedAt),
      runMs: Math.round(endedAt - running.startedAt),
      ok: error === null,
      endedAt: new Date().toISOString(),
    })
    this.recent.length = Math.min(this.recent.length, RECENT_TASKS)
    if (error === null) {
      this.done += 1
      running.task.resolve(value)
    } else {
      this.failed += 1
      running.task.reject(error)
    }
  }
}

const MAX_THREADS = 16

/** 服务入口的参数检查：选项来自插件代码，不对就当场抛错，写明哪个插件、哪一项 */
export function checkedPoolOptions(plugin: string, options: WorkerPoolOptions): WorkerPoolOptions {
  const { name, module, threads, taskTimeoutMs } = options
  if (typeof name !== 'string' || name === '') throw new Error(`${plugin} 开线程池要给非空的 name`)
  if (!(module instanceof URL) || module.protocol !== 'file:') throw new Error(`${plugin} 的线程池 ${name}：module 要是 file: 地址的 URL`)
  if (!Number.isInteger(threads) || threads < 1 || threads > MAX_THREADS) throw new Error(`${plugin} 的线程池 ${name}：threads 要是 1–${String(MAX_THREADS)} 的整数，拿到 ${String(threads)}`)
  if (taskTimeoutMs !== undefined && (!Number.isInteger(taskTimeoutMs) || taskTimeoutMs < 1)) throw new Error(`${plugin} 的线程池 ${name}：taskTimeoutMs 要是正整数，拿到 ${String(taskTimeoutMs)}`)
  return { name, module, threads, ...(taskTimeoutMs === undefined ? {} : { taskTimeoutMs }) }
}

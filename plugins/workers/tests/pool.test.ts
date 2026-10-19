import { afterEach, describe, expect, it } from 'vitest'
import { checkedPoolOptions, WorkerPoolCore, type WorkerPoolOptions } from '../src/pool.js'

/** 测试不经构建，直接用 thread.ts 开线程（node 24 自带去类型） */
const THREAD_ENTRY = new URL('../src/thread.ts', import.meta.url)
const TASKS = new URL('./fixtures/tasks.mjs', import.meta.url)

const openPools: WorkerPoolCore[] = []
afterEach(() => {
  for (const pool of openPools.splice(0)) pool.close('测试结束')
})

function openPool(options: Partial<WorkerPoolOptions> = {}): WorkerPoolCore {
  const pool = new WorkerPoolCore('@t/caller', { name: 'test', module: TASKS, threads: 1, ...options }, THREAD_ENTRY)
  openPools.push(pool)
  return pool
}

describe('WorkerPoolCore 跑任务', () => {
  it('调模块导出的函数，参数与返回值过线程', async () => {
    const pool = openPool()
    expect(await pool.run('echo', [{ a: [1, 'two'], b: null }])).toEqual({ a: [1, 'two'], b: null })
  })

  it('线程常驻：模块只加载一次，模块级状态在同一个线程上保留', async () => {
    const pool = openPool()
    expect(await pool.run('count', [])).toBe(1)
    expect(await pool.run('count', [])).toBe(2)
    expect(pool.stats().alive).toBe(1)
  })

  it('线程都忙就排队，先来先跑', async () => {
    const pool = openPool()
    const order: number[] = []
    await Promise.all([1, 2, 3].map((n) => pool.run('sleep', [30 - n * 5]).then(() => order.push(n))))
    expect(order).toEqual([1, 2, 3])
  })

  it('threads 给几个就最多开几个，同时跑', async () => {
    const pool = openPool({ threads: 2 })
    const started = performance.now()
    const threadIds = await Promise.all([pool.run('spin', [300]), pool.run('spin', [300])])
    expect(performance.now() - started).toBeLessThan(550)
    expect(new Set(threadIds).size).toBe(2)
    expect(pool.stats()).toMatchObject({ threads: 2, alive: 2, busy: 0, done: 2 })
  })

  it('线程里同步占住时，主线程照常处理别的事', async () => {
    const pool = openPool()
    let ticks = 0
    const timer = setInterval(() => (ticks += 1), 20)
    await pool.run('spin', [400])
    clearInterval(timer)
    expect(ticks).toBeGreaterThan(10)
  })
})

describe('WorkerPoolCore 报错', () => {
  it('函数抛错按原来的 name 与 message 报，线程留着接着用', async () => {
    const pool = openPool()
    await expect(pool.run('fail', ['坏了'])).rejects.toMatchObject({ name: 'TypeError', message: '坏了' })
    expect(await pool.run('count', [])).toBe(1)
    expect(pool.stats()).toMatchObject({ alive: 1, done: 1, failed: 1 })
  })

  it('模块没有这个导出函数', async () => {
    const pool = openPool()
    await expect(pool.run('missing', [])).rejects.toThrow('没有导出函数 missing')
  })

  it('返回值不能克隆时报错', async () => {
    const pool = openPool()
    await expect(pool.run('unclonable', [])).rejects.toMatchObject({ name: 'DataCloneError' })
  })

  it('参数不能克隆时只这一个任务报错，线程不被占住，排在后面的照常跑', async () => {
    const pool = openPool()
    const first = pool.run('sleep', [50])
    const unclonable = pool.run('echo', [() => 1])
    const next = pool.run('count', [])
    expect(await first).toBe(50)
    await expect(unclonable).rejects.toMatchObject({ name: 'DataCloneError' })
    expect(await next).toBe(1)
    expect(await pool.run('echo', [() => 1]).catch((error: Error) => error.name)).toBe('DataCloneError')
    expect(await pool.run('count', [])).toBe(2)
    expect(pool.stats()).toMatchObject({ alive: 1, busy: 0, failed: 2 })
  })

  it('模块加载不了：任务报线程出错', async () => {
    const pool = openPool({ module: new URL('./fixtures/no-such-module.mjs', import.meta.url) })
    await expect(pool.run('echo', [1])).rejects.toThrow('@t/caller 的线程池 test 的线程出错')
  })

  it('线程自己退出：正在跑的任务报退出码，下一个任务换新线程', async () => {
    const pool = openPool()
    expect(await pool.run('count', [])).toBe(1)
    await expect(pool.run('exitThread', [3])).rejects.toThrow('退出码 3')
    expect(await pool.run('count', [])).toBe(1)
  })

  it('超时终止线程、任务报错，排在后面的换新线程接着跑', async () => {
    const pool = openPool({ taskTimeoutMs: 200 })
    expect(await pool.run('count', [])).toBe(1)
    const timedOut = pool.run('spin', [5000])
    const next = pool.run('count', [])
    await expect(timedOut).rejects.toThrow('任务 spin 超过 200 毫秒没完成，已终止它所在的线程')
    expect(await next).toBe(1)
  })
})

describe('WorkerPoolCore 关闭', () => {
  it('排队与正在跑的任务以关闭原因报错，之后的 run 也报错，线程终止', async () => {
    const pool = openPool()
    const running = pool.run('sleep', [500])
    const queued = pool.run('echo', [1])
    await new Promise((resolve) => setTimeout(resolve, 50))
    pool.close('插件卸载了')
    await expect(running).rejects.toThrow('插件卸载了')
    await expect(queued).rejects.toThrow('插件卸载了')
    await expect(pool.run('echo', [2])).rejects.toThrow('插件卸载了')
    expect(pool.stats()).toMatchObject({ alive: 0, queued: 0 })
  })
})

describe('WorkerPoolCore 现状', () => {
  it('最近的任务记下函数名、等了多久、跑了多久、成败，新的在前', async () => {
    const pool = openPool()
    await pool.run('spin', [100])
    await expect(pool.run('fail', ['x'])).rejects.toThrow('x')
    const [last, first] = pool.stats().recent
    expect(last).toMatchObject({ fn: 'fail', ok: false })
    expect(first).toMatchObject({ fn: 'spin', ok: true })
    expect(first!.runMs).toBeGreaterThanOrEqual(90)
  })
})

describe('checkedPoolOptions', () => {
  const base = { name: 'p', module: TASKS, threads: 2 }
  it('收合法的选项，没给超时就不带这一项', () => {
    expect(checkedPoolOptions('@t/x', base)).toEqual(base)
  })
  it.each([
    [{ ...base, name: '' }, '非空的 name'],
    [{ ...base, module: new URL('https://example.com/a.js') }, 'file: 地址'],
    [{ ...base, threads: 0 }, '1–16 的整数'],
    [{ ...base, threads: 17 }, '1–16 的整数'],
    [{ ...base, taskTimeoutMs: 0 }, 'taskTimeoutMs 要是正整数'],
  ])('不合法的选项当场抛错，写明哪个插件：%o', (options, message) => {
    expect(() => checkedPoolOptions('@t/x', options)).toThrow(message)
    expect(() => checkedPoolOptions('@t/x', options)).toThrow('@t/x')
  })
})

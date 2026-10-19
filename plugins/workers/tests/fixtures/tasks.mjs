import { threadId } from 'node:worker_threads'

// 线程池测试在线程里加载的模块：每个导出函数是一种任务

let calls = 0

export const echo = (value) => value

/** 模块级状态留在线程里：同一个线程上调几次就数到几 */
export const count = () => (calls += 1)

export const whichThread = () => threadId

/** 同步占住线程 ms 毫秒，回线程号 */
export function spin(ms) {
  const end = Date.now() + ms
  while (Date.now() < end);
  return threadId
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(() => resolve(ms), ms))

export function fail(message) {
  throw new TypeError(message)
}

export const unclonable = () => () => 1

export function exitThread(code) {
  process.exit(code)
}

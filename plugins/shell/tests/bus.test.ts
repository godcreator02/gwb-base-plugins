import { describe, expect, it } from 'vitest'
import { createBusRegistry } from '../src/bus.js'

/**
 * 格间小总线：同一条条目的几格之间说话。
 *
 * 隔离粒度是**条目**不是包——同一个包挂两条条目是两份独立配置的实例，让它们的窗格
 * 互相听见，收到的就是别人那份实例的事件。这跟 store 按包分格是不一致的（那边同包
 * 两条条目共用一格数据），认下这个不一致：store 只能有一份落盘位置，而这里传的是
 * UI 事件，串台是纯粹的 bug 源。
 */

/** 记下听见了什么。本包没有 vitest 依赖（插件包一律没有），所以不用 vi.fn */
function spy() {
  const heard: unknown[] = []
  return { heard, listener: (detail: unknown) => heard.push(detail) }
}

describe('createBusRegistry：按条目分桶', () => {
  it('同一条条目的两格互相听得见', () => {
    const reg = createBusRegistry()
    const a = reg.acquire('pomodoro')
    const b = reg.acquire('pomodoro')
    const { heard, listener } = spy()
    b.on('session-done', listener)
    a.emit('session-done', { seq: 3 })
    expect(heard).toEqual([{ seq: 3 }])
  })

  it('自己发的自己也听得见——一格既发又听是合法的用法', () => {
    const reg = createBusRegistry()
    const bus = reg.acquire('pomodoro')
    const { heard, listener } = spy()
    bus.on('tick', listener)
    bus.emit('tick')
    expect(heard).toEqual([undefined])
  })

  it('两条条目之间不串台', () => {
    const reg = createBusRegistry()
    const work = reg.acquire('pomo-work')
    const rest = reg.acquire('pomo-rest')
    const { heard, listener } = spy()
    rest.on('session-done', listener)
    work.emit('session-done')
    expect(heard).toEqual([])
  })

  it('别的事件名听不见', () => {
    const reg = createBusRegistry()
    const bus = reg.acquire('x')
    const { heard, listener } = spy()
    bus.on('a', listener)
    bus.emit('b')
    expect(heard).toEqual([])
  })

  it('on 回的注销函数摘得干净，摘完再发就听不见了', () => {
    const reg = createBusRegistry()
    const bus = reg.acquire('x')
    const { heard, listener } = spy()
    const off = bus.on('t', listener)
    off()
    bus.emit('t')
    expect(heard).toEqual([])
    // 摘两遍不炸：React 严格模式下清理会跑两次
    expect(() => off()).not.toThrow()
  })

  it('一个听众抛了不影响另一个——插件写坏了不该把兄弟格一起带走', () => {
    const reg = createBusRegistry()
    const bus = reg.acquire('x')
    const { heard, listener } = spy()
    bus.on('t', () => {
      throw new Error('插件里抛的')
    })
    bus.on('t', listener)
    expect(() => bus.emit('t')).not.toThrow()
    expect(heard).toEqual([undefined])
  })

  it('听众里摘听众不影响这一轮的派发', () => {
    // 收到一条就摘掉自己是常见写法；直接遍历活集合会漏掉后面的听众
    const reg = createBusRegistry()
    const bus = reg.acquire('x')
    const { heard, listener } = spy()
    const off = bus.on('t', () => off())
    bus.on('t', listener)
    bus.emit('t')
    expect(heard).toEqual([undefined])
  })

  it('最后一格 release 之后桶就没了，下一格拿到的是干净的桶', () => {
    const reg = createBusRegistry()
    const a = reg.acquire('x')
    const { heard, listener } = spy()
    a.on('t', listener)
    a.release()
    // 桶没了：新拿一个来发，上一轮的听众不该还挂着
    reg.acquire('x').emit('t')
    expect(heard).toEqual([])
  })

  it('还有别的格占着时不拆桶', () => {
    const reg = createBusRegistry()
    const a = reg.acquire('x')
    const b = reg.acquire('x')
    const { heard, listener } = spy()
    b.on('t', listener)
    a.release()
    reg.acquire('x').emit('t')
    expect(heard).toEqual([undefined])
  })

  it('release 幂等：一格松两次手不该把别人的桶拆了', () => {
    const reg = createBusRegistry()
    const a = reg.acquire('x')
    const b = reg.acquire('x')
    const { heard, listener } = spy()
    b.on('t', listener)
    a.release()
    a.release()
    reg.acquire('x').emit('t')
    expect(heard).toEqual([undefined])
  })

  /**
   * **桶还活着的时候松手**——同一格开两份、关掉其中一份就是这个局面。
   *
   * 上面那条「最后一格 release 之后桶就没了」覆盖不到它：那儿桶整个消失，
   * 听众摘没摘看不出来。一格一份的年代这个洞一直是遮住的。
   */
  it('松手的那一格，自己挂的听众要摘干净——桶还被别人撑着也一样', () => {
    const reg = createBusRegistry()
    const 走的 = reg.acquire('x')
    const 留的 = reg.acquire('x')
    const gone = spy()
    const stay = spy()
    走的.on('t', gone.listener)
    留的.on('t', stay.listener)

    走的.release()
    留的.emit('t', 1)

    // 关掉的那一格不该再收到——它的 React 树已经拆了
    expect(gone.heard).toEqual([])
    expect(stay.heard).toEqual([1])
  })

  it('自己先 off 再 release 不炸，别人挂的照旧', () => {
    const reg = createBusRegistry()
    const a = reg.acquire('x')
    const b = reg.acquire('x')
    const gone = spy()
    const stay = spy()
    const off = a.on('t', gone.listener)
    off()
    off()
    b.on('t', stay.listener)
    a.release()
    b.emit('t', 7)
    expect(gone.heard).toEqual([])
    expect(stay.heard).toEqual([7])
  })

  /**
   * 桶里那层是 `Set`，**按函数引用去重**：两格挂了同一个函数只存一份，谁先摘谁就把
   * 它摘走了。实践上碰不着——每一格的听众是它自己那棵树的闭包——但这条语义得钉住，
   * 免得将来有人往桶里放一个模块级的共享函数然后百思不解。
   */
  it('两格挂同一个函数引用时，桶里只有一份', () => {
    const reg = createBusRegistry()
    const a = reg.acquire('x')
    const b = reg.acquire('x')
    const { heard, listener } = spy()
    a.on('t', listener)
    b.on('t', listener)
    b.emit('t', 1)
    // 两次 on 同一个引用，只收到一条
    expect(heard).toEqual([1])
    a.release()
    b.emit('t', 2)
    // a 松手时把那唯一的一份带走了
    expect(heard).toEqual([1])
  })
})

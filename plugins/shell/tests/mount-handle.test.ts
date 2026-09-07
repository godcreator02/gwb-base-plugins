import { describe, expect, it } from 'vitest'
import { describeHandle, pickMountPane, pickDispose } from '../src/mount-handle.js'

/**
 * 外壳接窗格契约的那两步收窄。要钉住的是：句柄按契约是 `{ dispose() }` 这个**对象**，
 * 卸载得从它身上取 dispose 来调——把句柄当函数调是 TypeError，而卸载路径上的异常
 * 通常被吞掉，清理于是一次都没跑过、还没有任何现象。
 */

describe('pickMountPane：按契约取 mountPane 导出', () => {
  it('模块上有 mountPane 函数就回它', () => {
    const mountPane = () => ({ dispose() {} })
    expect(pickMountPane({ mountPane })).toBe(mountPane)
  })

  it('缺 mountPane、它不是函数、模块不是对象，一律 undefined', () => {
    expect(pickMountPane({})).toBeUndefined()
    expect(pickMountPane({ mountPane: 'nope' })).toBeUndefined()
    expect(pickMountPane(null)).toBeUndefined()
    expect(pickMountPane(undefined)).toBeUndefined()
    expect(pickMountPane(42)).toBeUndefined()
  })

  it('导出成 mount 的不认——那是改名之前的写法,也是外壳那半用的动词', () => {
    expect(pickMountPane({ mount: () => ({ dispose() {} }) })).toBeUndefined()
    expect(pickMountPane({ bootShell: () => ({ dispose() {} }) })).toBeUndefined()
  })
})

describe('pickDispose：句柄上的 dispose 才是卸载口', () => {
  it('契约形态 { dispose() }：取出来调一次，清理真跑', () => {
    let cleaned = 0
    const off = pickDispose({ dispose: () => void (cleaned += 1) })
    expect(off).toBeTypeOf('function')
    off!()
    expect(cleaned).toBe(1)
  })

  it('dispose 写成方法时 this 是句柄本身（方法体里读得到自己的字段）', () => {
    const handle = {
      seen: null as unknown,
      dispose() {
        this.seen = this
      },
    }
    pickDispose(handle)!()
    expect(handle.seen).toBe(handle)
  })

  it('函数句柄一律不收，挂没挂 dispose 都一样——契约里的句柄是对象', () => {
    let viaCall = 0
    let viaDispose = 0
    // 「可直接调、同时挂着 dispose」那种两头兼容的形态也在此列
    const both = Object.assign(() => void (viaCall += 1), { dispose: () => void (viaDispose += 1) })
    expect(pickDispose(both)).toBeUndefined()
    expect(pickDispose(() => void (viaCall += 1))).toBeUndefined()
    expect(viaCall).toBe(0)
    expect(viaDispose).toBe(0)
  })

  it('没有 dispose、它不是函数、句柄不是对象，一律 undefined', () => {
    expect(pickDispose({})).toBeUndefined()
    expect(pickDispose({ dispose: true })).toBeUndefined()
    expect(pickDispose(undefined)).toBeUndefined()
    expect(pickDispose(null)).toBeUndefined()
    expect(pickDispose('x')).toBeUndefined()
  })

  it('回 unmount 的老写法不认——那是改名之前的契约', () => {
    expect(pickDispose({ unmount: () => {} })).toBeUndefined()
  })
})

describe('describeHandle：契约不符时说清回的是什么', () => {
  it('对象列键、函数点明要的是对象、原始值报类型', () => {
    expect(describeHandle({ destroy() {} })).toContain('destroy')
    expect(describeHandle({})).toContain('无')
    expect(describeHandle(() => {})).toContain('函数')
    expect(describeHandle(undefined)).toBe('undefined')
    expect(describeHandle(null)).toBe('null')
    expect(describeHandle(7)).toBe('number')
  })

  it('mountPane 写成 async 回的是 Promise：点名 thenable，不报成「对象（键：无）」', () => {
    const asyncMount = async () => ({ dispose() {} })
    const handle: unknown = asyncMount()
    // Promise 上没有 dispose，pickDispose 照契约给 undefined
    expect(pickDispose(handle)).toBeUndefined()
    const said = describeHandle(handle)
    expect(said).toContain('Promise')
    expect(said).toContain('同步')
    // 自造的 thenable 同样算。这儿是**故意**造一个：no-thenable 防的是无意中把对象
    // 弄成 thenable，而这条测试要验的正是「碰上那种对象也认得出来」
    // oxlint-disable-next-line unicorn/no-thenable
    expect(describeHandle({ then() {} })).toContain('Promise')
  })
})

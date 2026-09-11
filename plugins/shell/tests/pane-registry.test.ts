import { describe, expect, it, vi } from 'vitest'
import { createPaneRegistry, type PaneOwner } from '../src/pane-registry.js'

/**
 * 窗格注册表。要钉住的是三样：身份由服务填而不是件自己报、注销只收自己那份、
 * 一条条目一个命名空间。
 */

const echo: PaneOwner = { entryId: 'echo', pkg: '@godcreator02/gwb-echo' }
/** 同一个包挂的第二条条目：两份独立配置的实例，各注册各的 */
const echo2: PaneOwner = { entryId: 'echo-2', pkg: '@godcreator02/gwb-echo' }

function fresh() {
  const warn = vi.fn<(message: string) => void>()
  return { warn, reg: createPaneRegistry(warn) }
}

describe('register：件给三样，身份由服务填', () => {
  it('进表的那条带着 entryId 与 pkg', () => {
    const { reg } = fresh()
    reg.register(echo, { id: 'main', title: '回声', icon: 'megaphone' })
    expect(reg.list()).toEqual([
      { id: 'main', title: '回声', icon: 'megaphone', entryId: 'echo', pkg: '@godcreator02/gwb-echo' },
    ])
  })

  it('icon 可以不给', () => {
    const { reg } = fresh()
    reg.register(echo, { id: 'main', title: '回声' })
    expect(reg.list()[0]).not.toHaveProperty('icon')
  })

  it('按注册先后排', () => {
    const { reg } = fresh()
    reg.register(echo, { id: 'b', title: 'B' })
    reg.register(echo, { id: 'a', title: 'A' })
    expect(reg.list().map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('件改不了已经进表的那条——存的是拷贝', () => {
    const { reg } = fresh()
    const spec = { id: 'main', title: '回声' }
    reg.register(echo, spec)
    spec.title = '被改了'
    expect(reg.list()[0]!.title).toBe('回声')
  })
})

describe('一条条目一个命名空间', () => {
  it('同一个包的两条条目各注册一格同名的，两条都在', () => {
    const { reg, warn } = fresh()
    reg.register(echo, { id: 'main', title: '一号' })
    reg.register(echo2, { id: 'main', title: '二号' })
    expect(reg.list().map((p) => [p.entryId, p.title])).toEqual([
      ['echo', '一号'],
      ['echo-2', '二号'],
    ])
    // 这不叫撞名：分得开的两格
    expect(warn).not.toHaveBeenCalled()
  })

  it('同一条条目注册两次同一个 id：后来者赢，但要说出来', () => {
    const { reg, warn } = fresh()
    reg.register(echo, { id: 'main', title: '旧的' })
    reg.register(echo, { id: 'main', title: '新的' })
    expect(reg.list()).toHaveLength(1)
    expect(reg.list()[0]!.title).toBe('新的')
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]![0]).toContain('main')
  })
})

describe('注销：只收自己那份', () => {
  it('摘掉一格，别的不动；摘两遍不炸', () => {
    const { reg } = fresh()
    const off = reg.register(echo, { id: 'a', title: 'A' })
    reg.register(echo, { id: 'b', title: 'B' })
    off()
    off()
    expect(reg.list().map((p) => p.id)).toEqual(['b'])
  })

  it('被后来者顶掉之后再摘，摘的不是新那条', () => {
    const { reg } = fresh()
    const off = reg.register(echo, { id: 'main', title: '旧的' })
    reg.register(echo, { id: 'main', title: '新的' })
    // 旧那格的 effect 这时才收尾（件重挂时正是这个顺序）
    off()
    expect(reg.list()[0]!.title).toBe('新的')
  })
})

describe('说不清自己是谁的一律抛——不静默进表', () => {
  it('空 id、空 title 都抛，话里带着包名', () => {
    const { reg } = fresh()
    expect(() => reg.register(echo, { id: '', title: '回声' })).toThrow(/gwb-echo/)
    expect(() => reg.register(echo, { id: 'main', title: '' })).toThrow(/main/)
    expect(reg.list()).toEqual([])
  })

  it('窗格 id 带冒号也抛——那是拼面板 id 的分隔符', () => {
    // entryId 自己就带冒号（实机 `home:hello`）。窗格 id 里再有一个的话,两组不同的
    // (条目, 窗格) 能拼出同一个面板 id,而开格那处的查重会把它当成「已经开着」、
    // 静默追个 `:2` 上去——人看到的是标题莫名多了个 (2),源头在别的件的注册参数里
    const { reg } = fresh()
    expect(() => reg.register(echo, { id: 'a:b', title: '回声' })).toThrow(/冒号/)
    expect(reg.list()).toEqual([])
  })
})

describe('注册的是**定义**，一格开几份不在这张表上', () => {
  it('件说不出「我能开几份」——那张老的 duplicable 开关删掉了', () => {
    // 一格开几份取决于它装着几份不同的内容（`openPane` 的 `key`），不取决于谁给过权限。
    // 多写一个字段进来的话，注册表就又成了「开格那处要回头查一遍」的东西
    const { reg } = fresh()
    reg.register(echo, { id: 'main', title: '回声' })
    expect(Object.keys(reg.list()[0]!).sort()).toEqual(['entryId', 'id', 'pkg', 'title'])
  })
})

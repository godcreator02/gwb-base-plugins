import { describe, expect, it, vi } from 'vitest'
import { createPluginRegistry } from '../src/plugin-registry.js'

/**
 * 件级信息表。判据跟窗格表同源（身份由服务填、撞名后来者赢、注销只收自己那份），
 * 差别只在键：这张按 `entryId`，一条条目至多一条。
 */

const echo = { entryId: 'echo', pkg: '@godcreator02/gwb-echo' }
/** 同一个包挂的第二条条目 */
const echo2 = { entryId: 'echo-2', pkg: '@godcreator02/gwb-echo' }

function fresh() {
  const warn = vi.fn<(message: string) => void>()
  return { warn, reg: createPluginRegistry(warn) }
}

describe('describe：件报自己叫什么', () => {
  it('进表的那条带着 entryId 与 pkg', () => {
    const { reg } = fresh()
    reg.describe(echo, { title: '回声', icon: 'megaphone' })
    expect(reg.list()).toEqual([
      { title: '回声', icon: 'megaphone', entryId: 'echo', pkg: '@godcreator02/gwb-echo' },
    ])
  })

  it('icon 可以不给', () => {
    const { reg } = fresh()
    reg.describe(echo, { title: '回声' })
    expect(reg.list()[0]).not.toHaveProperty('icon')
  })

  it('按报名先后排', () => {
    const { reg } = fresh()
    reg.describe(echo2, { title: '二号' })
    reg.describe(echo, { title: '一号' })
    expect(reg.list().map((p) => p.title)).toEqual(['二号', '一号'])
  })
})

describe('键是条目不是包', () => {
  it('同一个包的两条条目各占一行——它们是两份独立配置', () => {
    const { reg, warn } = fresh()
    reg.describe(echo, { title: '一号' })
    reg.describe(echo2, { title: '二号' })
    expect(reg.list().map((p) => [p.entryId, p.title])).toEqual([
      ['echo', '一号'],
      ['echo-2', '二号'],
    ])
    expect(warn).not.toHaveBeenCalled()
  })

  it('同一条条目报两次：后来者赢，但要说出来', () => {
    const { reg, warn } = fresh()
    reg.describe(echo, { title: '旧的' })
    reg.describe(echo, { title: '新的' })
    expect(reg.list()).toHaveLength(1)
    expect(reg.list()[0]!.title).toBe('新的')
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]![0]).toContain('echo')
  })
})

describe('注销：只收自己那份', () => {
  it('摘掉一条别的不动；摘两遍不炸', () => {
    const { reg } = fresh()
    const off = reg.describe(echo, { title: '一号' })
    reg.describe(echo2, { title: '二号' })
    off()
    off()
    expect(reg.list().map((p) => p.entryId)).toEqual(['echo-2'])
  })

  it('被后来者顶掉之后再摘，摘的不是新那条', () => {
    const { reg } = fresh()
    const off = reg.describe(echo, { title: '旧的' })
    reg.describe(echo, { title: '新的' })
    // 件重挂时正是这个顺序：新的先进表，旧的 effect 后收尾
    off()
    expect(reg.list()[0]!.title).toBe('新的')
  })
})

describe('空标题抛——不静默进表', () => {
  it('话里带着包名', () => {
    const { reg } = fresh()
    expect(() => reg.describe(echo, { title: '' })).toThrow(/gwb-echo/)
    expect(reg.list()).toEqual([])
  })
})

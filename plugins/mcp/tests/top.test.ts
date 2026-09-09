import { describe, expect, it } from 'vitest'
import { selectTop } from '../src/top.js'

/** 一条登记表里的命令，只带这儿用得着的两样 */
function cmd(name: string, top: boolean): { name: string; top: boolean } {
  return { name, top }
}

describe('selectTop', () => {
  it('只挑登记时标了 top 的,顺序照登记', () => {
    const picked = selectTop([cmd('skill.list', true), cmd('plugins.list', false), cmd('skill.read', true)])
    expect(picked.map((c) => c.name)).toEqual(['skill.list', 'skill.read'])
  })

  it('一条都没标就一条都不渲染——固定两枚之外没有默认门牌', () => {
    expect(selectTop([cmd('a', false), cmd('b', false)])).toEqual([])
    expect(selectTop([])).toEqual([])
  })

  it('原样交回登记表里那条,不改形状', () => {
    const rich = { name: 'x', top: true, description: '形状', plugin: 'p' }
    expect(selectTop([rich])[0]).toBe(rich)
  })
})

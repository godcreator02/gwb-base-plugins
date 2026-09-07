import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CATALOG } from '../src/catalog'

/**
 * 清单是**白名单**，这组测试守的就是白名单那条性质。
 *
 * 本机 registry 上正线与一整条废弃线并存，名字还特别像（`gwb-api` 对 `gwb-plugin-api`、
 * `gwb-cli` 对 `gwb-commands`）。清单里混进一条废弃的，用户第一件事就是装错——
 * 而那种错在界面上看不出任何异常，得等它挂不上才发现。
 */

/** 废弃那条线上的包名（本机 registry 上真实存在，且长得像正线） */
const RETIRED = [
  '@godcreator02/gwb-api',
  '@godcreator02/gwb-cli',
  '@godcreator02/gwb-build',
  '@godcreator02/gwb-home',
  '@godcreator02/cli',
  '@godcreator02/config',
  '@godcreator02/devkit',
  '@godcreator02/echo',
  '@godcreator02/example',
  '@godcreator02/shell',
  '@godcreator02/logger',
  '@godcreator02/settings',
]

describe('自带的清单', () => {
  it('11 条，正线件仓现在在跑的全部', () => {
    expect(CATALOG).toHaveLength(11)
  })

  it('**一条废弃线上的包都不许有**——名字像正线，装错了当场是一整条废弃线', () => {
    expect(CATALOG.map((i) => i.pkg).filter((pkg) => RETIRED.includes(pkg))).toEqual([])
  })

  it('全在 @godcreator02 scope 下、全带 gwb- 前缀（前缀正是跟废弃那批错开用的）', () => {
    for (const item of CATALOG) expect(item.pkg).toMatch(/^@godcreator02\/gwb-[a-z0-9-]+$/)
  })

  it('包名不重', () => {
    expect(new Set(CATALOG.map((i) => i.pkg)).size).toBe(CATALOG.length)
  })

  it('每条都有短名和一句 why——摆一行没话说的包等于没摆', () => {
    for (const item of CATALOG) {
      expect(item.title.trim()).not.toBe('')
      expect(item.why.trim()).not.toBe('')
    }
  })

  it('**一条只有三样**：没有 spec（不钉版本，装最新的）、没有分类、没有图标', () => {
    for (const item of CATALOG) expect(Object.keys(item).sort()).toEqual(['pkg', 'title', 'why'])
  })
})

describe('这一格不联网', () => {
  const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')

  /**
   * 源码里出现任何一个就是把第一版砍掉的那条 registry 查询加回来了。
   *
   * 只钉这三个**代码构造**、不钉 `/-/v1/search` 这种字面地址：那个地址正大光明地写在
   * `catalog.ts` 的头注里（记着「查过、能用、砍了」），钉它会把那段说明也判成违规。
   */
  const NETWORK = ['fetch(', 'XMLHttpRequest', 'WebSocket']

  function walk(dir: string): string[] {
    const out: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...walk(full))
      else if (/\.tsx?$/.test(entry.name)) out.push(full)
    }
    return out
  }

  it('**源码里一条网络请求都没有**——第一版不查 registry，那是砍掉的，别加回来', () => {
    const hits: string[] = []
    for (const file of walk(srcDir)) {
      const text = fs.readFileSync(file, 'utf8')
      for (const needle of NETWORK) if (text.includes(needle)) hits.push(`${path.basename(file)}: ${needle}`)
    }
    expect(hits).toEqual([])
  })
})

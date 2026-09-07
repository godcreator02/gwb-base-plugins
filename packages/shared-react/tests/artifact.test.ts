import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 产物验收：四份束在位，且**自包含性**成立——react 本体零裸名 import、react-dom 系以裸名
 * 依赖 react、谁都不许留 require 探针。这三条错了都是静默的：页面上要到打开窗格才看得见。
 *
 * **产物不在就整组跳过**：门禁吃的是源码，而 lib/ 是 gitignore 的，新克隆的仓里压根没有。
 * 硬红的话「跑一遍门禁」就等于「先跑一遍构建」。跳过时打一句，别让人以为它悄悄过了。
 */

const libDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib')
const BUNDLES = ['react.js', 'react-jsx-runtime.js', 'react-dom.js', 'react-dom-client.js']
const built = BUNDLES.every((f) => fs.existsSync(path.join(libDir, f)))

if (!built) console.warn('[shared-react] lib/ 还没造出来，产物组跳过（pnpm build 之后再跑）')

const read = (name: string): string => fs.readFileSync(path.join(libDir, name), 'utf8')
/** 束里的裸名依赖：产物是 esm，只会有 `from "x"` 这一种形态 */
const imports = (code: string): string[] => [
  ...new Set([...code.matchAll(/from\s*"([^"]+)"/g)].map((m) => m[1]!)),
]

describe.skipIf(!built)('shared-react 产物', () => {
  it('四份束都在', () => {
    for (const f of BUNDLES) expect(fs.existsSync(path.join(libDir, f))).toBe(true)
  })

  it('react 本体自包含——有裸名 import 就会绕出第二个实例', () => {
    expect(imports(read('react.js'))).toEqual([])
    expect(imports(read('react-jsx-runtime.js'))).toEqual([])
  })

  it('react-dom 系以裸名依赖 react,由 importmap 钉到同一份', () => {
    expect(imports(read('react-dom.js'))).toEqual(['react'])
    expect(imports(read('react-dom-client.js'))).toEqual(['react'])
  })

  it('没有 require 残留——浏览器里没有 require,留一处就是一处炸点', () => {
    for (const f of BUNDLES) {
      const code = read(f)
      // esbuild 那个未修补的探针长这样；修补过的换成了只认 react 的解析器
      expect(code, `${f} 有未修补的 require 探针`).not.toContain('typeof require')
      expect(code.match(/(?<![\w.$])require\(/), `${f} 有裸 require 调用`).toBeNull()
    }
  })

  it('构建期把 NODE_ENV 定死,产物里不留 process.env', () => {
    for (const f of BUNDLES) expect(read(f), `${f} 残留 process.env`).not.toContain('process.env')
  })
})

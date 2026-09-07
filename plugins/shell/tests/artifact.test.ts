import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 产物守卫。这个件有两半，两半的规矩不一样：
 *
 * - **node 半**（`dist/*.js`，tsc 出的）：相对 import 带扩展名、除 cordis 外不许有裸名
 * - **浏览器半**（`dist/client.js`，esbuild 打的）：**只许**那四个共享名漏出去——它们由
 *   页面 importmap 解析到共享包。多漏一个（比如 dockview 被误配成 external）就是运行期
 *   一句 `Failed to resolve module specifier`，而那要开到窗格才看得见
 *
 * 缺产物时整组跳过——门禁不依赖 build。
 */

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const built = fs.existsSync(distDir)

/** 页面 importmap 提供的那四个，跟 build.ts 的 SHARED 一一对应 */
const SHARED = new Set(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'])

const CLIENT = 'client.js'

function read(file: string): string {
  return fs.readFileSync(path.join(distDir, file), 'utf8')
}

/** 剥掉 css 注释。查规则的时候得先把讲这条规则的那段文案拿掉 */
function stripComments(css: string): string {
  return css.replaceAll(/\/\*[\s\S]*?\*\//g, '')
}

function specsIn(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((m) => m[1] ?? m[2]!)
}

/**
 * **锚在行首**（`^` + `m`），不满文件乱找。第一版没锚，当场被 dockview 自己的一句
 * 错误消息骗了：它的文案里嵌着一段示例代码 `  import 'dockview-enterprise';`，
 * 于是守卫报「企业包泄漏进束里了」——而束其实是干净的。
 *
 * 认的是**产物的形状**：tsc 与 esbuild 都把顶层 import 顶格写，字符串字面量里的那种
 * 总带着缩进。这跟 shared-react 那条补丁正则同属一类，是个明摆着的脆弱点——但比
 * 「满文件找 import 三个字母」可靠得多。
 */
const RELATIVE = /^import\s+(?:[^'"]*from\s*)?['"](\.[^'"]*)['"]/gm
const BARE = /^import\s+(?:[^'"]*from\s*)?['"]([^'".][^'"]*)['"]/gm

describe.skipIf(!built)('产物', () => {
  const all = built ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js')) : []
  const nodeHalf = all.filter((f) => f !== CLIENT)

  it('两半都有产物可查', () => {
    expect(nodeHalf.length).toBeGreaterThan(0)
    expect(all).toContain(CLIENT)
  })

  it('node 半：相对 import 一律带扩展名', () => {
    const bad: string[] = []
    for (const file of nodeHalf) {
      for (const spec of specsIn(read(file), RELATIVE)) {
        if (!spec.endsWith('.js')) bad.push(`${file}: ${spec}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('node 半：裸名只许 cordis——Service 基类必须是宿主那一份', () => {
    const bare: string[] = []
    for (const file of nodeHalf) {
      for (const spec of specsIn(read(file), BARE)) {
        if (!spec.startsWith('node:') && spec !== 'cordis') bare.push(`${file}: ${spec}`)
      }
    }
    expect(bare).toEqual([])
  })

  it('浏览器半：裸名只许那四个共享的，dockview 得打进本束', () => {
    const leaked = specsIn(read(CLIENT), BARE).filter((s) => !SHARED.has(s))
    expect(leaked).toEqual([])
  })

  it('浏览器半：dockview 真的在束里（外置了的话这条会空）', () => {
    expect(read(CLIENT)).toContain('dv-groupview')
  })

  it('两张样式表都出得来，各自的 scope 规矩不同', () => {
    const scoped = fs.readFileSync(path.join(distDir, 'style.css'), 'utf8')
    const dockview = fs.readFileSync(path.join(distDir, 'dockview.css'), 'utf8')
    // 外壳自己那张整张包在 scope 之下
    expect(scoped).toContain(':where([data-gwb-plugin="@godcreator02/gwb-shell"])')
    // dockview 那张**一条 scope 规则都不许有**：门户元素挂在 body 下，包进去就没样式。
    // 先剥注释——两张表的头注里都在讲这件事，不剥的话查的是文案不是规则
    expect(stripComments(dockview)).not.toContain('data-gwb-plugin')
    expect(dockview).toContain('.dockview-theme-gwb')
  })

  /**
   * 裁表那步是**每次构建都在跑的代码**，写坏了的症状分两头：裁多了是某个交互没样式，
   * 裁少了是他们的主题偷偷生效、把我们的值盖掉。两头都不报错，所以钉住。
   */
  it('dockview 自带的主题一个都不许剩，除了我们自己那个', () => {
    const css = stripComments(fs.readFileSync(path.join(distDir, 'dockview.css'), 'utf8'))
    const theirs = [...css.matchAll(/\.dockview-[a-z0-9-]+/g)]
      .map((m) => m[0])
      .filter((c) => c !== '.dockview-theme-gwb')
    expect([...new Set(theirs)]).toEqual([])
  })

  it('裁完之后基础规则还在——别把井本身也裁没了', () => {
    const css = fs.readFileSync(path.join(distDir, 'dockview.css'), 'utf8')
    // 这几个类是井的骨架，全由 dockview 的 JS 建，规则少一条就是一处没样式
    for (const cls of ['.dv-groupview', '.dv-tabs-and-actions-container', '.dv-tab', '.dv-sash', '.dv-drop-target']) {
      expect(css).toContain(cls)
    }
    // 裁掉的是三分之二那批主题，剩下的应该在 50–70KB 这一档；掉出去说明裁法出事了
    const bytes = Buffer.byteLength(css, 'utf8')
    expect(bytes).toBeGreaterThan(45_000)
    expect(bytes).toBeLessThan(75_000)
  })
})

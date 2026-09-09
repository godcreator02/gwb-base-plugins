import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '@tailwindcss/node'
import { describe, expect, it } from 'vitest'

/**
 * **忘加前缀的守卫。**
 *
 * 这个件的样式围栏是「类名自带 `plugins:` 前缀」（见 `src/client/styles.css`）。围栏的代价
 * 是**漏加前缀完全静默**：`flex` 写成这样，Tailwind 在带前缀的编译下一个字节都不出，
 * 页面上就是那一处没样式——不报错、不告警、构建照样绿。选择器 scope 那套方案下漏写
 * 类名是编得出来的，这类错原先不存在，是换方案换出来的新坑，所以得有一条守卫钉住。
 *
 * 判法：把 `src/client` 下所有 tsx 里的字符串字面量抽出来，按空白切成 token；对每个
 * **不以 `plugins:` 开头**的 token，拿件自己那份 `styles.css`（**去掉 `prefix(plugins)`**）
 * 当输入，问 Tailwind「这个 token 编得出规则吗」。编得出来的，就是本该带前缀而没带的类。
 *
 * 为什么要去掉前缀再编：带前缀的编译器对 `flex` 只会回「不认识」，跟对 `zh-CN` 的回答
 * 一模一样，分不出漏没漏。去掉前缀之后，「编得出来」这件事本身就等价于「它是个类名」。
 *
 * **这个件字符串多得反常**——命令名（`plugins.list` 这一串）、包名、条目态、筛选档、
 * 组件的变体名全是字面量。绝大多数自然编不出规则，不用特判；真编得出来的只有下面那一个。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.resolve(here, '../src/client')

/** 模板串里的插值段——静态段之外的部分，不是字面量文本 */
const INTERPOLATION = /\$\{[^{}]*\}/g

/**
 * **唯一的排除**：`outline` 出现在 `variant="outline"` 上（`Button` / `Badge` 的变体名，
 * 也是 `STATE_BADGE` 里那个联合类型的成员），不是类名。它恰好也是个 Tailwind 工具类
 * （`outline-style: solid`），所以会被误报。
 * 排掉整个 token 的代价是「真把 `outline` 单独写成类名」这一种漏报——而实际写法里
 * 用到的是 `outline-none` / `outline-hidden`，光秃秃一个 `outline` 不会出现。
 *
 * 别的字面量都编不出规则，一个都不用排：命令名（`plugins.install`）与包名
 * （`@godcreator02/gwb-plugins`）带点带斜杠、`installed` / `market` / `secret` /
 * `disabled-running` 这些态名与 `all` / `on` / `off` / `bad` 这些筛选档都不是工具类，
 * 编不出东西来。**没编出规则的 token 本来就不该进排除表**——排除表越短，漏报面越小。
 */
const NOT_A_CLASS = new Set(['outline'])

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...tsxFiles(full))
    else if (e.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * 一份源码里所有字符串字面量的**内容**（引号剥掉、模板串的插值段挖掉）。
 *
 * **必须认得注释**，不能只拿正则去捞引号：这些文件的头注里全是 `` `@container` ``
 * 这种反引号代码段，一对反引号在正则眼里就是一个模板串，注释里随便一个工具类名
 * 都会被当成漏加前缀的类报出来。所以这儿走一遍最小的状态机：行注释、块注释、
 * 单双引号、反引号各是一个状态，只有在字符串状态里收字符。
 */
function literals(source: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < source.length) {
    const c = source[i]!
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
    } else if (c === "'" || c === '"' || c === '`') {
      const quote = c
      let text = ''
      i++
      while (i < source.length && source[i] !== quote) {
        // 转义序列整体吃掉，免得反斜杠把结束引号也吞进来
        if (source[i] === '\\') text += source[i++] ?? ''
        text += source[i++] ?? ''
      }
      i++
      out.push(quote === '`' ? text.replaceAll(INTERPOLATION, ' ') : text)
    } else {
      i++
    }
  }
  return out
}

describe('忘加前缀的守卫', () => {
  const files = tsxFiles(clientDir)

  it('src/client 下确实有 tsx——扫空了的话这条守卫等于没跑', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('字符串字面量里没有漏掉 plugins: 前缀的类名', async () => {
    const input = fs.readFileSync(path.join(clientDir, 'styles.css'), 'utf8').replace(' prefix(plugins)', '')
    // 那一行真的摘干净了才算数。头注里也提到 prefix(plugins)，所以先把注释剥掉再看
    expect(input.replaceAll(/\/\*[\s\S]*?\*\//g, '')).not.toContain('prefix(')

    const compiler = await compile(input, { base: clientDir, onDependency: () => {} })

    const tokens = new Set<string>()
    for (const file of files) {
      for (const literal of literals(fs.readFileSync(file, 'utf8'))) {
        for (const token of literal.split(/\s+/)) {
          if (token === '' || token.startsWith('plugins:') || NOT_A_CLASS.has(token)) continue
          tokens.add(token)
        }
      }
    }

    // `build` 是**增量**的：候选一旦交给它就留在里面，下一次调用回的是「至今所有候选」
    // 的产物。所以判据不是「跟空基线比」（那样第一个真类名之后每个 token 都会被判成有
    // 规则），而是**逐个喂进去看这一步有没有把产物撑大**——撑大了才说明这个 token 自己
    // 编出了东西。
    const missing: string[] = []
    let previous = compiler.build([])
    for (const token of tokens) {
      const next = compiler.build([token])
      if (next === previous) continue
      missing.push(token)
      previous = next
    }
    expect(missing.sort()).toEqual([])
  })
})

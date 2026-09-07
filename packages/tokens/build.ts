import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/**
 * 令牌包的产物：一张页面直接吃的 css。
 * **不跑 Tailwind 编译**——这张表里没有一个工具类，只有 preflight、令牌值与两条 base 规则。
 * 工具类归各个件自己在构建期编（它们引的是映射面 theme.reference.css）。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, 'dist')
const require = createRequire(import.meta.url)

/**
 * 层顺序由这张表声明，而且它得**第一个**加载：件的表只写 `@layer utilities { … }`、
 * 自己不声明顺序。而 CSS 里**未分层的规则优先级高于所有分层规则**——preflight
 * 不包进 base 层的话，它会盖掉件表里的工具类。
 */
const LAYERS = '@layer theme, base, components, utilities;'

const preflight = fs.readFileSync(require.resolve('tailwindcss/preflight.css'), 'utf8')
const tokens = fs.readFileSync(path.join(here, 'src', 'tokens.css'), 'utf8')

fs.mkdirSync(outDir, { recursive: true })

fs.writeFileSync(
  path.join(outDir, 'theme.css'),
  `${LAYERS}\n\n@layer base {\n${preflight}\n}\n\n${tokens}`,
  'utf8',
)

// 映射面原样发出去：件的构建期引的就是这个形态
fs.copyFileSync(path.join(here, 'src', 'theme.reference.css'), path.join(outDir, 'theme.reference.css'))

console.log('[tokens] dist/theme.css ← preflight + tokens.css')
console.log('[tokens] dist/theme.reference.css ← 原样拷')

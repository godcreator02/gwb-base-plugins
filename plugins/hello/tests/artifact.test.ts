import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 产物守卫 + 那两条 CLI 的形状守卫。缺产物时产物那组整组跳过——门禁不依赖 build。
 *
 * 这个件有**两半**：node 半走 tsc（`index.js` 与 `cli.js`），浏览器半走 esbuild
 * （`client.js`，里头打进了 radix/cva 一堆东西）。两半的规矩不一样，所以照
 * `plugins/shell` 那份分开查：**node 半 = 所有 .js 减掉 client.js**。
 *
 * 后半段守的是「三处一改就得一起改」那类账：`py/pyproject.toml` 的名字版本入口点，
 * 跟 `src/index.ts` 里登记的那条对不上时，症状是「venv 建好了但守卫说版本不对」。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(here, '../dist')
const built = fs.existsSync(distDir)

if (!built) console.warn('[gwb-hello] dist/ 还没造出来,产物组跳过（pnpm build 之后再跑）')

const CLIENT = 'client.js'
/** node 半运行时真 import 的。契约包与那几个件都是 `import type`,整句擦除,不该出现 */
const ALLOWED_BARE = new Set(['@godcreator02/gwb-plugin-api'])
/** 正则锚行首:字符串字面量里的 import 总带着缩进,顶格的才是真的顶层 import */
const RELATIVE = /^import\s+(?:[^'"]*from\s*)?['"](\.[^'"]*)['"]/gm
const BARE = /^import\s+(?:[^'"]*from\s*)?['"]([^'".][^'"]*)['"]/gm

describe.skipIf(!built)('产物', () => {
  const all = built ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js')) : []
  const nodeHalf = all.filter((f) => f !== CLIENT)

  it('两半都在——node 半的 index.js 与 cli.js,浏览器半的 client.js', () => {
    expect(nodeHalf.sort()).toEqual(['cli.js', 'index.js'])
    expect(all).toContain(CLIENT)
  })

  it('node 半:相对 import 一律带扩展名——产物给 node 直接加载,ESM 不做补全', () => {
    const bad: string[] = []
    for (const file of nodeHalf) {
      const text = fs.readFileSync(path.join(distDir, file), 'utf8')
      for (const m of text.matchAll(RELATIVE)) {
        if (!m[1]!.endsWith('.js')) bad.push(`${file}: ${m[1]!}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('node 半:裸名只有钉死的那些', () => {
    const bare = new Set<string>()
    for (const file of nodeHalf) {
      const text = fs.readFileSync(path.join(distDir, file), 'utf8')
      for (const m of text.matchAll(BARE)) {
        const spec = m[1]!
        if (!spec.startsWith('node:')) bare.add(spec)
      }
    }
    expect([...bare].filter((s) => !ALLOWED_BARE.has(s))).toEqual([])
  })

  it('cli.js 是自包含的——它要被当成一个独立进程跑,除 node: 内置外一个依赖都不许有', () => {
    const text = fs.readFileSync(path.join(distDir, 'cli.js'), 'utf8')
    const bare = [...text.matchAll(BARE)].map((m) => m[1]!).filter((s) => !s.startsWith('node:'))
    expect(bare).toEqual([])
  })
})

describe('那两条 CLI 的形状', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8')) as {
    files?: string[]
    peerDependencies?: Record<string, string>
    peerDependenciesMeta?: Record<string, { optional?: boolean }>
  }
  const index = fs.readFileSync(path.resolve(here, '../src/index.ts'), 'utf8')

  it('node CLI 吃的是编译产物,不是源', () => {
    // 登记的必须是 dist/ 里那个 js。指到 src/ 上的话装出去根本跑不起来——
    // 发布的包里虽然带着 src,但那是 TS,node 直接加载不了
    expect(index).toMatch(/path\.join\(PACKAGE_ROOT, 'dist', 'cli\.js'\)/)
    expect(fs.existsSync(path.resolve(here, '../src/cli.ts'))).toBe(true)
  })

  it('cli.ts 进了 node 半的 tsconfig——不进的话 tsc 一声不吭地不编译它', () => {
    const tsconfig = fs.readFileSync(path.resolve(here, '../tsconfig.json'), 'utf8')
    expect(tsconfig).toContain('src/cli.ts')
  })

  it('python 项目发得出去,而 __pycache__ 排在包外', () => {
    expect(manifest.files).toContain('py')
    // 开发工位上跑过一次那个 py 项目就有了 __pycache__,而 files 收的是整个 py/。
    // 漏出去的是别人机器上的字节码,带着绝对路径与 python 版本号。见文档站
    expect(manifest.files).toContain('!py/**/__pycache__')
    expect(manifest.files).not.toContain('py/.venv')
  })

  it('pyproject 与锁文件都在——守卫跑的是 uv sync --frozen,少了锁文件当场失败', () => {
    expect(fs.existsSync(path.resolve(here, '../py/pyproject.toml'))).toBe(true)
    expect(fs.existsSync(path.resolve(here, '../py/uv.lock'))).toBe(true)
  })

  it('pyproject 的名字、版本、入口点跟 src/index.ts 里登记的那条对得上', () => {
    const toml = fs.readFileSync(path.resolve(here, '../py/pyproject.toml'), 'utf8')
    // 三处一改就得一起改,对不上时症状是「venv 建好了但守卫说版本不对」
    for (const literal of ['gwb-hello-py', '0.0.1']) {
      expect(toml).toContain(literal)
      expect(index).toContain(literal)
    }
    expect(toml).toMatch(/^\[project\.scripts\]\s*\ngwb-hello-py\s*=/m)
  })

  it('venv 不进 git——它是装到 node_modules 之后现建的', () => {
    const ignore = fs.readFileSync(path.resolve(here, '../../../.gitignore'), 'utf8')
    expect(ignore).toMatch(/^\.venv\/$/m)
  })

  it('两个运行器是可选 peer——缺了它们本件照常画窗格,只是那几颗按钮不可用', () => {
    for (const pkg of ['@godcreator02/gwb-node-cli', '@godcreator02/gwb-py-cli']) {
      expect(manifest.peerDependencies?.[pkg]).toBeDefined()
      expect(manifest.peerDependenciesMeta?.[pkg]?.optional).toBe(true)
    }
    // 配套的另一半:注册那段必须在 ctx.inject 的回调里,不能进 export const inject。
    // cordis 的 inject 全是硬依赖,「可选」靠的就是这一句开出来的子 fiber
    expect(index).toMatch(/ctx\.inject\(\['gwbNodeCli', 'gwbPyCli'\]/)
    expect(index).toMatch(/export const inject = \['gwbData', 'gwbShell', 'gwbCommands'\]/)
  })
})

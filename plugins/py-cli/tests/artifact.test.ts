import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 产物守卫：相对 import 必须带扩展名；裸名只许 `cordis` 一个。
 * 缺产物时整组跳过——门禁不依赖 build。
 *
 * 为什么偏偏 `cordis` 得留：`Service` 基类必须是**宿主跑的那一份**,两份 cordis 的
 * instanceof 对不上。契约包与 cli 件都是 `import type`,整句擦除,不该出现在产物里。
 *
 * 后半段守的是另一件事：**那个 python 项目得跟着包发出去**。少了它,守卫无从建 venv,
 * 而症状是装上之后自检命令报「venv 没就绪」——离真正的原因（包里没有 pyproject）很远。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(here, '../dist')
const built = fs.existsSync(distDir)

if (!built) console.warn('[gwb-py-cli] dist/ 还没造出来,产物组跳过（pnpm build 之后再跑）')

const ALLOWED_BARE = new Set(['cordis'])

describe.skipIf(!built)('产物', () => {
  const files = built ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js')) : []

  it('有产物可查', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('相对 import 一律带扩展名——产物给 node 直接加载,ESM 不做补全', () => {
    const bad: string[] = []
    for (const file of files) {
      const text = fs.readFileSync(path.join(distDir, file), 'utf8')
      for (const m of text.matchAll(/(?:from|import)\s*['"](\.[^'"]*)['"]/g)) {
        if (!m[1]!.endsWith('.js')) bad.push(`${file}: ${m[1]!}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('裸名只有钉死的那一个', () => {
    const bare = new Set<string>()
    for (const file of files) {
      const text = fs.readFileSync(path.join(distDir, file), 'utf8')
      for (const m of text.matchAll(/(?:from|import)\s*['"]([^'".][^'"]*)['"]/g)) {
        const spec = m[1]!
        if (!spec.startsWith('node:')) bare.add(spec)
      }
    }
    expect([...bare].filter((s) => !ALLOWED_BARE.has(s))).toEqual([])
  })
})

describe('自检靶子那个 python 项目', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8')) as {
    files?: string[]
  }

  it('发得出去——包清单的 files 带着 py', () => {
    expect(manifest.files).toContain('py')
  })

  it('pyproject 与锁文件都在——守卫跑的是 uv sync --frozen,少了锁文件当场失败', () => {
    expect(fs.existsSync(path.resolve(here, '../py/pyproject.toml'))).toBe(true)
    expect(fs.existsSync(path.resolve(here, '../py/uv.lock'))).toBe(true)
  })

  it('pyproject 里的名字、版本、入口点跟 src 里登记的那条对得上', () => {
    const toml = fs.readFileSync(path.resolve(here, '../py/pyproject.toml'), 'utf8')
    const index = fs.readFileSync(path.resolve(here, '../src/index.ts'), 'utf8')
    // 三处一改就得一起改,对不上时症状是「venv 建好了但守卫说版本不对」
    for (const literal of ['gwb-pycli-selftest', '0.0.1']) {
      expect(toml).toContain(literal)
      expect(index).toContain(literal)
    }
    expect(toml).toMatch(/^\[project\.scripts\]\s*\ngwb-pycli-selftest\s*=/m)
  })

  it('venv 不进包——它是装到 node_modules 之后现建的', () => {
    expect(manifest.files).not.toContain('py/.venv')
    const ignore = fs.readFileSync(path.resolve(here, '../../../.gitignore'), 'utf8')
    expect(ignore).toMatch(/^\.venv\/$/m)
  })

  it('__pycache__ 排在包外——第一版就是这么漏出去的', () => {
    // 开发工位上跑过一次那个 py 项目就有了 __pycache__,而 files 收的是整个 py/。
    // 漏出去的是别人机器上的字节码,带着绝对路径与 python 版本号
    expect(manifest.files).toContain('!py/**/__pycache__')
  })
})

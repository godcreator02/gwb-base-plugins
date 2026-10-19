import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { API } from 'typescript/unstable/sync'
import { createVirtualFileSystem } from 'typescript/unstable/fs'
import { isCallExpression, isExportDeclaration, isImportDeclaration, isStringLiteralLikeNode, SyntaxKind, type Node } from 'typescript/unstable/ast'

/**
 * 构建产物的检查：相对 import 带扩展名；包名 import 除 node 内置模块外只有 `cordis`。
 * `cordis` 必须留：`Service` 基类要用宿主运行的那一份（两份 cordis 的 instanceof 对不上）。
 * 内核包、`@godcreator/gwb-commands`、`@godcreator/gwb-skills` 都只 import 类型，`verbatimModuleSyntax` 会把那几句整个删掉；
 * 它们出现在产物里，说明有人写成了按值 import。线程入口 thread.js 按插件给的地址动态 import，只有它可以有非静态的动态 import。
 * 没构建时整组跳过，这组检查不依赖构建。
 */

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const built = fs.existsSync(distDir)

if (!built) console.warn('[gwb-workers] dist/ 还没构建，构建产物这组检查跳过（pnpm build 之后再运行）')

/** 运行时按值 import 的那一个，不该多 */
const ALLOWED_BARE = new Set(['cordis'])

/** 模块名是表达式、不是字面量的动态 import 记成这一项 */
const NON_STATIC_IMPORT = '(非静态的动态 import)'
const FILES_WITH_NON_STATIC_IMPORT = new Set(['thread.js'])

/** TypeScript 7 的解析器在独立进程里，通过虚拟文件系统解析；不执行构建产物，也不往磁盘写 fixture。 */
function moduleSpecifiers(sources: Record<string, string>): Record<string, string[]> {
  const virtualDir = path.resolve(distDir, '../artifact-check').replaceAll('\\', '/')
  const config = `${virtualDir}/tsconfig.json`
  const sourcePaths = Object.fromEntries(Object.entries(sources).map(([file, text]) => [`${virtualDir}/${file}`, text]))
  const api = new API({
    cwd: path.dirname(distDir),
    fs: createVirtualFileSystem({
      ...sourcePaths,
      [config]: JSON.stringify({ compilerOptions: { allowJs: true, noLib: true, noResolve: true }, files: Object.keys(sources) }),
    }),
  })
  try {
    const snapshot = api.updateSnapshot({ openProjects: [config] })
    const project = snapshot.getProject(config)
    if (project === undefined) throw new Error('构建产物检查无法创建语法解析项目')
    return Object.fromEntries(Object.keys(sources).map((file) => {
      const source = project.program.getSourceFile(`${virtualDir}/${file}`)
      if (source === undefined) throw new Error(`构建产物检查无法解析 ${file}`)
      const specifiers: string[] = []
      const visit = (node: Node): void => {
        const dynamicImport = isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword
        const specifier = isImportDeclaration(node) || isExportDeclaration(node)
          ? node.moduleSpecifier
          : dynamicImport ? node.arguments[0] : undefined
        if (specifier !== undefined && isStringLiteralLikeNode(specifier)) specifiers.push(specifier.text)
        else if (dynamicImport) specifiers.push(NON_STATIC_IMPORT)
        node.forEachChild(visit)
      }
      source.forEachChild(visit)
      return [file, specifiers]
    }))
  } finally {
    api.close()
  }
}

describe('构建产物依赖提取', () => {
  it('只认语法节点：包含副作用导入、重导出、动态导入，不认字符串、注释或字段', () => {
    const result = moduleSpecifiers({ 'fixture.js': [
      "import fs from 'node:fs'",
      "import './side-effect.js'",
      "export { value } from './value.js'",
      "export * from 'unexpected-package'",
      "const one = import('./lazy.js')",
      'const two = import(`another-package`)',
      'const usage = "参数 from \'not-a-package\'，import \'also-not-a-package\'"',
      "const fields = { from: 'not-an-import', import: 'ordinary-field' }",
      "// import 'comment-only'",
      "/* export * from 'block-comment-only' */",
      'const pattern = /import\\s*[\'"]regex-only[\'"]/',
      'const url = import.meta.url',
    ].join('\n') })
    expect(result['fixture.js']).toEqual(['node:fs', './side-effect.js', './value.js', 'unexpected-package', './lazy.js', 'another-package'])
  })

  it('动态拼出的模块名单独记一项，不静默漏掉', () => {
    expect(moduleSpecifiers({ 'fixture.js': 'const loaded = import(moduleName)' })['fixture.js']).toEqual([NON_STATIC_IMPORT])
  })
})

describe.skipIf(!built)('构建产物', () => {
  const files = built ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js')) : []
  const imports = built ? moduleSpecifiers(Object.fromEntries(files.map((file) => [file, fs.readFileSync(path.join(distDir, file), 'utf8')]))) : {}

  it('有构建产物可查', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('相对 import 一律带扩展名——构建产物由 node 直接加载，ESM 不补扩展名', () => {
    const bad: string[] = []
    for (const file of files) {
      for (const specifier of imports[file]!) {
        if (specifier.startsWith('.') && !specifier.endsWith('.js')) bad.push(`${file}: ${specifier}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('除了 node 内置模块与 cordis，一个包名 import 都没有', () => {
    const bare = new Set<string>()
    for (const file of files) {
      for (const specifier of imports[file]!) {
        if (specifier !== NON_STATIC_IMPORT && !specifier.startsWith('.') && !specifier.startsWith('node:')) bare.add(specifier)
      }
    }
    expect([...bare].filter((s) => !ALLOWED_BARE.has(s))).toEqual([])
  })

  it('只有线程入口有非静态的动态 import', () => {
    const withNonStatic = files.filter((file) => imports[file]!.includes(NON_STATIC_IMPORT))
    expect(withNonStatic.filter((file) => !FILES_WITH_NON_STATIC_IMPORT.has(file))).toEqual([])
    expect(withNonStatic).toContain('thread.js')
  })
})

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { registerSelfReportGuard } from '@godcreator/gwb-repo-kit'

/**
 * 检查 package.json 里的自我描述与文档一致。检查逻辑在 `@godcreator/gwb-repo-kit` 里，这里只登记一次：
 * 要改检查就升那个包，不要把逻辑复制过来；本仓特有的断言另写一个 describe。
 *
 * 文档站在仓根，这个文件在 plugins/<目录>/tests/，所以 docsDir 要显式传入——不传的话
 * 「inject 的服务名要在现状文档里出现」这一条什么也不检查，而且不报错。
 */
const here = path.dirname(fileURLToPath(import.meta.url))
registerSelfReportGuard(
  { describe, it, expect },
  { root: path.resolve(here, '..'), docsDir: path.resolve(here, '../../../docs-site/content/docs') },
)

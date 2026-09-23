import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { registerSelfReportGuard } from '@godcreator/gwb-repo-kit'

/**
 * 包清单描述不许和代码、文档对不上。检查逻辑在 @godcreator/gwb-repo-kit，这里只登记。
 * 文档站在仓根，所以 docsDir 显式指过去——指不到的话「inject 的服务名要写进现状区」那条会不检查就通过。
 */
const here = path.dirname(fileURLToPath(import.meta.url))
registerSelfReportGuard(
  { describe, it, expect },
  { root: path.resolve(here, '..'), docsDir: path.resolve(here, '../../../docs-site/content/docs') },
)

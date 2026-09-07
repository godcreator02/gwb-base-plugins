/**
 * 这个站怎么挂 livedoc：格式包、文档目录、产物摆放、组件名册。命令行和站读的是同一份。
 *
 * 项目根是站目录，钉的源码在仓根（../plugins/…）——引用里的路径相对项目根。
 * 这个站只钉件仓自己的代码；内核那边的规则与坑在内核仓的站上（跨单元钉不了）。
 *
 * outputs：仓根 README.md 是生成物，正本是 content/docs/readme.mdx。
 * 改 mdx 源，`pnpm livedoc render --target ai` 重摆，一起提交。
 */
import * as fumadocs from '@godcreator02/live-doc-format-fumadocs'

export default {
  formats: [fumadocs],
  docs: 'content/docs',
  out: 'out',
  outputs: {
    'content/docs/readme.mdx': ['../README.md'],
  },
  components: {
    ...fumadocs.defaultRoster,
  },
}

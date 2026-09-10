/**
 * 这个站怎么挂 docfirst：格式、文档目录、产物摆放、组件名册。命令行和站读的是同一份。
 *
 * 项目根是站目录，钉的源码在仓根（../plugins/…）——引用里的路径相对项目根。
 * 这个站只钉件仓自己的代码；内核那边的规则与坑在内核仓的站上（跨单元钉不了）。
 *
 * outputs：仓根 README.md 是生成物，正本是 content/docs/readme.mdx。
 * 改 mdx 源，`pnpm docfirst render` 重摆，一起提交。
 */
import * as fumadocs from '@godcreator02/docfirst-workflow/fumadocs'

export default {
  formats: [fumadocs],
  docs: 'content/docs',
  out: 'out',
  outputs: {
    'content/docs/readme.mdx': ['../README.md'],
  },
  components: {
    ...fumadocs.defaultRoster,
    /**
     * 讲机制时穿插的 html 动画（`<iframe src="/anim/…">`，文件住 public/）。机读版里
     * **什么都不剩**——一张图喂不进上下文，留个空壳只是噪音。配套的纪律因此是硬的：
     * **动画不能是任何一条信息的唯一载体**，同一件事正文必须用文字讲完、并且钉住它图解的
     * 那段代码，图只是那段文字的图解。
     */
    iframe: 'drop',
  },
}

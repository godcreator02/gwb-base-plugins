/**
 * 这个站怎么挂 docfirst：格式包、哪几区进 check、卡目录在哪、产物摆放、组件名册。
 * 命令行和站读的是同一份。
 *
 * 项目根是站目录，钉的源码在仓根（../plugins/…）——引用里的路径相对项目根。
 * 这个站只钉件仓自己的代码；内核那边的规则与坑在内核仓的站上（跨单元钉不了）。
 * 六区里只有 docs（现状）与 outputs（生成正本）进 check——只有这两区对代码说话；
 * 轨迹、交接、未来、反馈四区的草稿记号与卡天然不进门禁，卡不许钉活代码。
 *
 * outputs：仓根 README.md 与 AGENTS.md 都是生成物，正本是 content/outputs/readme.mdx
 * 与 agents.mdx。改 mdx 源，`pnpm docfirst render --target ai` 重摆，一起提交。
 */
import * as fumadocs from '@godcreator02/docfirst-workflow/fumadocs'

export default {
  formats: [fumadocs],
  docs: ['content/docs', 'content/outputs'],
  out: 'out',
  comparator: 'git',
  trajectory: 'content/trajectory',
  outputs: {
    'content/outputs/readme.mdx': ['../README.md'],
    'content/outputs/catalog-commands.mdx': ['../plugins/commands/catalog.md'],
    'content/outputs/catalog-data.mdx': ['../plugins/data/catalog.md'],
    'content/outputs/catalog-logger.mdx': ['../plugins/logger/catalog.md'],
    'content/outputs/catalog-skills.mdx': ['../plugins/skills/catalog.md'],
    'content/outputs/catalog-node-cli.mdx': ['../plugins/node-cli/catalog.md'],
    'content/outputs/catalog-py-cli.mdx': ['../plugins/py-cli/catalog.md'],
    'content/outputs/catalog-settings.mdx': ['../plugins/settings/catalog.md'],
    'content/outputs/catalog-plugin-manager.mdx': ['../plugins/plugin-manager/catalog.md'],
    'content/outputs/catalog-command-http.mdx': ['../plugins/command-http/catalog.md'],
    'content/outputs/agents.mdx': ['../AGENTS.md'],
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

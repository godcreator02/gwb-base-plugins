/**
 * 这个站的 docfirst 配置：用哪个格式包、哪几区进 check、轨迹卡目录在哪、生成物写到哪、组件名册是什么。
 * 命令行和站读的是同一份。
 *
 * 项目根是站目录，被引用的源码在仓根（../plugins/…）——引用里的路径相对项目根。
 * 这个站只引用本仓插件自己的代码；内核的规则与遇到过的问题写在内核仓的站上（跨单元目录引用不了）。
 * 六区里只有 docs（现状）与 outputs（生成正本）进 check——只有这两区的论断跟代码对应；
 * 轨迹、交接、未来、反馈四区里写的引用和轨迹卡都不进 check，轨迹卡不许引用现行代码。
 *
 * outputs：仓根 README.md / AGENTS.md / CLAUDE.md 是生成物，正本是 content/outputs/ 下对应的 mdx。
 * 改 mdx 源要在站目录运行 `pnpm exec docfirst render` 重新生成，两份一起提交。
 * CLAUDE.md 第一行固定是 `@AGENTS.md`，只给 Claude 的指令写在它后面。
 */
import * as fumadocs from '@godcreator/docfirst-workflow/fumadocs'

export default {
  formats: [fumadocs],
  docs: ['content/docs', 'content/outputs'],
  out: 'out',
  comparator: 'git',
  trajectory: 'content/trajectory',
  outputs: {
    'content/outputs/readme.mdx': ['../README.md'],
    'content/outputs/agents.mdx': ['../AGENTS.md'],
    'content/outputs/claude.mdx': ['../CLAUDE.md'],
  },
  components: {
    ...fumadocs.defaultRoster,
    /**
     * 讲机制时插在正文里的 html 动画（`<iframe src="/anim/…">`，文件存放在 public/）。机读版里
     * **整个删掉**——图放不进上下文，留个空标签只是噪音。所以有一条必须遵守的规矩：
     * **动画不能是任何一条信息的唯一载体**，同一件事正文必须用文字讲完、并且引用动画演示的
     * 那段代码，动画只是那段文字的图解。
     */
    iframe: 'drop',
    // 示意图：图本身 agent 看不见，生成 markdown 时只保留「[图] 标题」和子元素里的文字说明
    Diagram: (node, h) => [h.paragraph(`[图] ${h.attr(node, 'title') ?? h.attr(node, 'name') ?? ''}`), ...h.children()],
  },
}

/**
 * 这个站的 docfirst 配置：命令行 docfirst（check / confirm / render / trajectory）读它，项目根是站点目录。
 * 被引用的代码在仓根的 `plugins/…`，引用写 `../plugins/…`。这个站只引用本仓插件自己的代码；
 * 内核的规则与遇到过的问题写在内核仓的站上（跨单元目录引用不了）。
 *
 * content：内容根。下面的 future/ 是未来区、不进核对，其余目录都是现状区、都进 check。
 * 本站的现状区是 `content/docs/`：页面、生成正本，与 `content/docs/_shared/` 下的示意图组件
 * （组件源码也进核对，只是它们没钉记号）。
 *
 * outputs 把正本映射到生成物：仓根 README.md / AGENTS.md / CLAUDE.md 由 `content/docs/outputs/` 下的
 * 三份 mdx 生成。改正本后运行 `pnpm doc:render`，正本与生成物放进同一个提交，check 检查两者一致。
 * CLAUDE.md 第一行固定是 `@AGENTS.md`，只给 Claude 的指令写在它后面。
 *
 * fumadocsRoster 与 components：组件名册。fumadocsRoster 放进 fumadocs 自带组件的机读规则，
 * components 再加站里的：Term 是手写的术语标注，Diagram 是本站的示意图（组件在 `content/docs/_shared/`）。
 * trajectory：轨迹卡放在站点根下的 trajectory/，站点的卡集合（app/features/trajectory/mdx.ts）读同一个目录。
 * 术语表不在这里：它是站点根的 glossary.json，由站点的 source.config.ts 交给术语标注插件。
 */
export default {
  content: 'content',
  outputs: {
    'content/docs/outputs/readme.mdx': ['../README.md'],
    'content/docs/outputs/agents.mdx': ['../AGENTS.md'],
    'content/docs/outputs/claude.mdx': ['../CLAUDE.md'],
  },
  fumadocsRoster: true,
  components: {
    // 手写的术语标注：机读版里只留术语原词
    Term: 'children',
    // 示意图：图本身 agent 看不见，机读版只保留「[图] 标题」和子元素里的文字说明
    Diagram: (node, h) => [h.paragraph(`[图] ${h.attr(node, 'title') ?? h.attr(node, 'name') ?? ''}`), ...h.children()],
  },
  trajectory: 'trajectory',
}

/**
 * docfirst 配置：命令行和站读的是同一份。项目根是这个站目录，被引用的代码在仓根，引用写 `../plugins/…`。
 * 这个站只引用本仓插件自己的代码；内核的规则与遇到过的问题写在内核仓的站上（跨单元目录引用不了）。
 *
 * content 是各区的上一级目录。它下面只有两个名字是固定的：`trajectory/` 是轨迹卡目录（卡里不许钉码），
 * `future/` 是未来区（路线、在途方案 `future/spec/`、别的仓投来的反馈 `future/inbox/`）。
 * 其余目录都是现状区，全部进 check；本站的现状区是 `content/docs/`，外加 `src/components/` 下写了记号的源码。
 *
 * outputs 把正本映射到生成物：仓根 README.md / AGENTS.md / CLAUDE.md 由 `content/docs/outputs/` 下的
 * 三份 mdx 生成。改正本后运行 `pnpm doc:render`，正本与生成物放进同一个提交，check 检查两者一致。
 * CLAUDE.md 第一行固定是 `@AGENTS.md`，只给 Claude 的指令写在它后面。
 *
 * components 是组件名册：fumadocsRoster 给 fumadocs 自带文件树 Files / Folder / File 与 Note 的机读规则，
 * 站里自己的示意图 Diagram 追加在后面。
 */
import { fumadocsRoster } from '@godcreator/docfirst-workflow/fumadocs/roster'

export default {
  content: 'content',
  outputs: {
    'content/docs/outputs/readme.mdx': ['../README.md'],
    'content/docs/outputs/agents.mdx': ['../AGENTS.md'],
    'content/docs/outputs/claude.mdx': ['../CLAUDE.md'],
  },
  components: {
    ...fumadocsRoster,
    // 示意图：图本身 agent 看不见，机读版只保留「[图] 标题」和子元素里的文字说明
    Diagram: (node, h) => [h.paragraph(`[图] ${h.attr(node, 'title') ?? h.attr(node, 'name') ?? ''}`), ...h.children()],
  },
}

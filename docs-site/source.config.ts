/**
 * 站的内容集合，三个区各一个 defineDocs（自带 docs 与 meta，侧栏顺序由各目录的 meta.json 定）：
 *   docs        现状区，进 check；生成正本在 content/docs/outputs/ 下
 *   trajectory  轨迹卡，只增不改；frontmatter 由 cardSchema 认，正文里的关系边由 remarkTrajectoryLinks 标出
 *   future      未来区：路线、在途方案 future/spec/；别的仓投来的反馈是 GitHub 上本仓的 issue
 *
 * 集合级 mdxOptions 会去掉 fumadocs 的全部默认插件，所以写了 mdxOptions 的集合都经 applyMdxPreset 把默认插件加回来。
 * 只有现状区接 docfirst 的记号处理与 processed markdown：轨迹卡不许钉码，未来区的记号没有代码可核对。
 */
import { applyMdxPreset, defineConfig, defineDocs } from 'fumadocs-mdx/config'
import { cardSchema, docfirstMarkdownOptions, docfirstMdxOptions, remarkTrajectoryLinks } from '@godcreator/docfirst-workflow/fumadocs'

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    mdxOptions: applyMdxPreset(docfirstMdxOptions({ root: process.cwd() }) as never),
    postprocess: { includeProcessedMarkdown: docfirstMarkdownOptions() },
  },
})

export const trajectory = defineDocs({
  dir: 'content/trajectory',
  docs: {
    schema: cardSchema,
    mdxOptions: applyMdxPreset({
      remarkPlugins: (v) => [...v, [remarkTrajectoryLinks, { hrefBase: '/trajectory' }]],
    }),
  },
})

export const future = defineDocs({
  dir: 'content/future',
})

export default defineConfig()

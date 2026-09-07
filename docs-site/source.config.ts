/**
 * 站侧的接线都在这一个文件:mdxOptions 由格式包给（remark 链、meta 白名单),
 * docs 集合打开 processed markdown 好让命令行也按名字找得到（import 时带 ?collection=docs）。
 */
import { defineConfig, defineDocs } from 'fumadocs-mdx/config'
import { livedocMarkdownOptions, livedocMdxOptions } from '@godcreator02/live-doc-format-fumadocs'

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    postprocess: { includeProcessedMarkdown: livedocMarkdownOptions() },
  },
})

export default defineConfig({
  mdxOptions: livedocMdxOptions({ root: process.cwd() }) as never,
})

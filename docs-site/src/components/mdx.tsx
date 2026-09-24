/**
 * MDX 组件的 React 表。docfirst.config.mjs 声明生成 markdown 时每个组件变成什么文字，这里给站上渲染用的组件。
 * 先用 fumadocs 的默认组件，再加上文件树与示意图，最后把 pre 换成格式包里会显示引用状态的那个。
 */
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { File, Files, Folder } from 'fumadocs-ui/components/files'
import type { MDXComponents } from 'mdx/types'
import { DocfirstPre } from '@godcreator/docfirst-workflow/fumadocs/pre'
import { Diagram } from './diagram'

type Loose = MDXComponents[string]

export function getMDXComponents(components: MDXComponents = {}): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...components,
    Files: Files as Loose,
    Folder: Folder as Loose,
    File: File as Loose,
    Diagram: Diagram as Loose,
    pre: DocfirstPre as unknown as NonNullable<MDXComponents['pre']>,
  }
}

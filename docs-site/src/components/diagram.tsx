/**
 * 示意图：`<Diagram name="…" title="…">文字说明</Diagram>`。
 *
 * 人看到的是 `name` 对应的那张 SVG，agent 读生成的 markdown 看到的是 title 与子元素里的文字说明
 * （docfirst.config.mjs 里 Diagram 的规则只保留这两样）。所以说明文字要能单独读懂：图画的是什么、
 * 谁连着谁，文字里都要有。图不在 docfirst 的检查范围里。
 * 这套组件复制自内核仓文档站，各站各有一份。
 */
import type { ReactNode } from 'react'
import { CliRun } from './diagrams/cli-run'
import { CommandRun } from './diagrams/command-run'
import { CommandUnregister } from './diagrams/command-unregister'
import { DataLayout } from './diagrams/data-layout'
import { EntryIdentity } from './diagrams/entry-identity'
import { McpRequest } from './diagrams/mcp-request'
import { McpTools } from './diagrams/mcp-tools'
import { OwnerTransfer } from './diagrams/owner-transfer'
import { PyCliRun } from './diagrams/py-cli-run'
import { SeamMap } from './diagrams/seam-map'
import { SettingsLayout } from './diagrams/settings-layout'
import { SkillsFlow } from './diagrams/skills-flow'

const drawings: Record<string, () => ReactNode> = {
  'seam-map': () => <SeamMap />,
  'command-run': () => <CommandRun />,
  'command-unregister': () => <CommandUnregister />,
  'mcp-request': () => <McpRequest />,
  'mcp-tools': () => <McpTools />,
  'skills-flow': () => <SkillsFlow />,
  'settings-layout': () => <SettingsLayout />,
  'data-layout': () => <DataLayout />,
  'owner-transfer': () => <OwnerTransfer />,
  'entry-identity': () => <EntryIdentity />,
  'cli-run': () => <CliRun />,
  'py-cli-run': () => <PyCliRun />,
}

export function Diagram({ name, title, children }: { name: string; title?: string; children?: ReactNode }) {
  const draw = drawings[name]
  if (draw === undefined) throw new Error(`没有叫「${name}」的图：src/components/diagram.tsx 的 drawings 表里没有登记`)
  return (
    <figure className="diagram">
      {title !== undefined && <figcaption className="diagram-title">{title}</figcaption>}
      <div className="diagram-canvas">{draw()}</div>
      {children !== undefined && <div className="diagram-text">{children}</div>}
    </figure>
  )
}

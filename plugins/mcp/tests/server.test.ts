import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it } from 'vitest'
import { registerTools, type ToolHandlers } from '../src/index.js'
import { buildInstructions, INSTRUCTIONS_CHAR_BUDGET, loadInstructions, type CommandView, type SkillView } from '../src/inventory.js'
import { textResult } from '../src/tools.js'

/**
 * 「MCP 工具只有三个」的守卫：经内存传输连一对真的 server/client，按协议往返——
 * 谁想加第四个工具，这条先失败，逼出升 major 版本的讨论。
 */

/** 记录调用情况的替身处理函数 */
function spies(): ToolHandlers & {
  seenIndex: number
  seenSearch: unknown[]
  seenRun: unknown[]
} {
  return {
    seenIndex: 0,
    seenSearch: [],
    seenRun: [],
    instructions: loadInstructions,
    index() {
      this.seenIndex += 1
      return textResult({ ok: true })
    },
    search(query) {
      this.seenSearch.push(query)
      return textResult({ ok: true })
    },
    run(command, args) {
      this.seenRun.push([command, args])
      return textResult({ ok: true })
    },
  }
}

/** 连一对内存传输——走真实的协议往返，不用启动 http */
async function connect(handlers: ToolHandlers): Promise<{ client: Client; server: McpServer }> {
  const server = new McpServer(
    { name: 'gwb', version: 'test' },
    { instructions: loadInstructions(), capabilities: { tools: { listChanged: false } } },
  )
  registerTools(server, handlers)
  const client = new Client({ name: 't', version: '0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a), client.connect(b)])
  return { client, server }
}

describe('MCP 工具只有三个', () => {
  it('tools/list 恰好是 index / search / run 三个,没有第四个', async () => {
    const { client } = await connect(spies())
    const listed = await client.listTools()
    expect(listed.tools.map((t) => t.name).sort()).toEqual(['index', 'run', 'search'])
    expect(listed.tools).toHaveLength(3)
  })


  it('index 不带参数直接调到处理函数', async () => {
    const h = spies()
    const { client } = await connect(h)
    await client.callTool({ name: 'index', arguments: {} })
    expect(h.seenIndex).toBe(1)
  })

  it('search 的四个过滤参数都传得到,空串当作没给', async () => {
    const h = spies()
    const { client } = await connect(h)
    await client.callTool({ name: 'search', arguments: { plugin: '@godcreator/gwb-skills', q: 'read' } })
    await client.callTool({ name: 'search', arguments: { prefix: 'skill.', q: '', effect: 'read' } })
    expect(h.seenSearch).toEqual([
      { plugin: '@godcreator/gwb-skills', q: 'read' },
      { prefix: 'skill.', effect: 'read' },
    ])
  })

  it('search 的 effect 只收 read / write / external,别的值在协议层就被拒、到不了处理函数', async () => {
    const h = spies()
    const { client } = await connect(h)
    const refused = await client.callTool({ name: 'search', arguments: { effect: 'readonly' } })
    expect(refused.isError).toBe(true)
    expect(h.seenSearch).toEqual([])
  })

  it('run 把 command 与 args 原样传给处理函数', async () => {
    const h = spies()
    const { client } = await connect(h)
    await client.callTool({ name: 'run', arguments: { command: 'skill.read', args: { name: 'mcp' } } })
    expect(h.seenRun).toEqual([['skill.read', { name: 'mcp' }]])
  })

  it('instructions 是每个会话的固定开销——按日常 home 的规模接上目录也不超长,「只有三个工具」「总是带条件」「effect」几句还在', () => {
    // 规模照 2026-09-26 的 default home：33 份说明书、28 个命令前缀,名字取当天的原样
    const skillNames =
      'eli5 matt-pocock onboard gwb-commands gwb-settings gwb-node-cli docs-site mcp gitea deepseek pdf2md gwb-plugin-manager gwb-py-cli paper-fetch docfirst docfirst-docs docs-governance parallel-by-module spec-grill trajectory gwb-shell unit-folder dsh dsh-orchestrate vscode gwb-devkit gwb-release block-note bn-comment bn-journal bn-papers bn-props bn-query'.split(' ')
    const prefixes =
      'logger skill node-cli docs-site settings mcp gitea deepseek pdf2md py-cli plugin-manager paper-fetch docfirst cgm-alert shell theme unit-folder windows-backup dsh vscode devkit collab block-note bn-comment bn-journal bn-papers bn-props bn-query'.split(' ')
    const skills: SkillView[] = skillNames.map((name) => ({ name, description: '', plugin: '@t/p' }))
    const commands: CommandView[] = prefixes.map((prefix) => ({ name: `${prefix}.x`, plugin: '@t/p', description: '', effect: 'read' }))
    const text = buildInstructions({ home: 'default', version: '0.11.0', commands, skills })
    // Claude Code 超过 2048 字符就静默截断（issue #81268,官方不修）
    expect(text.length).toBeLessThanOrEqual(INSTRUCTIONS_CHAR_BUDGET)
    expect(text).toContain('MCP 工具只有 index / search / run 三个')
    expect(text).toContain('总是带条件')
    expect(text).toContain('每条命令都标了 effect')
    expect(text).toContain('bn-query')
  })
})

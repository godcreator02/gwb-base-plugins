import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it } from 'vitest'
import { registerTools, type ToolHandlers } from '../src/index.js'
import { loadInstructions } from '../src/inventory.js'
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

  it('search 的三个过滤参数都传得到,空串当作没给', async () => {
    const h = spies()
    const { client } = await connect(h)
    await client.callTool({ name: 'search', arguments: { plugin: '@godcreator/gwb-skills', q: 'read' } })
    await client.callTool({ name: 'search', arguments: { prefix: 'skill.', q: '' } })
    expect(h.seenSearch).toEqual([
      { plugin: '@godcreator/gwb-skills', q: 'read' },
      { prefix: 'skill.' },
    ])
  })

  it('run 把 command 与 args 原样传给处理函数', async () => {
    const h = spies()
    const { client } = await connect(h)
    await client.callTool({ name: 'run', arguments: { command: 'skill.read', args: { name: 'mcp' } } })
    expect(h.seenRun).toEqual([['skill.read', { name: 'mcp' }]])
  })

  it('instructions 是每个会话的固定开销——检查长度上限,也检查「只有三个工具」与「不带参数返回全部」这两句还在', () => {
    const text = loadInstructions()
    // 真正的上限是 Claude Code 超过 2048 字符就静默截断（issue #81268,官方不修）;行数只是粗略的辅助限制
    expect(text.length).toBeLessThanOrEqual(2_000)
    expect(text.split('\n').length).toBeLessThanOrEqual(41)
    expect(text).toContain('MCP 工具只有 index / search / run 三个')
    expect(text).toContain('不带参数就返回全部内容与完整用法')
  })
})

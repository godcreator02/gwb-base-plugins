import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it } from 'vitest'
import { registerTools, type ToolHandlers } from '../src/index.js'
import { loadInstructions } from '../src/surface.js'
import { textResult } from '../src/tools.js'

/**
 * 工具面封顶的守卫：经内存信道连一对真的 server/client，按协议往返——
 * 谁想加第三枚工具，这条先红，逼出 major 版本那场对话。
 */

/** 记下调用的替身手 */
function spies(): ToolHandlers & {
  seenSurface: unknown[]
  seenRun: unknown[]
} {
  return {
    seenSurface: [],
    seenRun: [],
    surface(query) {
      this.seenSurface.push(query)
      return textResult({ ok: true })
    },
    run(command, args) {
      this.seenRun.push([command, args])
      return textResult({ ok: true })
    },
  }
}

/** 连一对内存信道——协议层的真往返，不用起 http */
async function connect(handlers: ToolHandlers): Promise<Client> {
  const server = new McpServer({ name: 'gwb', version: 'test' }, { instructions: loadInstructions() })
  registerTools(server, handlers)
  const client = new Client({ name: 't', version: '0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a), client.connect(b)])
  return client
}

describe('工具面封顶', () => {
  it('tools/list 恰好 surface 与 run 两枚,没有第三者', async () => {
    const client = await connect(spies())
    const listed = await client.listTools()
    expect(listed.tools.map((t) => t.name).sort()).toEqual(['run', 'surface'])
  })

  it('run 把 command 与 args 原样递到执行口', async () => {
    const h = spies()
    const client = await connect(h)
    await client.callTool({ name: 'run', arguments: { command: 'skill.read', args: { name: 'mcp' } } })
    expect(h.seenRun).toEqual([['skill.read', { name: 'mcp' }]])
  })

  it('surface 的四个过滤参数递得到,空串当没给', async () => {
    const h = spies()
    const client = await connect(h)
    await client.callTool({ name: 'surface', arguments: { plugin: 'gwb-skills', q: 'read', slim: true } })
    await client.callTool({ name: 'surface', arguments: { prefix: 'skill.', q: '' } })
    expect(h.seenSurface).toEqual([
      { plugin: 'gwb-skills', q: 'read', slim: true },
      { prefix: 'skill.' },
    ])
  })

  it('instructions 是每会话的固定成本——守卫钉着上限,也钉着封顶那句话在', () => {
    const text = loadInstructions()
    expect(text.split('\n').length).toBeLessThanOrEqual(32)
    expect(text).toContain('封顶于 surface / run')
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from 'cordis'
import type { Message, Plugin } from 'cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import GwbData, { type GwbDataApi } from '../src/index.js'

let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-data-service-'))
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
})

/** 真实的 cordis 根上下文，提供内核替身，装上数据插件；收集全部日志 */
async function bootData(): Promise<{ root: Context; logs: Message[] }> {
  const root = new Context()
  const logs: Message[] = []
  root.logger.exporter({ export: (message) => void logs.push(message) })
  root.provide('gwbKernel', { dataDir: home, version: 'test', emit: () => {}, setShell: () => () => {} })
  const dataPlugin: Plugin = GwbData
  await root.plugin(dataPlugin)
  return { root, logs }
}

/**
 * 装一个调用方插件，在它的 fiber 上放 loader 会放的 `entry`，交回它拿到的 `ctx.gwbData`。
 * `entry` 为 null 时不放，模拟不是经 cordis.yml 加载的插件
 */
async function callerData(root: Context, entry: { id: string; pkg: string } | null): Promise<GwbDataApi> {
  let data: GwbDataApi | undefined
  await root.plugin({
    name: 'caller',
    inject: ['gwbData'],
    apply: (ctx: Context) => {
      if (entry !== null) {
        ;(ctx.fiber as unknown as { entry: unknown }).entry = { id: entry.id, options: { name: entry.pkg } }
      }
      data = ctx.gwbData
    },
  })
  if (data === undefined) throw new Error('调用方没拿到 gwbData')
  return data
}

const textsOf = (logs: Message[], type: string): string[] => logs.filter((m) => m.type === type).map((m) => m.args.map(String).join(' '))

describe('GwbData 按调用方条目给目录', () => {
  it('dir 是 <home>/data/<条目 id 末段>，第一次取就建出目录并记下包名', async () => {
    const { root } = await bootData()
    const data = await callerData(root, { id: 'home:hello', pkg: '@t/gwb-hello' })
    expect(data.dir).toBe(path.join(home, 'data', 'hello'))
    expect(JSON.parse(fs.readFileSync(path.join(home, 'data', 'hello', '.owner.json'), 'utf8'))).toEqual({ pkg: '@t/gwb-hello' })
  })

  it('同一个包的两条条目各是各的目录', async () => {
    const { root } = await bootData()
    const first = await callerData(root, { id: 'home:notes', pkg: '@t/gwb-notes' })
    const second = await callerData(root, { id: 'home:notes-work', pkg: '@t/gwb-notes' })
    await first.writeDoc('state', { which: 1 })
    await second.writeDoc('state', { which: 2 })
    expect(await first.readDoc('state')).toEqual({ which: 1 })
    expect(await second.readDoc('state')).toEqual({ which: 2 })
  })

  it('writeDoc 写成 <目录>/<文档名>.json，readDoc 读回；没有的文档回 undefined', async () => {
    const { root } = await bootData()
    const data = await callerData(root, { id: 'home:hello', pkg: '@t/gwb-hello' })
    await data.writeDoc('layout', { panes: ['a'] })
    expect(fs.readFileSync(path.join(home, 'data', 'hello', 'layout.json'), 'utf8')).toBe('{\n  "panes": [\n    "a"\n  ]\n}\n')
    expect(await data.readDoc('layout')).toEqual({ panes: ['a'] })
    expect(await data.readDoc('missing')).toBeUndefined()
  })

  it('坏掉的文档读出 undefined，并写一条 warn', async () => {
    const { root, logs } = await bootData()
    const data = await callerData(root, { id: 'home:hello', pkg: '@t/gwb-hello' })
    fs.writeFileSync(path.join(data.dir, 'broken.json'), '{ not json')
    expect(await data.readDoc('broken')).toBeUndefined()
    expect(textsOf(logs, 'warn').some((t) => t.includes('broken.json') && t.includes('解析不了'))).toBe(true)
  })

  it('写失败先写一条 error，再把异常抛给调用方', async () => {
    const { root, logs } = await bootData()
    const data = await callerData(root, { id: 'home:hello', pkg: '@t/gwb-hello' })
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    await expect(data.writeDoc('loop', circular)).rejects.toThrow()
    expect(textsOf(logs, 'error').some((t) => t.includes('写 home:hello/loop 失败'))).toBe(true)
  })

  it('目录归别的包时 dir、readDoc、writeDoc 都抛错，报错指向 plugin-manager.transfer-owner', async () => {
    const { root } = await bootData()
    await callerData(root, { id: 'home:foo', pkg: '@a/gwb-foo' }).then((d) => d.dir)
    const other = await callerData(root, { id: 'home:foo', pkg: '@b/foo' })
    expect(() => other.dir).toThrow('plugin-manager.transfer-owner')
    await expect(other.readDoc('x')).rejects.toThrow('归 @a/gwb-foo')
    await expect(other.writeDoc('x', 1)).rejects.toThrow('归 @a/gwb-foo')
  })

  it('取不到调用方的条目就抛错', async () => {
    const { root } = await bootData()
    const data = await callerData(root, null)
    expect(() => data.dir).toThrow('取不到调用方的身份')
  })

  it('条目 id 是 8 位十六进制的随机 id 时写 warn，每条条目只写一次', async () => {
    const { root, logs } = await bootData()
    const data = await callerData(root, { id: 'home:a3f9c210', pkg: '@t/gwb-rand' })
    void data.dir
    void data.dir
    await data.writeDoc('x', 1)
    const randomIdWarnings = textsOf(logs, 'warn').filter((t) => t.includes('没在 cordis.yml 里写 id'))
    expect(randomIdWarnings).toHaveLength(1)
    expect(randomIdWarnings[0]).toContain('@t/gwb-rand')
    expect(randomIdWarnings[0]).toContain('home:a3f9c210')
  })
})

describe('GwbData 的归属', () => {
  it('owners() 列出记过包名的目录：目录名 → 包名', async () => {
    const { root } = await bootData()
    void (await callerData(root, { id: 'home:hello', pkg: '@t/gwb-hello' })).dir
    void (await callerData(root, { id: 'home:notes', pkg: '@t/gwb-notes' })).dir
    fs.mkdirSync(path.join(home, 'data', 'no-owner'), { recursive: true })
    const data = await callerData(root, { id: 'home:hello', pkg: '@t/gwb-hello' })
    expect(await data.owners()).toEqual({ hello: '@t/gwb-hello', notes: '@t/gwb-notes' })
  })

  it('还没有 <home>/data 时 owners() 回空表', async () => {
    const { root } = await bootData()
    const data = await callerData(root, null)
    expect(await data.owners()).toEqual({})
  })

  it('transferOwner 立刻改写归属：之后新包名放行、旧包名被拒；完整 entryId 与裸 id 都认；写一条 info', async () => {
    const { root, logs } = await bootData()
    void (await callerData(root, { id: 'home:foo', pkg: '@old/gwb-foo' })).dir
    const manager = await callerData(root, null)
    await manager.transferOwner('home:foo', '@new/gwb-foo')
    expect(await manager.owners()).toEqual({ foo: '@new/gwb-foo' })
    const renamed = await callerData(root, { id: 'home:foo', pkg: '@new/gwb-foo' })
    expect(renamed.dir).toBe(path.join(home, 'data', 'foo'))
    const old = await callerData(root, { id: 'home:foo', pkg: '@old/gwb-foo' })
    expect(() => old.dir).toThrow('归 @new/gwb-foo')
    await manager.transferOwner('foo', '@newer/gwb-foo')
    expect(await manager.owners()).toEqual({ foo: '@newer/gwb-foo' })
    expect(textsOf(logs, 'info').some((t) => t.includes('改归 @newer/gwb-foo'))).toBe(true)
  })

  it('transferOwner 的包名为空时抛错', async () => {
    const { root } = await bootData()
    const manager = await callerData(root, null)
    await expect(manager.transferOwner('foo', '')).rejects.toThrow('改归属要给一个非空的包名')
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseEntries, readPlugins } from '../src/plugins.js'

const tmps: string[] = []
afterAll(() => {
  for (const dir of tmps) fs.rmSync(dir, { recursive: true, force: true })
})

/** 造一个迷你 home：cordis.yml + 若干装的包 */
function fixtureHome(yml: string, packages: Record<string, unknown>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-plugins-'))
  tmps.push(root)
  fs.writeFileSync(path.join(root, 'cordis.yml'), yml)
  for (const [pkg, manifest] of Object.entries(packages)) {
    fs.mkdirSync(path.join(root, 'node_modules', pkg), { recursive: true })
    fs.writeFileSync(path.join(root, 'node_modules', pkg, 'package.json'), JSON.stringify(manifest))
  }
  return root
}

const YML = [
  "- id: commands",
  "  name: '@godcreator/gwb-commands'",
  "- id: shell",
  "  name: '@godcreator/gwb-shell'",
  '',
].join('\n')

describe('parseEntries：cordis.yml 的形状就两行', () => {
  it('一条 id 带一条 name', () => {
    expect(parseEntries(YML)).toEqual([
      { id: 'commands', pkg: '@godcreator/gwb-commands' },
      { id: 'shell', pkg: '@godcreator/gwb-shell' },
    ])
  })
  it('没有 id 的条目照收（只有包名）', () => {
    expect(parseEntries("- name: '@godcreator/gwb-data'\n")).toEqual([{ pkg: '@godcreator/gwb-data' }])
  })
  it('注释、空行、认不出的行跳过；双引号与不带引号也认', () => {
    const text = ['# 这是注释', '', '- id: a', '  name: "pkg-a"', '  这行认不出', '- id: b', '  name: pkg-b'].join('\n')
    expect(parseEntries(text)).toEqual([
      { id: 'a', pkg: 'pkg-a' },
      { id: 'b', pkg: 'pkg-b' },
    ])
  })
  it('只有 name 没有值的条目不算一条', () => {
    expect(parseEntries('- id: a\n')).toEqual([])
  })
})

describe('readPlugins：条目表 + 装出来的清单', () => {
  it('包名、条目名、版本、那句话都取到', () => {
    const home = fixtureHome(YML, {
      '@godcreator/gwb-commands': { name: '@godcreator/gwb-commands', version: '0.4.3', description: '命令总线' },
      '@godcreator/gwb-shell': { name: '@godcreator/gwb-shell', version: '0.9.1' },
    })
    expect(readPlugins(home)).toEqual([
      { pkg: '@godcreator/gwb-commands', entryId: 'commands', version: '0.4.3', description: '命令总线' },
      { pkg: '@godcreator/gwb-shell', entryId: 'shell', version: '0.9.1' },
    ])
  })
  it('清单读不到时条目照报，版本与那句话空着（如实少报）', () => {
    const home = fixtureHome("- id: ghost\n  name: '@godcreator/gwb-ghost'\n", {})
    expect(readPlugins(home)).toEqual([{ pkg: '@godcreator/gwb-ghost', entryId: 'ghost' }])
  })
  it('没有 cordis.yml 回空表，不抛', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-noyml-'))
    tmps.push(root)
    expect(readPlugins(root)).toEqual([])
  })
})

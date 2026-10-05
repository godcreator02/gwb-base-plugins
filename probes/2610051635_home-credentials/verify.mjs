import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// 只对本次创建的隔离 home 运行；任何断言都只报步骤名，不输出凭据或完整回包。
const homeName = process.argv[2]
if (!/^settings-credentials-\d+$/.test(homeName ?? '')) throw new Error('需要 settings-credentials-<时间戳> 隔离 home')
if (!process.env.APPDATA) throw new Error('本实验使用 Windows home 路径')
const home = path.join(process.env.APPDATA, 'gwb-kernel', 'homes', homeName)
const sourceName = process.argv[3]
if (sourceName !== undefined && !/^settings-credentials-source-\d+$/.test(sourceName)) throw new Error('来源需要 settings-credentials-source-<时间戳> 隔离 home')
const sourceHome = sourceName === undefined ? undefined : path.join(path.dirname(home), sourceName)
const cli = path.join(home, 'node_modules', '@godcreator', 'gwb-mcp', 'bin', 'client.mjs')
const work = path.join(home, 'out', 'credentials-probe')
fs.mkdirSync(work, { recursive: true })
const env = { ...process.env }
delete env.GWB_MCP_TOKEN
delete env.GWB_MCP_URL
const passed = []
const knownValues = []
function check(condition, name) {
  if (!condition) throw new Error(`验证失败：${name}`)
  passed.push(name)
}
function noEcho(text) { return !knownValues.some((value) => text.includes(value)) }
function call(action, ...args) {
  let output
  try { output = execFileSync(process.execPath, [cli, '--home', homeName, action, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 }) }
  catch { throw new Error(`CLI 调用失败：${action} ${args[0] ?? ''}`) }
  if (!noEcho(output)) throw new Error(`出现凭据回显：${action}`)
  return JSON.parse(output)
}
function run(command, args = {}) {
  const result = call('run', command, JSON.stringify(args))
  if (!result.ok) throw new Error(`命令失败：${command}`)
  return result.data
}
function refused(command, args) {
  try { execFileSync(process.execPath, [cli, '--home', homeName, 'run', command, JSON.stringify(args)], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 }) }
  catch (error) { return error.status === 1 && noEcho(String(error.stdout) + String(error.stderr)) }
  return false
}
function token() { return JSON.parse(fs.readFileSync(path.join(home, 'credentials.json'), 'utf8')).sections.mcp.token.value }
async function statusWith(value, url) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${value}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'credentials-probe', version: '1' } } }), signal: AbortSignal.timeout(10_000) })
  await response.text()
  return response.status
}

try {
  const initial = token()
  knownValues.push(initial)
  const index = call('index')
  check(index.home === homeName, 'CLI --home 连接独立 home')
  const names = index.commands.find((group) => group.plugin === '@godcreator/gwb-settings').names
  check(names.filter((name) => name.startsWith('settings.')).sort().join(',') === 'settings.all,settings.delete,settings.get,settings.set', 'settings 命令只保留普通设置四项')
  check(names.filter((name) => name.startsWith('credentials.')).sort().join(',') === 'credentials.copy,credentials.delete,credentials.generate,credentials.import,credentials.list,credentials.status', '凭据独立编排且本地 set/reveal 不进 AI 命令清单')
  const info = run('mcp.info')
  check(!Object.hasOwn(info, 'mcpServers') && !Object.hasOwn(info, 'token'), 'mcp.info 不回配置凭据')
  const ordinaryRows = run('settings.all', { section: 'mcp' })
  check(ordinaryRows.every((row) => row.secret !== true && row.type !== 'secret'), '普通设置列表不含凭据项')
  const rows = run('credentials.list', { section: 'mcp' })
  check(rows.find((row) => row.key === 'token')?.isSet === true, 'secret 列表只返回配置状态')
  check(run('credentials.status', { section: 'mcp', key: 'token' }).secret === true, 'credentials.status 返回凭据状态')
  check(refused('settings.get', { section: 'mcp', key: 'token' }), 'settings.get 拒绝凭据')
  check(refused('settings.set', { section: 'mcp', key: 'token', value: 'fake-rejected' }) && token() === initial, 'settings.set 拒绝凭据且原值不变')
  check(refused('settings.delete', { section: 'mcp', key: 'token' }) && token() === initial, 'settings.delete 拒绝凭据且原值不变')
  check(refused('credentials.reveal', { section: 'mcp', key: 'token' }), 'MCP 拒绝本地 reveal')
  check(refused('credentials.set', { section: 'mcp', key: 'token', value: 'fake-rejected' }) && token() === initial, 'MCP 拒绝本地 set')
  const source = path.join(work, 'source.json')
  const sentinel = 'gwb-probe-not-a-real-credential-261005'
  knownValues.push(sentinel)
  fs.writeFileSync(source, JSON.stringify({ test: { token: sentinel } }))
  const importArgs = { from: { file: source, format: 'json', path: ['test', 'token'] }, to: { section: 'mcp', key: 'token' } }
  check(refused('credentials.import', importArgs), '导入拒绝默认覆盖')
  check(run('credentials.import', { ...importArgs, overwrite: true }).isSet === true && token() === sentinel, '文件导入后本机直接取用')
  check(JSON.parse(fs.readFileSync(source, 'utf8')).test.token === sentinel, '来源文件保持不变')
  check(await statusWith(initial, info.url) === 401, '更新主凭据立即拒绝旧值')
  check(refused('credentials.copy', { from: { home: 'settings-credentials-missing', section: 'mcp', key: 'token' }, to: { section: 'mcp', key: 'token' }, overwrite: true }), '指定 home 缺席时不回退 default')
  check(run('credentials.copy', { from: { section: 'mcp', key: 'token' }, to: { section: 'mcp', key: 'token' }, overwrite: true }).isSet === true, '复制只回状态')
  let sourceValue
  if (sourceHome !== undefined) {
    sourceValue = JSON.parse(fs.readFileSync(path.join(sourceHome, 'credentials.json'), 'utf8')).sections.mcp.token.value
    knownValues.push(sourceValue)
    check(run('credentials.copy', { from: { home: sourceName, section: 'mcp', key: 'token' }, to: { section: 'mcp', key: 'token' }, overwrite: true }).isSet && token() === sourceValue, '从指定 home 复制成功且不回显')
  }
  check(run('credentials.generate', { to: { section: 'mcp', key: 'token' }, overwrite: true }).isSet === true, '生成凭据只回状态')
  const generated = token()
  knownValues.push(generated)
  check(generated !== sentinel && generated.length === 43, '32 字节随机值已保存')
  if (sourceHome !== undefined) {
    const sourceUrl = JSON.parse(fs.readFileSync(path.join(sourceHome, 'runtime.json'), 'utf8')).mcp.url
    check(JSON.parse(fs.readFileSync(path.join(sourceHome, 'credentials.json'), 'utf8')).sections.mcp.token.value === sourceValue && generated !== sourceValue, '复制后目标修改不影响来源 home')
    check(await statusWith(sourceValue, sourceUrl) === 200, '来源 home 保留自身连接能力')
  }
  check(call('index').home === homeName, '生成后 CLI 无需传明文仍可连接')
  const ordinary = fs.readFileSync(path.join(home, 'settings.json'), 'utf8')
  check(noEcho(ordinary) && !Object.hasOwn(JSON.parse(ordinary).mcp.token, 'value'), 'settings.json 不含凭据值')
  const config = path.join(work, 'client.json')
  fs.writeFileSync(config, JSON.stringify({ keep: { enabled: true }, mcpServers: { existing: { url: 'http://example.invalid' } } }))
  const issued = run('mcp.client.configure', { file: config, serverName: 'probe', expiresInSeconds: 60 })
  const configDoc = JSON.parse(fs.readFileSync(config, 'utf8'))
  const temporary = configDoc.mcpServers.probe.headers.Authorization.slice('Bearer '.length)
  knownValues.push(temporary)
  check(typeof issued.id === 'string' && configDoc.keep.enabled && configDoc.mcpServers.existing.url === 'http://example.invalid', '配置直接安装且保留其他配置')
  check(await statusWith(temporary, info.url) === 200, '临时凭据可连接')
  check(run('mcp.client.list').some((row) => row.id === issued.id && !row.expired), '临时凭据列表可取回撤销 ID')
  check(run('mcp.client.revoke', { id: issued.id }).revoked, '按 ID 撤销临时凭据')
  check(await statusWith(temporary, info.url) === 401, '已撤销临时凭据被拒绝')
  const expires = run('mcp.client.configure', { file: config, serverName: 'expires', expiresInSeconds: 1 })
  const expiresToken = JSON.parse(fs.readFileSync(config, 'utf8')).mcpServers.expires.headers.Authorization.slice('Bearer '.length)
  knownValues.push(expiresToken)
  await new Promise((resolve) => setTimeout(resolve, 1200))
  check(await statusWith(expiresToken, info.url) === 401, '临时凭据到期被拒绝')
  run('mcp.client.revoke', { id: expires.id })
  check(run('credentials.delete', { section: 'mcp', key: 'client-tokens' }).isSet === false, 'credentials.delete 清除凭据且只返回状态')
  check(run('mcp.client.list').length === 0 && call('index').home === homeName, '清除临时凭据后插件内部读取兼容')
  check(noEcho(fs.readFileSync(path.join(home, 'gwb.log'), 'utf8')), '隔离 home 日志没有已知凭据')
  console.log(JSON.stringify({ home: homeName, passed }, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : '验证失败')
  process.exitCode = 1
}

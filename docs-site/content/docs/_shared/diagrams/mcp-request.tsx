/**
 * MCP 入口的一次请求：左边客户端，中间 MCP 插件自己开的 node:http 服务（三项检查、每个请求新建的 server、三个工具），
 * 右边它用到的命令总线与说明书插件，下面一行是加载时读写的设置、凭据文件与 runtime.json。
 */

import { Arrow, Box, Frame, Note, StepCaption } from './parts'
import { StepControls, useSteps } from './steps'

type Part = 'client' | 'gate' | 'server' | 'index' | 'search' | 'run' | 'bus' | 'skills' | 'settings' | 'listen' | 'secret' | 'runtime'

const STEPS: { title: string; detail: string; lit: Part[]; flows: string[]; refused?: boolean }[] = [
  { title: '全貌', detail: 'MCP 插件自己开一个 node:http 服务，只绑 127.0.0.1，只收 POST /mcp；工具只有 index、search、run 三个。', lit: [], flows: [] },
  {
    title: '第 1 步：加载时准备好端口与 token',
    detail: '从设置插件读 port（default 是 2870，被占就不开入口）与本 home 的 token；主 token 和临时 token 表由 settings 存进 credentials.json；绑定后把 { port, url } 写进 runtime.json 的 mcp 项。',
    lit: ['settings', 'listen', 'secret', 'runtime'],
    flows: ['settings'],
  },
  { title: '第 2 步：客户端发请求', detail: '客户端向 http://127.0.0.1:<端口>/mcp 发 POST，请求头带 Authorization: Bearer <token>。', lit: ['client', 'gate'], flows: ['in'] },
  {
    title: '第 3 步：三项检查',
    detail: '每次请求重新检查主 token 或未过期、未撤销的临时 token，再检查 Host、Origin。任一项不过回 401，工具不会执行。临时 token 的权限与主 token 相同，只限制时间。',
    lit: ['gate', 'secret'],
    flows: ['refuse'],
    refused: true,
  },
  {
    title: '第 4 步：每个请求新建一个 server',
    detail: '路径不是 /mcp 回 404，不是 POST 回 405。通过的请求新建一个 McpServer 和一条 StreamableHTTPServerTransport，登记三个工具。',
    lit: ['gate', 'server', 'index', 'search', 'run'],
    flows: ['pass'],
  },
  {
    title: '第 5 步：调工具',
    detail: 'index、search 每次都现取 gwbCommands.list() 与 gwbSkills.list()；run 把命令名和参数交给 gwbCommands.run。说明书插件不在时说明书清单是空表。',
    lit: ['index', 'search', 'run', 'bus', 'skills'],
    flows: ['bus', 'skills'],
  },
  {
    title: '第 6 步：回结果，连接关闭',
    detail: '工具结果随响应返回；响应结束时 transport 与 server 一起关闭，连接里不保存任何状态，也不发清单变更通知。',
    lit: ['client', 'server'],
    flows: ['out'],
  },
]

export function McpRequest() {
  const state = useSteps(STEPS.length, 3400)
  const current = STEPS[state.step]!
  const lit = (part: Part) => (current.lit.includes(part) ? (current.refused && part === 'gate' ? 'b' : 'a') : undefined)
  const flowing = (name: string) => current.flows.includes(name)

  return (
    <>
      <svg viewBox="0 0 760 420" role="img" aria-label="MCP 客户端连 MCP 入口的一次请求">
        <Box x={10} y={112} w={140} h={60} lines={['MCP 客户端', 'agent · bin/client.mjs']} tone={lit('client')} />

        <Frame x={176} y={10} w={384} h={316} label="MCP 入口 gwb-mcp（node:http，只绑 127.0.0.1）" />
        <Box x={192} y={100} w={112} h={80} lines={['三项检查', 'token', 'Host · Origin']} tone={lit('gate')} />
        <Box x={326} y={40} w={220} h={56} lines={['每个请求新建一次', 'McpServer + transport']} tone={lit('server')} />
        <Box x={326} y={124} w={68} h={48} lines={['index']} tone={lit('index')} mono />
        <Box x={402} y={124} w={68} h={48} lines={['search']} tone={lit('search')} mono />
        <Box x={478} y={124} w={68} h={48} lines={['run']} tone={lit('run')} mono />
        <Note x={436} y={200} anchor="middle" size={10.5}>
          路径不对 404 · 不是 POST 405
        </Note>

        <Box x={192} y={240} w={112} h={60} lines={['监听', '127.0.0.1:<端口>']} tone={lit('listen')} mono />
        <Box x={314} y={240} w={116} h={60} lines={['settings 保管', '主 / 临时 token']} tone={lit('secret')} />
        <Box x={440} y={240} w={106} h={60} lines={['runtime.json', 'mcp 项']} tone={lit('runtime')} mono />

        <Box x={590} y={96} w={160} h={52} lines={['命令总线', 'list() · run()']} tone={lit('bus')} mono />
        <Box x={590} y={166} w={160} h={52} lines={['说明书插件', 'list()（可以不在）']} tone={lit('skills')} mono />
        <Box x={10} y={240} w={140} h={60} lines={['设置插件', 'port · 凭据']} tone={lit('settings')} />

        <Arrow from={[150, 132]} to={[192, 132]} label="POST /mcp" tone={flowing('in') ? 'a' : undefined} flow={flowing('in')} />
        {flowing('refuse') && <Arrow from={[192, 160]} to={[150, 160]} label="401" labelAt="below" tone="b" flow />}
        {flowing('out') && <Arrow from={[192, 160]} to={[150, 160]} label="结果" labelAt="below" tone="a" flow />}
        <Arrow from={[304, 112]} to={[326, 80]} tone={flowing('pass') ? 'a' : undefined} flow={flowing('pass')} />
        <Arrow from={[436, 96]} to={[436, 124]} tone={flowing('pass') ? 'a' : undefined} />
        <Arrow from={[546, 142]} to={[590, 122]} tone={flowing('bus') ? 'a' : undefined} flow={flowing('bus')} />
        <Arrow from={[546, 156]} to={[590, 190]} tone={flowing('skills') ? 'a' : undefined} flow={flowing('skills')} />
        <Arrow from={[150, 270]} to={[192, 270]} tone={flowing('settings') ? 'a' : undefined} flow={flowing('settings')} />

        <StepCaption x={14} y={352} w={730} title={current.title} detail={current.detail} />
      </svg>
      <StepControls count={STEPS.length} state={state} />
    </>
  )
}

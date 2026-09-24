import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Context, Logger } from 'cordis'
import { z } from 'zod'
import type { GwbContext, GwbResult } from '@godcreator/gwb-plugin-api'
import { requireKernel } from './vocab.js'
// 这几个 import 同时激活对应插件的 `declare module 'cordis'`，给 ctx 加上 gwbCommands、gwbSettings、gwbSkills、gwbNodeCli
import type { GwbCommands } from '@godcreator/gwb-commands'
import type {} from '@godcreator/gwb-settings'
import type {} from '@godcreator/gwb-skills'
import type {} from '@godcreator/gwb-node-cli'
import { DEFAULT_HOME, choosePort, connectionInfo, defaultPort, endpointUrl, homeNameOf, mcpServers, type PortChoice } from './endpoint.js'
import { gateRequest, loadOrCreateToken, rotateToken, type GateVerdict } from './auth.js'
import {
  buildIndex,
  buildSearch,
  loadInstructions,
  type SkillsSlot,
  type SearchQuery,
} from './inventory.js'
import { RUNTIME_FILE, writeRuntimeMcp } from './runtime.js'
import { cliRunResult, coerceArgs, isCliRunResult, textResult, toolResult, type ToolResult } from './tools.js'

export const name = 'gwb-mcp'

export const inject = ['gwbCommands', 'gwbSettings']

const PACKAGE_NAME = '@godcreator/gwb-mcp'

/** 命令行客户端的脚本。本模块在 `src/` 或 `dist/`，都是包根下一层，所以 `../bin/` 两处都对 */
const CLIENT_ENTRY = fileURLToPath(new URL('../bin/client.mjs', import.meta.url))

/** 构建产物在 dist/ 下，包根的 skills/ 就是 '../skills/'；这个目录要列进 package.json 的 files */
const OWN_SKILLS_DIR = new URL('../skills/', import.meta.url)

/** 端口那一项设置的 key。改了要重启这个 home 才生效：端口在 apply 时打开 */
const PORT_KEY = 'port'

/** 报给 MCP 客户端的是本插件的版本号；读不出来就 0.0.0，不为一个版本号让入口开不了 */
function ownVersion(): string {
  try {
    const manifest = createRequire(import.meta.url)('../package.json') as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function sendJson(res: ServerResponse, code: number, value: unknown): void {
  const text = JSON.stringify(value)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/** 401 回执里「去哪拿 token」那句，拒绝时唯一的提示 */
export function credentialNote(file: string | undefined): string {
  return `token 取法见 mcp.token 命令${file === undefined ? '' : `（或读 ${file}）`}`
}

/** 三个工具的处理函数，做成可传入的形状，测试用内存传输连一对，不用启动 http */
export interface ToolHandlers {
  index(): ToolResult | Promise<ToolResult>
  search(query: SearchQuery): ToolResult | Promise<ToolResult>
  run(command: string, args: unknown): ToolResult | Promise<ToolResult>
}

function searchQueryFrom(raw: { plugin?: string; prefix?: string; q?: string }): SearchQuery {
  const query: SearchQuery = {}
  if (typeof raw.plugin === 'string' && raw.plugin !== '') query.plugin = raw.plugin
  if (typeof raw.prefix === 'string' && raw.prefix !== '') query.prefix = raw.prefix
  if (typeof raw.q === 'string' && raw.q !== '') query.q = raw.q
  return query
}

/** 工具只有这三个是对外的契约，测试检查 tools/list 恰好是它们；加第四个是 major 版本变更 */
export function registerTools(server: McpServer, handlers: ToolHandlers): void {
  server.registerTool(
    'index',
    {
      description:
        '这台工作台的完整地图：说明书名录带完整描述、命令按件分组只报名字（参数形状在 search；' +
        '装了哪些件问 plugin-manager.list）。无参数，连上先调一次——它现拼，装了新件下一次调用就在。',
    },
    async () => handlers.index(),
  )

  server.registerTool(
    'search',
    {
      description:
        '按条件找命令与说明书，命中行带完整用法（参数形状在 usage 里）。裸调＝不过滤＝' +
        '全貌全用法（约八千 token，陌生 home 深度进场用一次）；带条件只回命中的一角。',
      inputSchema: {
        plugin: z.string().optional().describe('精确插件名（包名），命令与说明书一起筛'),
        prefix: z.string().optional().describe('命令名前缀，如 "skill."；说明书表回瘦身行'),
        q: z.string().optional().describe('名字、一句话或用法里找子串，不分大小写'),
      },
    },
    async (raw) => handlers.search(searchQueryFrom(raw)),
  )

  server.registerTool(
    'run',
    {
      description:
        '按命令名调工作台的一切命令（先 index 看地图、search 看用法）。' +
        '命令自身失败（不存在、参数不对）不算协议错误，回的是 isError 的结果文本，照常往下读。',
      inputSchema: {
        command: z.string().describe('命令名，如 skill.read'),
        args: z.unknown().optional().describe('可选参数，形状看 search 里那条命令的 usage；命令自己校验'),
      },
    },
    async ({ command, args }) => handlers.run(command, args),
  )
}

/** 每个请求一个 server：instructions 与三个工具在发布时就定了，index 与 search 的内容每次调用现取 */
function createMcpServer(version: string): McpServer {
  return new McpServer(
    { name: 'gwb', version },
    {
      instructions: loadInstructions(),
      // 无状态的入口发不出清单变更通知，所以声明 false；SDK 的 registerTool 会把它改成 true
      capabilities: { tools: { listChanged: false } },
    },
  )
}

/** apply 里各部分共用、会变的几样 */
interface EndpointState {
  /** 必须可改：`mcp.token` 换了新 token 要写回这里，请求检查才立刻用新的 */
  secret: { token: string; file: string } | undefined
  /** 绑定成功后的实际端口。Host / Origin 名单要用它，系统分配端口时设置里的值是 0 */
  listeningPort: number | undefined
  /** 说明书服务；说明书插件不在或已卸载时是 undefined */
  skills: SkillsSlot | undefined
  /** 监听失败的原因，必须在监听失败的第一个 catch 里写上，`mcp.info` 才读得到 */
  listenError: string | undefined
}

/** 缺省按 home 名给，跟 choosePort 不给值时的答案一致，界面上看到的就是实际会用的端口 */
function definePortSettingAndChoose(ctx: GwbContext, home: string): PortChoice {
  ctx.gwbSettings.define({
    key: PORT_KEY,
    title: 'MCP 端口',
    type: 'number',
    default: defaultPort(home),
    description:
      'default home 认死 2870（被占就不开这道口，不退让）；其它 home 0 = 系统随机口，给了口被占就退让。改了要重启这个 home 才生效',
  })
  return choosePort(home, ctx.gwbSettings.get(PORT_KEY))
}

/**
 * 在 apply 里就取 token，不等绑定成功：绑定之前就可能有请求进来。
 * 取不出来（磁盘满、目录不可写）不让插件加载失败：入口照开、所有请求一律 401，不退回成不检查
 */
function loadSecretOrRefuseAll(log: Logger, dataDir: string): EndpointState['secret'] {
  try {
    const loaded = loadOrCreateToken(dataDir)
    if (loaded.created) {
      log.info(`第一次开这道口：token 已经生成好了（${loaded.file}）。取法：mcp.token 命令，或命令行脸直接读它`)
    } else if (loaded.regenerated) {
      log.warn(`凭据文件读不出 token，已另存一份坏的（${loaded.file}.broken-*）并换了一份新的：所有客户端都要改配置`)
    }
    return { token: loaded.token, file: loaded.file }
  } catch (loadError) {
    log.error(`凭据文件取不出来，这道口一律 401（不降级成无鉴权）：${String(loadError)}`)
    return undefined
  }
}

/** 局部注入：说明书插件不在时入口照开，清单是空表；它卸载时把清单置空 */
function trackSkillsWheneverSkillsPluginIsLoaded(ctx: GwbContext, state: EndpointState): void {
  ctx.inject(['gwbSkills'], (contextWithSkills) => {
    state.skills = contextWithSkills.gwbSkills
    contextWithSkills.effect(() => contextWithSkills.gwbSkills.register(OWN_SKILLS_DIR))
    contextWithSkills.effect(() => () => {
      state.skills = undefined
    })
  })
}

/** 入口对外开放，agent 的每次调用都写一条日志：命令总线的日志里看不出是 agent 调的 */
function logAgentRun(log: Logger, command: string, result: GwbResult): void {
  const error =
    result !== null && typeof result === 'object' && 'error' in result
      ? String((result as { error: unknown }).error)
      : undefined
  if (result !== null && typeof result === 'object' && (result as { ok?: unknown }).ok === true) {
    log.info(`agent 调了 ${command}：成了`)
  } else {
    log.warn(`agent 调了 ${command}：没成（${error ?? '没说原因'}）`)
  }
}

/** 三个工具的处理函数。命令表与说明书清单每次调用现取，运行中新加载的插件下一次调用就在 */
function createToolHandlers(commandBus: GwbCommands, log: Logger, state: EndpointState, home: string, version: string): ToolHandlers {
  return {
    index() {
      const doc = buildIndex({ home, version, commands: commandBus.list(), skills: state.skills?.list() })
      log.info(`agent 看了一遍地图（${doc.commands.reduce((n, g) => n + g.names.length, 0)} 条命令、${doc.skills.length} 份说明书）`)
      return textResult(doc)
    },
    search(query) {
      const doc = buildSearch({ commands: commandBus.list(), skills: state.skills?.list(), query })
      log.info(
        `agent 搜了一遍（命中 ${doc.commands.length} 条命令、${doc.skills.length} 份说明书${
          doc.filter === undefined ? '，裸调全貌' : ''
        }）`,
      )
      return textResult(doc)
    },
    async run(command, rawArgs) {
      const result = await commandBus.run(command, coerceArgs(rawArgs))
      logAgentRun(log, command, result)
      return isCliRunResult(result) ? cliRunResult(result) : toolResult(result)
    },
  }
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse, log: Logger, handlers: ToolHandlers, version: string): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname !== '/mcp') {
    sendJson(res, 404, { error: 'not found' })
    return
  }
  if (req.method !== 'POST') {
    log.info(`拒绝了一条请求：不是 POST（405，收到的是 ${String(req.method)}）`)
    res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
    res.end()
    return
  }
  const mcp = createMcpServer(version)
  registerTools(mcp, handlers)
  // 空对象 = 无状态：不给 sessionIdGenerator，每个请求新建一对、随响应关闭
  const transport = new StreamableHTTPServerTransport({})
  res.on('close', () => {
    void transport.close()
    void mcp.close()
  })
  await mcp.connect(transport)
  await transport.handleRequest(req, res)
}

/** token、Host、Origin 三项检查在派发任何请求之前；拒绝写 warn 带原因，这个端口常收到无关请求 */
function createHttpServer(log: Logger, state: EndpointState, choice: PortChoice, handlers: ToolHandlers, version: string): http.Server {
  return http.createServer((req, res) => {
    const verdict: GateVerdict = gateRequest({
      headers: req.headers,
      token: state.secret?.token ?? '',
      port: state.listeningPort ?? choice.port,
    })
    if (verdict !== undefined) {
      log.warn(`拒绝了一条请求：${verdict.refused}`)
      sendJson(res, 401, { error: 'unauthorized', message: `${verdict.refused}——${credentialNote(state.secret?.file)}` })
      return
    }
    // 必须 catch：漏掉的 rejection 只剩内核记一行日志，请求方还在等回执
    void handleMcpRequest(req, res, log, handlers, version).catch((handleError: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
      else res.end()
      log.error(`${String(req.method)} ${String(req.url)} 处理异常：`, handleError)
    })
  })
}

/** 只绑 127.0.0.1：入口只服务本机 */
function listenOnce(server: http.Server, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onError = (listenError: Error): void => {
      reject(listenError)
    }
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError)
      const address = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : port)
    })
  })
}

/** 被占时能换端口的只有「设置里显式给了端口的非 default home」 */
function listenFallingBackWhenAllowed(server: http.Server, choice: PortChoice, log: Logger, state: EndpointState): Promise<number> {
  return listenOnce(server, choice.port).catch(async (listenError: NodeJS.ErrnoException) => {
    const occupied = listenError.code === 'EADDRINUSE'
    if (occupied && choice.fallback) {
      log.warn(`127.0.0.1:${choice.port} 已被占用（另一个 home？），改用系统分配端口`)
      return listenOnce(server, 0)
    }
    state.listenError = occupied ? `127.0.0.1:${choice.port} 已被别的进程占着` : String(listenError)
    throw listenError
  })
}

/** 绑定成功后记下实际端口并写进 runtime.json；写失败不影响入口。没绑定成功只写 error，mcp.info 会再说一遍 */
function reportListening(ready: Promise<number>, ctx: GwbContext, log: Logger, state: EndpointState, home: string, choice: PortChoice): void {
  ready.then(
    async (port) => {
      state.listeningPort = port
      log.info(`MCP 门就绪（${home} home）：${endpointUrl(port)}——要 Authorization 头，绑 127.0.0.1 本机自用`)
      try {
        writeRuntimeMcp(requireKernel(ctx).dataDir, { port, url: endpointUrl(port) })
      } catch (writeError) {
        log.warn(`运行记录 ${RUNTIME_FILE} 没写成（这道门照常服务）：${String(writeError)}`)
      }
    },
    (listenError: unknown) => {
      log.error(
        home === DEFAULT_HOME
          ? `default home 的 MCP 门 ${choice.port} 没开成，这次不开这道门。` +
              `**不退让到别的端口**：连上来的会话认死这个串，退让等于把它送给占着口的那个 home。` +
              `腾开 ${choice.port} 再重启这个 home。原因：${String(listenError)}`
          : `${home} home 的 MCP 门没开成（要的是 ${choice.port}）：${String(listenError)}`,
      )
    },
  )
}

/** 两条命令都要等监听有结果再答，问早了拿到的端口是 0 */
interface ListeningStatus {
  portOrNull(): Promise<number | null>
  notListeningError(): string
  secretMissingError(): string
}

function listeningStatusOf(ready: Promise<number>, state: EndpointState, home: string, choice: PortChoice): ListeningStatus {
  return {
    portOrNull: () =>
      ready.then(
        (port) => port,
        () => null,
      ),
    notListeningError: () => `MCP 门没在监听（${home} home 要的是 ${choice.port} 口）：${state.listenError ?? '原因未记下'}`,
    secretMissingError: () => `凭据文件取不出来（${home} home），这道口现在一律 401。先解决磁盘/权限问题再重启这个 home`,
  }
}

/** 两条命令的回执都带明文 token，会进调用方的会话记录，所以写进 usage */
function registerInfoCommand(ctx: GwbContext, commandBus: GwbCommands, state: EndpointState, status: ListeningStatus): void {
  ctx.effect(() =>
    commandBus.register(
      {
        name: 'mcp.info',
        description: 'MCP 门的连接信息（url 与可照抄的 mcpServers 片段，片段里带 Authorization 请求头与当前 token）',
        usage:
          '无参数。回执 { ok, data: { url, port, mcpServers, auth } }——mcpServers 片段里带 Authorization: Bearer <当前 token>，贴进客户端配置即可连；只读当前 token、不换（换用 mcp.token {"rotate":true}）。**回执里有明文凭据，会进你的会话记录**。门没开或凭据文件取不出来时回 ok:false 说原因',
        plugin: PACKAGE_NAME,
      },
      async () => {
        const port = await status.portOrNull()
        if (port === null) return { ok: false, error: status.notListeningError() }
        if (state.secret === undefined) return { ok: false, error: status.secretMissingError() }
        return { ok: true, data: connectionInfo(port, state.secret.token, state.secret.file) }
      },
    ),
  )
}

function registerTokenCommand(ctx: GwbContext, commandBus: GwbCommands, log: Logger, state: EndpointState, status: ListeningStatus): void {
  ctx.effect(() =>
    commandBus.register(
      {
        name: 'mcp.token',
        description: 'MCP 门的 token：取当前的，或换一份新的（换完旧客户端一律 401）',
        usage:
          '{"rotate":true} 换发一份新的；不给就回当前这份。回执 { ok, data: { token, file, rotated, mcpServers } }——mcpServers 片段里带的就是这份 token，贴进客户端即可连。**回执里有明文凭据，会进你的会话记录**',
        plugin: PACKAGE_NAME,
      },
      async (raw: unknown) => {
        if (state.secret === undefined) return { ok: false, error: status.secretMissingError() }
        const rotateRequested = raw !== null && typeof raw === 'object' && (raw as { rotate?: unknown }).rotate === true
        const port = await status.portOrNull()
        if (port === null) return { ok: false, error: status.notListeningError() }
        let token = state.secret.token
        let rotated = false
        if (rotateRequested) {
          const minted = rotateToken(requireKernel(ctx).dataDir)
          // 写回内存里的凭据，下一个请求就按新 token 检查
          state.secret = { token: minted.token, file: minted.file }
          token = minted.token
          rotated = true
          log.warn('token 换了一份新的：所有旧客户端的配置都要跟着改，否则一律 401')
        }
        return {
          ok: true,
          data: {
            token,
            file: state.secret.file,
            rotated,
            mcpServers: mcpServers(endpointUrl(port), token),
          },
        }
      },
    ),
  )
}

/** 命令行客户端经 gwbNodeCli 登记，同时成为总线命令。局部注入：node-cli 插件不在时入口照开 */
function registerCliClientWheneverNodeCliIsLoaded(ctx: GwbContext): void {
  ctx.inject(['gwbNodeCli'], (contextWithNodeCli: Context) => {
    contextWithNodeCli.gwbNodeCli.register({
      name: 'mcp.client',
      plugin: PACKAGE_NAME,
      description: '在命令行直接调这扇门（零依赖单文件，node ≥18，连包都不用装）',
      usage:
        '{"args":["<动作>",…]}。动作 index / search [<JSON 筛选>] / run <命令名> [<JSON 参数>]。门的地址 --url 或环境变量 GWB_MCP_URL，缺省 http://127.0.0.1:2870/mcp（default home 认死 2870，隔离 home 的口看 devkit.home.list 的 mcp 格）。业务失败正文照印、退出码 1',
      entry: CLIENT_ENTRY,
    })
  })
}

export function apply(ctx: GwbContext): void {
  const log = ctx.logger(name)
  const version = ownVersion()
  const commandBus = ctx.gwbCommands
  // inject 保证了它在，这句只是把类型收窄
  if (commandBus === undefined) return

  const home = homeNameOf(requireKernel(ctx).dataDir)
  const choice = definePortSettingAndChoose(ctx, home)
  const state: EndpointState = {
    secret: loadSecretOrRefuseAll(log, requireKernel(ctx).dataDir),
    listeningPort: undefined,
    skills: undefined,
    listenError: undefined,
  }
  trackSkillsWheneverSkillsPluginIsLoaded(ctx, state)

  const handlers = createToolHandlers(commandBus, log, state, home, version)
  const server = createHttpServer(log, state, choice, handlers, version)
  const ready = listenFallingBackWhenAllowed(server, choice, log, state)
  reportListening(ready, ctx, log, state, home, choice)

  const status = listeningStatusOf(ready, state, home, choice)
  registerInfoCommand(ctx, commandBus, state, status)
  registerTokenCommand(ctx, commandBus, log, state, status)
  registerCliClientWheneverNodeCliIsLoaded(ctx)

  ctx.effect(() => () => {
    server.closeAllConnections()
    server.close()
  })
}

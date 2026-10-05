import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Context, Logger } from 'cordis'
import { z } from 'zod'
import type { GwbContext } from '@godcreator/gwb-kernel-desktop'
import type { GwbResult } from '@godcreator/gwb-commands'
import { isRecord, requireKernel } from './vocab.js'
// 这几个 import 同时激活对应插件的 `declare module 'cordis'`，给 ctx 加上 gwbCommands、gwbSettings、gwbSkills、gwbNodeCli
import type { GwbCommands } from '@godcreator/gwb-commands'
import type {} from '@godcreator/gwb-settings'
import type {} from '@godcreator/gwb-skills'
import type {} from '@godcreator/gwb-node-cli'
import { DEFAULT_HOME, choosePort, connectionInfo, defaultPort, endpointUrl, homeNameOf, mcpServers, type PortChoice } from './endpoint.js'
import { gateRequest, type GateVerdict } from './auth.js'
import { McpCredentials, TOKEN_KEY, CLIENT_TOKENS_KEY, clientTokenLifetime } from './credentials.js'
import {
  buildIndex,
  buildInstructions,
  buildSearch,
  COMMAND_EFFECTS,
  INSTRUCTIONS_CHAR_BUDGET,
  type CommandEffect,
  type CommandView,
  type SkillsSlot,
  type SearchQuery,
} from './inventory.js'
import { RUNTIME_FILE, writeRuntimeMcp } from './runtime.js'
import {
  cliRunResult,
  coerceArgs,
  errorResult,
  isCliRunResult,
  RESULT_CHAR_LIMIT,
  textResult,
  toolResult,
  withinSizeLimit,
  type ToolResult,
} from './tools.js'

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
  return `按 onboard 说明书配置客户端；mcp.token 可查看凭据状态${file === undefined ? '' : `（凭据由 settings 保管：${file}）`}`
}

/** 三个工具的处理函数，做成可传入的形状，测试用内存传输连一对，不用启动 http */
export interface ToolHandlers {
  /** initialize 返回的 instructions，每个请求新建 server 时取一次 */
  instructions(): string
  index(): ToolResult | Promise<ToolResult>
  search(query: SearchQuery): ToolResult | Promise<ToolResult>
  run(command: string, args: unknown): ToolResult | Promise<ToolResult>
}

function searchQueryFrom(raw: { plugin?: string; prefix?: string; q?: string; effect?: CommandEffect }): SearchQuery {
  const query: SearchQuery = {}
  if (typeof raw.plugin === 'string' && raw.plugin !== '') query.plugin = raw.plugin
  if (typeof raw.prefix === 'string' && raw.prefix !== '') query.prefix = raw.prefix
  if (typeof raw.q === 'string' && raw.q !== '') query.q = raw.q
  if (raw.effect !== undefined) query.effect = raw.effect
  return query
}

/** 工具只有这三个是对外的契约，测试检查 tools/list 恰好是它们；加第四个是 major 版本变更 */
export function registerTools(server: McpServer, handlers: ToolHandlers): void {
  server.registerTool(
    'index',
    {
      description:
        '这台工作台的全部说明书（带描述，描述就是什么时候该读）与按插件分组的全部命令名（参数形状与 effect 在 search；' +
        '装了哪些插件问 plugin-manager.list）。无参数；每次调用时重新生成，新装的插件下一次调用就能看到。',
    },
    async () => handlers.index(),
  )

  server.registerTool(
    'search',
    {
      description:
        '按条件找命令与说明书，命中的命令带 usage（参数形状）与 effect（read 只读 / write 改本机 / external 影响本机以外；每条命令都有）。' +
        '总是带条件：不带就是全部，会超过单次返回的上限。条件之间是「并且」。',
      inputSchema: {
        plugin: z.string().optional().describe('插件包名，精确匹配，命令与说明书一起过滤'),
        prefix: z.string().optional().describe('命令名前缀，如 "skill."；只给它时说明书只返回名字与所属插件'),
        q: z.string().optional().describe('在名字、一句话介绍或用法里找子串，不分大小写'),
        effect: z.enum(COMMAND_EFFECTS as [CommandEffect, ...CommandEffect[]]).optional().describe('只要 effect 是这一种的命令，给了就不回说明书'),
      },
    },
    async (raw) => handlers.search(searchQueryFrom(raw)),
  )

  server.registerTool(
    'run',
    {
      description:
        '按命令名调用工作台的命令（先用 index 看有哪些命令、用 search 看用法与 effect）。' +
        `命令自身失败（不存在、参数不对）与返回超过 ${RESULT_CHAR_LIMIT} 字符都不算协议错误，返回的是 isError 的结果文本，照常往下读。`,
      inputSchema: {
        command: z.string().describe('命令名，如 skill.read'),
        args: z.unknown().optional().describe('可选参数，形状看 search 里那条命令的 usage；命令自己校验'),
      },
    },
    async ({ command, args }) => handlers.run(command, args),
  )
}

/** 每个请求一个 server：三个工具在发布时就定了；instructions 末尾的目录、index 与 search 的内容每次重新取 */
function createMcpServer(version: string, instructions: string): McpServer {
  return new McpServer(
    { name: 'gwb', version },
    {
      instructions,
      // 无状态的入口发不出清单变更通知，所以声明 false；SDK 的 registerTool 会把它改成 true
      capabilities: { tools: { listChanged: false } },
    },
  )
}

/** apply 里各部分共用、会变的几样 */
interface EndpointState {
  /** 必须可改：`mcp.token` 换了新 token 要写回这里，请求检查才立刻用新的 */
  secret: McpCredentials | undefined
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
      'default home 固定用 2870（被占用就不开 MCP 入口，也不换端口）；其他 home 填 0 表示由系统分配端口，填了具体端口而被占用时改用系统分配的端口。改了要重启这个 home 才生效',
  })
  return choosePort(home, ctx.gwbSettings.get(PORT_KEY))
}

/**
 * 在 apply 里就取 token，不等绑定成功：绑定之前就可能有请求进来。
 * 取不出来（磁盘满、目录不可写）不让插件加载失败：入口照开、所有请求一律 401，不退回成不检查
 */
async function loadSecretOrRefuseAll(ctx: GwbContext, log: Logger): Promise<EndpointState['secret']> {
  ctx.gwbSettings.define({ key: TOKEN_KEY, title: 'MCP 主凭据', type: 'secret', description: '每个 home 独立保管；客户端接线读 onboard 说明书，mcp.token 可轮换' })
  ctx.gwbSettings.define({ key: CLIENT_TOKENS_KEY, title: 'MCP 临时客户端凭据', type: 'secret', description: '由 mcp.client.issue 签发、mcp.client.revoke 撤销；有效期由入口逐请求检查' })
  try {
    const credentials = new McpCredentials(ctx.gwbSettings, requireKernel(ctx).dataDir)
    await credentials.initialize()
    log.info('MCP 凭据已由本 home 的 settings 保管；配置客户端读 onboard 说明书')
    return credentials
  } catch {
    log.error('凭据无法读取或持久化，MCP 入口对所有请求一律回 401（不降级成不鉴权）')
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
    log.info(`agent 调了 ${command}：成功`)
  } else {
    log.warn(`agent 调了 ${command}：失败（${error ?? '没给出原因'}）`)
  }
}

/** 命令总线登记的那一条，按名字找；找不到是 undefined */
function registeredCommand(commandBus: GwbCommands, command: string): CommandView | undefined {
  return commandBus.list().find((registered) => registered.name === command)
}

/** 调之前先认命令：不存在的给出去哪找名字，只给页面调用的直接拒 */
function refusalBeforeRun(commandBus: GwbCommands, command: string): string | undefined {
  const registered = registeredCommand(commandBus, command)
  if (registered === undefined) return `执行失败：没有这条命令：${command}。用 search {"q":"<关键词>"} 找名字，装卸过插件就重新调 index`
  if (registered.hiddenFromAgents === true) return `执行失败：命令 ${command} 只给页面调用，不对 agent 开放`
  return undefined
}

function oversizedRunAdvice(command: string): (length: number) => string {
  return (length) =>
    `命令 ${command} 已经执行完，但返回有 ${length} 字符，超过单次返回的上限 ${RESULT_CHAR_LIMIT}，没有交回。` +
    `看它的 usage（search {"prefix":"${command}"}）有没有筛选或条数参数，带上再调；没有这类参数的，给这条命令所在插件的仓提反馈，请它补上`
}

/** 三个工具的处理函数。命令表与说明书清单每次调用时重新取，运行中新加载的插件下一次调用就能看到 */
function createToolHandlers(commandBus: GwbCommands, log: Logger, state: EndpointState, home: string, version: string): ToolHandlers {
  return {
    instructions() {
      const text = buildInstructions({ home, version, commands: commandBus.list(), skills: state.skills?.list() ?? [] })
      if (text.length > INSTRUCTIONS_CHAR_BUDGET) {
        log.warn(`instructions 有 ${text.length} 字符，超过 ${INSTRUCTIONS_CHAR_BUDGET}：Claude Code 会截掉 2048 字符之后的部分，末尾的说明书与命令前缀目录会缺一截`)
      }
      return text
    },
    index() {
      const doc = buildIndex({ home, version, commands: commandBus.list(), skills: state.skills?.list() })
      log.info(`agent 调了 index（${doc.commands.reduce((n, g) => n + g.names.length, 0)} 条命令、${doc.skills.length} 份说明书）`)
      return withinSizeLimit(
        textResult(doc),
        (length) => `index 的返回有 ${length} 字符，超过单次返回的上限 ${RESULT_CHAR_LIMIT}：改用 search 按 plugin 一个插件一个插件地取`,
      )
    },
    search(query) {
      const doc = buildSearch({ commands: commandBus.list(), skills: state.skills?.list(), query })
      log.info(
        `agent 调了 search（匹配 ${doc.commands.length} 条命令、${doc.skills.length} 份说明书${
          doc.filter === undefined ? '，没带条件' : ''
        }）`,
      )
      return withinSizeLimit(
        textResult(doc),
        (length) =>
          `search 的返回有 ${length} 字符，超过单次返回的上限 ${RESULT_CHAR_LIMIT}：加上 plugin、prefix、q 或 effect 缩小范围（命中了 ${doc.commands.length} 条命令、${doc.skills.length} 份说明书）`,
      )
    },
    async run(command, rawArgs) {
      const refusal = refusalBeforeRun(commandBus, command)
      if (refusal !== undefined) {
        log.warn(`agent 调了 ${command}：没有执行（${refusal}）`)
        return errorResult(refusal)
      }
      const result = await commandBus.run(command, coerceArgs(rawArgs), { via: 'mcp' })
      logAgentRun(log, command, result)
      return withinSizeLimit(isCliRunResult(result) ? cliRunResult(result) : toolResult(result), oversizedRunAdvice(command))
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
  const mcp = createMcpServer(version, handlers.instructions())
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
    let clients
    try { clients = state.secret?.clients } catch {
      sendJson(res, 401, { error: 'unauthorized', message: 'MCP 客户端凭据记录损坏，请在本机修复' })
      return
    }
    const verdict: GateVerdict = gateRequest({
      headers: req.headers,
      token: state.secret?.token ?? '',
      port: state.listeningPort ?? choice.port,
      clients,
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
      log.info(`MCP 入口已就绪（${home} home）：${endpointUrl(port)}——请求要带 Authorization 头；只监听 127.0.0.1，仅本机可用`)
      try {
        writeRuntimeMcp(requireKernel(ctx).dataDir, { port, url: endpointUrl(port) })
      } catch (writeError) {
        log.warn(`运行记录 ${RUNTIME_FILE} 没写成功（MCP 入口照常服务）：${String(writeError)}`)
      }
    },
    (listenError: unknown) => {
      log.error(
        home === DEFAULT_HOME
          ? `default home 的 MCP 入口没能监听 ${choice.port} 端口，这次不开 MCP 入口。` +
              `**不换到别的端口**：客户端配置里写的都是这个地址，换端口等于把这些客户端交给占着这个端口的那个 home。` +
              `让出 ${choice.port} 端口后再重启这个 home。原因：${String(listenError)}`
          : `${home} home 的 MCP 入口没能启动（要的端口是 ${choice.port}）：${String(listenError)}`,
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
    notListeningError: () => `MCP 入口没在监听（${home} home 要的是 ${choice.port} 端口）：${state.listenError ?? '没记下原因'}`,
    secretMissingError: () => `凭据文件取不出来（${home} home），MCP 入口现在对所有请求一律回 401。先解决磁盘或权限问题，再重启这个 home`,
  }
}

/** 页面与 MCP 只拿连接状态；受信插件保留内部读取能力。 */
function registerInfoCommand(ctx: GwbContext, commandBus: GwbCommands, state: EndpointState, status: ListeningStatus): void {
  ctx.effect(() =>
    commandBus.register(
      {
        name: 'mcp.info',
        description: 'MCP 入口地址与凭据状态；直接配置客户端读 onboard 说明书',
        usage:
          '无参数。经 MCP 或页面回 {url,port,auth:{configured}}，不回凭据。插件内部调用兼容回 mcpServers 配置片段；入口未监听或凭据不可用时失败',
        plugin: PACKAGE_NAME,
        effect: 'read',
      },
      async (_raw, context) => {
        const port = await status.portOrNull()
        if (port === null) return { ok: false, error: status.notListeningError() }
        if (state.secret === undefined) return { ok: false, error: status.secretMissingError() }
        if (context.via !== 'plugin') return { ok: true, data: { url: endpointUrl(port), port, auth: { configured: state.secret.token !== '' } } }
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
        description: '查看主凭据状态或轮换主凭据；独立临时客户端凭据不受轮换影响',
        usage:
          '{"rotate":true} 轮换主凭据，旧主凭据失效；无参数查状态。经 MCP 或页面只回 {configured,rotated}，不回明文；插件内部调用兼容旧回执。安装客户端读 onboard 说明书',
        plugin: PACKAGE_NAME,
        effect: 'write',
      },
      async (raw: unknown, context) => {
        const rotateRequested = raw !== null && typeof raw === 'object' && (raw as { rotate?: unknown }).rotate === true
        const port = await status.portOrNull()
        if (port === null) return { ok: false, error: status.notListeningError() }
        if (state.secret === undefined) return { ok: false, error: status.secretMissingError() }
        let rotated = false
        if (rotateRequested) {
          await state.secret.rotate()
          rotated = true
          log.warn('MCP 主凭据已轮换：使用旧主凭据的客户端需重新配置，独立临时凭据继续有效')
        }
        if (context.via !== 'plugin') return { ok: true, data: { configured: state.secret.token !== '', rotated } }
        const token = state.secret.token
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

function registerClientCredentialCommands(ctx: GwbContext, commandBus: GwbCommands, state: EndpointState, status: ListeningStatus): void {
  ctx.effect(() => commandBus.register({
    name: 'mcp.client.list', plugin: PACKAGE_NAME, effect: 'read',
    description: '列出独立临时 MCP 凭据的编号和到期状态，不回密钥',
    usage: '无参数。回 [{id,expiresAt,expired}]；凭据权限与本 home 的主凭据相同，撤销用 mcp.client.revoke {id}。',
  }, async () => {
    await status.portOrNull()
    if (state.secret === undefined) return { ok: false, error: status.secretMissingError() }
    return state.secret.list()
  }))
  ctx.effect(() => commandBus.register({
    name: 'mcp.client.issue', plugin: PACKAGE_NAME, effect: 'write',
    description: '签发有期限的独立 MCP 凭据，只返回编号与到期时间',
    usage: '参数 {expiresInSeconds}，1 到 31536000 的整数。回 {id,expiresAt}，不回密钥；权限与主凭据相同，有效期由入口逐请求检查。客户端接线读 onboard 说明书；配置失败按本次 id 调 mcp.client.revoke 回收。',
  }, async (raw) => {
    const lifetime = clientTokenLifetime(raw)
    const port = await status.portOrNull()
    if (port === null) return { ok: false, error: status.notListeningError() }
    if (state.secret === undefined) return { ok: false, error: status.secretMissingError() }
    return state.secret.issue(lifetime)
  }))
  ctx.effect(() => commandBus.register({
    name: 'mcp.client.revoke', plugin: PACKAGE_NAME, effect: 'write',
    description: '按编号撤销独立临时 MCP 凭据，不影响主凭据或其他客户端',
    usage: '参数 {id}，id 来自 mcp.client.issue；回 {id,revoked}。不存在时 revoked:false；撤销不删除客户端配置文件。',
  }, async (raw) => {
    if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '') throw new Error('id 必须是临时凭据编号')
    await status.portOrNull()
    if (state.secret === undefined) return { ok: false, error: status.secretMissingError() }
    return state.secret.revoke(raw.id)
  }))
}

/** 命令行客户端经 gwbNodeCli 登记，同时成为总线命令。局部注入：node-cli 插件不在时入口照开 */
function registerCliClientWheneverNodeCliIsLoaded(ctx: GwbContext): void {
  ctx.inject(['gwbNodeCli'], (contextWithNodeCli: Context) => {
    contextWithNodeCli.gwbNodeCli.register({
      name: 'mcp.client',
      plugin: PACKAGE_NAME,
      description: '在命令行直接调用 MCP 入口（零依赖单文件，node ≥18，不用装任何包）',
      usage:
        '{"args":["<动作>",…]}。动作 index / search [<JSON 筛选>] / run <命令名> [<JSON 参数>]。--home <名字> 自动读取该 home 的 runtime.json 地址与 settings 凭据；不给时用 default。--url 或 GWB_MCP_URL 可以指定入口，但与该 home 地址不同时不自动发送其凭据。命令失败照样打印正文，退出码 1',
      effect: 'external',
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
    secret: undefined,
    listeningPort: undefined,
    skills: undefined,
    listenError: undefined,
  }
  trackSkillsWheneverSkillsPluginIsLoaded(ctx, state)

  const handlers = createToolHandlers(commandBus, log, state, home, version)
  const server = createHttpServer(log, state, choice, handlers, version)
  let disposed = false
  const ready = loadSecretOrRefuseAll(ctx, log).then((secret) => {
    if (disposed) throw new Error('MCP 插件已卸载')
    state.secret = secret
    return listenFallingBackWhenAllowed(server, choice, log, state)
  })
  reportListening(ready, ctx, log, state, home, choice)

  const status = listeningStatusOf(ready, state, home, choice)
  registerInfoCommand(ctx, commandBus, state, status)
  registerTokenCommand(ctx, commandBus, log, state, status)
  registerClientCredentialCommands(ctx, commandBus, state, status)
  registerCliClientWheneverNodeCliIsLoaded(ctx)

  ctx.effect(() => () => {
    disposed = true
    server.closeAllConnections()
    server.close()
  })
}

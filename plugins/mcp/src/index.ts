import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import type { GwbContext } from '@godcreator/gwb-plugin-api'
import { requireKernel } from './vocab.js'
// 只为激活这两个插件的 `declare module 'cordis'`——它们给 ctx 加上 gwbCommands / gwbSettings
import type {} from '@godcreator/gwb-commands'
import type {} from '@godcreator/gwb-settings'
// 只为激活 skills 插件的 `declare module 'cordis'`——下面局部注入要用 gwbSkills 这个名字
import type {} from '@godcreator/gwb-skills'
// 只为激活 node-cli 插件的 `declare module 'cordis'`——下面局部注入要用 gwbNodeCli 这个名字
import type {} from '@godcreator/gwb-node-cli'
import { DEFAULT_HOME, choosePort, connectionInfo, defaultPort, endpointUrl, homeNameOf, mcpServers } from './endpoint.js'
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

/**
 * MCP 入口（`gwb-mcp`）：把命令总线开给外部 agent，方向只有 agent → 工作台。
 * 入口本身出问题时，还能用随包的命令行客户端 `bin/client.mjs`（总线命令 `mcp.client`）。
 *
 * - **自己启动 `node:http`**。页面走内核的 IPC，只有外部 agent 需要真的 HTTP，而这个 server
 *   上只有本插件一个使用方——出现第二个要开 HTTP 端口的插件时，再把它拆出去
 * - `/mcp` 是**无状态 streamableHTTP**：每个请求新建一对 server + transport，随响应关闭，
 *   所以发不出 list_changed 这类通知。构造时声明了 `tools.listChanged: false`，但 SDK 的
 *   `registerTool` 会把它改成 `true`，客户端在 initialize 里看到的是 `true`；工具只有三个、
 *   不会变，客户端等不到通知也不影响使用
 * - **工具只有三个**：`index`（全部命令名与说明书的清单）、`search`（按条件取命令用法，
 *   不带参数返回全部）、`run`（按名字调任何命令）。写死在 `registerTools`，没有运行时名单，
 *   登记命令的一方也没有「放成顶层工具」的字段。**变更的级别**：加一个工具是 major 级协议
 *   变更、给现有工具加可选参数是 minor、改回执形状是 major——测试检查 tools/list 恰好是
 *   这三个。命令的变化全在 `run` 的参数里，每次调用都现调命令总线，插件在运行中重新加载后
 *   下一次调用就是新的
 * - **说明书也经这个入口给出**：清单（一句话）在 `index` 的 skills 项，正文经 `run` 调
 *   `skill.read`；不列 files——附件的目录写在 SKILL.md 正文里。skills 插件不在时入口照开，
 *   清单那一项是空表
 * - **端口由 home 名决定**，值从 `port` 设置来（配置一律经 `gwbSettings`，不读 `cordis.yml`
 *   的 config）：`default` 固定用 2870、被占就不开入口（判断与理由在 `endpoint.ts`）；
 *   其它 home 缺省用系统分配的端口
 * - **要 token**。只绑回环地址分得开本机与外部网络，分不开本机上的不同主体：浏览器里的
 *   页面、别的 home 的客户端配置、随手写的脚本都能访问 127.0.0.1，而这个入口后面是完整的
 *   命令注册表。理由与「为什么不用 SDK 那三个开关」写在 `auth.ts` 开头的注释里。
 *   **token 每个 home 一份、写在磁盘上、重启不换**，客户端配置一次就不用再改
 * - **取 token 的两条路**：`mcp.info`（只读）与 `mcp.token`（可换一份新的）的回执片段里
 *   带着 token；命令行客户端直接读凭据文件（`node bin/client.mjs index` 不给参数就能用）
 * - **绑定成功之后把端口写进 home 的 `runtime.json`**（见 `runtime.ts`）：端口运行时才确定，
 *   而别的程序要的是「说出 home 名就能连上」。只改自己那一项，内核写的其他项原样保留
 */

export const name = 'gwb-mcp'

/**
 * 命令行客户端的脚本（`bin/client.mjs`）。`../bin/` 在源码与构建产物里都对：本模块在 `src/`
 * 或 `dist/`，都是包根下一层
 */
const CLIENT_ENTRY = fileURLToPath(new URL('../bin/client.mjs', import.meta.url))

/** 缺哪个都不加载——inject 是 cordis 的等待机制，不是建议。settings 是硬依赖：端口从它来 */
export const inject = ['gwbCommands', 'gwbSettings']

/** 端口那一项设置的 key。改了要重启这个 home 才生效——端口在 apply 时打开 */
const PORT_KEY = 'port'

/**
 * 报给 MCP 客户端的版本号：**本插件自己的**。工具由这个插件提供，报的是入口是哪一版。
 * 读不出来就 0.0.0，不为一个版本号让整个入口起不来
 */
function ownVersion(): string {
  try {
    const manifest = createRequire(import.meta.url)('../package.json') as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** 写一份 JSON 应答：带 content-length，no-store */
function sendJson(res: ServerResponse, code: number, value: unknown): void {
  const text = JSON.stringify(value)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/**
 * 401 的回执里要说清「去哪拿 token」，这是拒绝时唯一的提示。抽成纯函数，测试能直接检查它
 * 带没带提示，也不在 apply 里拼一段没人测过的文案。
 */
export function credentialNote(file: string | undefined): string {
  return `token 取法见 mcp.token 命令${file === undefined ? '' : `（或读 ${file}）`}`
}

/** 三个工具的处理函数。抽成可传入的形状——测试用内存传输连一对，不用启动 http */
export interface ToolHandlers {
  index(): ToolResult | Promise<ToolResult>
  search(query: SearchQuery): ToolResult | Promise<ToolResult>
  run(command: string, args: unknown): ToolResult | Promise<ToolResult>
}

/**
 * 全部工具：就三次 `registerTool`，**工具只有三个是对外的契约**。测试检查 tools/list 恰好是
 * 这三个——要加第四个，先按 major 版本变更讨论，别在这里顺手加。
 */
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
    async (raw) => {
      const query: SearchQuery = {}
      if (typeof raw.plugin === 'string' && raw.plugin !== '') query.plugin = raw.plugin
      if (typeof raw.prefix === 'string' && raw.prefix !== '') query.prefix = raw.prefix
      if (typeof raw.q === 'string' && raw.q !== '') query.q = raw.q
      return handlers.search(query)
    },
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

export function apply(ctx: GwbContext): void {
  const log = ctx.logger(name)
  const version = ownVersion()
  const cli = ctx.gwbCommands
  // inject 保证了它在，这句只是把类型收窄
  if (cli === undefined) return

  /**
   * 端口由 home 名（`dataDir` 的最后一段）加 `port` 设置一起决定，判断全在 `endpoint.ts`。
   * `gwbKernel` 不写进 `inject`，用 `requireKernel` 取。
   * 设置的缺省按 home 名给，跟 choosePort 不给值时的答案一致——界面上看到的就是实际会用的端口
   */
  const home = homeNameOf(requireKernel(ctx).dataDir)
  ctx.gwbSettings.define({
    key: PORT_KEY,
    title: 'MCP 端口',
    type: 'number',
    default: defaultPort(home),
    description:
      'default home 认死 2870（被占就不开这道口，不退让）；其它 home 0 = 系统随机口，给了口被占就退让。改了要重启这个 home 才生效',
  })
  const choice = choosePort(home, ctx.gwbSettings.get(PORT_KEY))

  /**
   * 入口的凭据。**在 apply 里取，不等绑定成功再取**：绑定之前就可能有请求进来，而
   * 「入口开着但不知道自己的 token」比「入口没开」更糟。
   *
   * **必须是 `let`**：`mcp.token {"rotate":true}` 换了新 token 之后要写回这里，检查才立刻
   * 用新的。只写文件不写回的话，回执报了新 token、入口却还认旧的——症状是「换完新的用不了、
   * 旧的还能用」，要重新加载插件才生效。隔离 home 里验证时出过一次。
   *
   * 取不出来（磁盘满、目录不可写）不让整个插件加载失败：入口照常开、`secret` 是 undefined，
   * 所有请求一律 401，日志里说清楚原因。**宁可全部拒绝也不放行**。
   */
  let secret: { token: string; file: string } | undefined
  try {
    const made = loadOrCreateToken(requireKernel(ctx).dataDir)
    secret = { token: made.token, file: made.file }
    if (made.created) {
      log.info(`第一次开这道口：token 已经生成好了（${made.file}）。取法：mcp.token 命令，或命令行脸直接读它`)
    } else if (made.regenerated) {
      log.warn(`凭据文件读不出 token，已另存一份坏的（${made.file}.broken-*）并换了一份新的：所有客户端都要改配置`)
    }
  } catch (err) {
    log.error(`凭据文件取不出来，这道口一律 401（不降级成无鉴权）：${String(err)}`)
  }

  /**
   * 绑定成功之后才知道的实际端口。Host / Origin 的允许名单要用**这个**数——`default` 固定
   * 2870、别的 home 可能是系统分配的端口，拿设置里的值拼名单会在系统分配的端口上把自己拒掉。
   * 绑定成功之前用设置里的值（那时还没有请求进得来）
   */
  let listeningPort: number | undefined

  /**
   * 说明书清单。**局部注入，不写进 export const inject**：skills 插件不在时入口照开——
   * 清单不是入口能工作的前提。skills 插件停用或卸载时 effect 把它置空，下一次 index 就不带
   * 清单。本插件自己也带一份说明书（skills/ 目录要写进 package.json 的 files）
   */
  let skills: SkillsSlot | undefined
  ctx.inject(['gwbSkills'], (scoped) => {
    skills = scoped.gwbSkills
    scoped.effect(() => scoped.gwbSkills.register(new URL('../skills/', import.meta.url)))
    scoped.effect(() => () => {
      skills = undefined
    })
  })

  /**
   * `run` 的处理函数：agent 的每次调用都写日志，回执按形状转换——命令行运行插件的回执
   * （`stdout`/`exitCode` 在 `data` 外面）单独转，其余按普通回执转。必须写成箭头函数：`function`
   * 声明会提升，TS 认为它可能在上面那句 `if (cli === undefined) return` 之前就被调用，
   * 于是不保留 `cli` 的类型收窄
   */
  const runCommand = async (command: string, rawArgs: unknown): Promise<ToolResult> => {
    // 有的客户端发对象参数时把它序列化成了字符串（见 coerceArgs 开头的注释），在这里转回来
    const args = coerceArgs(rawArgs)
    const result = await cli.run(command, args)
    // 这个入口对外开放：agent 的每次调用都要写日志。commands.run 的日志里看不出「是 agent
    // 调的」——这一条补的就是来源
    const error =
      result !== null && typeof result === 'object' && 'error' in result
        ? String((result as { error: unknown }).error)
        : undefined
    if (result !== null && typeof result === 'object' && (result as { ok?: unknown }).ok === true) {
      log.info(`agent 调了 ${command}：成了`)
    } else {
      log.warn(`agent 调了 ${command}：没成（${error ?? '没说原因'}）`)
    }
    return isCliRunResult(result) ? cliRunResult(result) : toolResult(result)
  }

  /** `index` 的处理函数：每次都现取命令注册表与说明书清单，运行中新加载的插件下一次调用就在 */
  const indexNow = (): ToolResult => {
    const doc = buildIndex({
      home,
      version,
      commands: cli.list(),
      skills: skills?.list(),
    })
    log.info(`agent 看了一遍地图（${doc.commands.reduce((n, g) => n + g.names.length, 0)} 条命令、${doc.skills.length} 份说明书）`)
    return textResult(doc)
  }

  /** `search` 的处理函数：与 `index` 用同一份命令表和说明书清单，现取现筛 */
  const searchNow = (query: SearchQuery): ToolResult => {
    const doc = buildSearch({ commands: cli.list(), skills: skills?.list(), query })
    log.info(
      `agent 搜了一遍（命中 ${doc.commands.length} 条命令、${doc.skills.length} 份说明书${
        doc.filter === undefined ? '，裸调全貌' : ''
      }）`,
    )
    return textResult(doc)
  }

  /**
   * 新建一个 MCP server。**每个请求一个**：instructions 与三个工具在发布时就定了，而 index 与
   * search 的内容每次调用现取，连接里不保存任何会变的东西
   */
  const buildServer = (): McpServer => {
    const server = new McpServer(
      { name: 'gwb', version },
      {
        instructions: loadInstructions(),
        // 无状态的入口发不出清单变更通知，所以声明 false；但 SDK 的 registerTool 会把它改成
        // true，客户端实际看到的是 true（见本文件开头的注释）
        capabilities: { tools: { listChanged: false } },
      },
    )
    return server
  }

  const server = http.createServer((req, res) => {
    /**
     * **三项检查在这里，派发任何请求之前**：token、Host、Origin。顺序是有意的——先问
     * 「你是谁」，再问「你从哪儿来」。检查逻辑全在 `auth.ts`，这里只调用并写日志。
     *
     * 拒绝一条请求**记 warn、带原因**：这个端口经常收到无关请求（浏览器预检、扫描器、别的
     * home 连错端口），出了问题 grep 得到。
     */
    const verdict: GateVerdict = gateRequest({
      headers: req.headers,
      token: secret?.token ?? '',
      port: listeningPort ?? choice.port,
    })
    if (verdict !== undefined) {
      log.warn(`拒绝了一条请求：${verdict.refused}`)
      sendJson(res, 401, { error: 'unauthorized', message: `${verdict.refused}——${credentialNote(secret?.file)}` })
      return
    }
    /**
     * **这里的 promise 必须 catch**。漏掉的 rejection 只剩内核的
     * `process.on('unhandledRejection')` 记一行日志，而请求方还在等回执。以前的版本出过：
     * 一个带错 token 的请求让宿主进程以 code=1 退出
     */
    void handle(req, res).catch((err: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
      else res.end()
      log.error(`${String(req.method)} ${String(req.url)} 处理异常：`, err)
    })
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    const mcp = buildServer()
    registerTools(mcp, { index: indexNow, search: searchNow, run: (command, args) => runCommand(command, args) })
    // 空对象 = 无状态：不给 sessionIdGenerator，每个请求新建一对、随响应关闭
    const transport = new StreamableHTTPServerTransport({})
    res.on('close', () => {
      void transport.close()
      void mcp.close()
    })
    await mcp.connect(transport)
    await transport.handleRequest(req, res)
  }

  /** 监听一次。绑 127.0.0.1——这个入口只服务本机 */
  function listenOnce(p: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const onError = (err: Error): void => {
        reject(err)
      }
      server.once('error', onError)
      server.listen(p, '127.0.0.1', () => {
        server.off('error', onError)
        const addr = server.address()
        resolve(typeof addr === 'object' && addr !== null ? addr.port : p)
      })
    })
  }

  /**
   * 监听失败的原因。**必须在 `ready` 的第一个 catch 里赋值**：赋晚了，先注册的那个处理函数
   * 已经跑完，`mcp.info` 会拿到一句「原因未记下」
   */
  let listenError: string | undefined

  const ready = listenOnce(choice.port).catch(async (err: NodeJS.ErrnoException) => {
    const occupied = err.code === 'EADDRINUSE'
    // 被占时能换端口的只有「设置里显式给了端口的非 default home」——见 endpoint.ts
    if (occupied && choice.fallback) {
      log.warn(`127.0.0.1:${choice.port} 已被占用（另一个 home？），改用系统分配端口`)
      return listenOnce(0)
    }
    listenError = occupied ? `127.0.0.1:${choice.port} 已被别的进程占着` : String(err)
    throw err
  })

  ready.then(
    async (p) => {
      listeningPort = p
      log.info(`MCP 门就绪（${home} home）：${endpointUrl(p)}——要 Authorization 头，绑 127.0.0.1 本机自用`)
      /**
       * 把端口写进 home 的运行记录，**只在绑定成功时写**：别的程序要的是「说出 home 名就
       * 能连上」，而端口运行时才确定。没绑定成功不写——那时这个 home 上根本没有入口，
       * 写一项假的比不写更糟。
       *
       * **写失败不影响入口**：运行记录只是附带的，入口照常服务。
       */
      try {
        writeRuntimeMcp(requireKernel(ctx).dataDir, { port: p, url: endpointUrl(p) })
      } catch (err) {
        log.warn(`运行记录 ${RUNTIME_FILE} 没写成（这道门照常服务）：${String(err)}`)
      }
    },
    (err: unknown) => {
      // 本插件其它部分照常加载，只是入口没开——mcp.info 会把同一句话再说一遍
      log.error(
        home === DEFAULT_HOME
          ? `default home 的 MCP 门 ${choice.port} 没开成，这次不开这道门。` +
              `**不退让到别的端口**：连上来的会话认死这个串，退让等于把它送给占着口的那个 home。` +
              `腾开 ${choice.port} 再重启这个 home。原因：${String(err)}`
          : `${home} home 的 MCP 门没开成（要的是 ${choice.port}）：${String(err)}`,
      )
    },
  )

  /** 等监听有了结果：绑定成功回端口，没开成回 null。问早了不等的话拿到的是 0 */
  const listeningPortOrNull = (): Promise<number | null> =>
    ready.then(
      (p) => p,
      () => null,
    )
  const notListeningError = (): string => `MCP 门没在监听（${home} home 要的是 ${choice.port} 口）：${listenError ?? '原因未记下'}`
  const secretMissingError = (): string =>
    `凭据文件取不出来（${home} home），这道口现在一律 401。先解决磁盘/权限问题再重启这个 home`

  /**
   * `mcp.info` 与 `mcp.token` 的回执都带明文 token，会进调用方的会话记录——写进两条的 usage，
   * 让调用方自己选时机。
   */
  ctx.effect(() =>
    cli.register(
      {
        name: 'mcp.info',
        description: 'MCP 门的连接信息（url 与可照抄的 mcpServers 片段，片段里带 Authorization 请求头与当前 token）',
        usage:
          '无参数。回执 { ok, data: { url, port, mcpServers, auth } }——mcpServers 片段里带 Authorization: Bearer <当前 token>，贴进客户端配置即可连；只读当前 token、不换（换用 mcp.token {"rotate":true}）。**回执里有明文凭据，会进你的会话记录**。门没开或凭据文件取不出来时回 ok:false 说原因',
        plugin: '@godcreator/gwb-mcp',
      },
      async () => {
        const live = await listeningPortOrNull()
        if (live === null) return { ok: false, error: notListeningError() }
        if (secret === undefined) return { ok: false, error: secretMissingError() }
        return { ok: true, data: connectionInfo(live, secret.token, secret.file) }
      },
    ),
  )

  ctx.effect(() =>
    cli.register(
      {
        name: 'mcp.token',
        description: 'MCP 门的 token：取当前的，或换一份新的（换完旧客户端一律 401）',
        usage:
          '{"rotate":true} 换发一份新的；不给就回当前这份。回执 { ok, data: { token, file, rotated, mcpServers } }——mcpServers 片段里带的就是这份 token，贴进客户端即可连。**回执里有明文凭据，会进你的会话记录**',
        plugin: '@godcreator/gwb-mcp',
      },
      async (raw: unknown) => {
        if (secret === undefined) return { ok: false, error: secretMissingError() }
        const want = raw !== null && typeof raw === 'object' && (raw as { rotate?: unknown }).rotate === true
        const live = await listeningPortOrNull()
        if (live === null) return { ok: false, error: notListeningError() }
        let token = secret.token
        let rotated = false
        if (want) {
          const made = rotateToken(requireKernel(ctx).dataDir)
          // **写回内存里的凭据**：不然回执报了新 token、入口还认旧的，要重新加载插件才生效。
          // 写回之后下一个请求就按新 token 检查
          secret = { token: made.token, file: made.file }
          token = made.token
          rotated = true
          log.warn('token 换了一份新的：所有旧客户端的配置都要跟着改，否则一律 401')
        }
        return {
          ok: true,
          data: {
            token,
            file: secret.file,
            rotated,
            mcpServers: mcpServers(endpointUrl(live), token),
          },
        }
      },
    ),
  )

  // ── 命令行客户端 ──────────────────────────────────────────────────────────

  // 命令行工具一律经 gwbNodeCli 登记，不直接登记总线命令、不在进程内调：登记的命令自动
  // 同时登记成总线命令，于是经入口的 run 就能调，回执带 stdout 与退出码。**局部注入**：
  // node-cli 插件不在时入口照开——命令行客户端是附带的，不是前提
  ctx.inject(['gwbNodeCli'], (scoped) => {
    scoped.gwbNodeCli.register({
      name: 'mcp.client',
      plugin: '@godcreator/gwb-mcp',
      description: '在命令行直接调这扇门（零依赖单文件，node ≥18，连包都不用装）',
      usage:
        '{"args":["<动作>",…]}。动作 index / search [<JSON 筛选>] / run <命令名> [<JSON 参数>]。门的地址 --url 或环境变量 GWB_MCP_URL，缺省 http://127.0.0.1:2870/mcp（default home 认死 2870，隔离 home 的口看 devkit.home.list 的 mcp 格）。业务失败正文照印、退出码 1',
      entry: CLIENT_ENTRY,
    })
  })

  // 本插件卸载时把 server 关干净
  ctx.effect(() => () => {
    server.closeAllConnections()
    server.close()
  })
}

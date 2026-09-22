import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import type { GwbContext } from '@godcreator/gwb-plugin-api'
import { requireKernel } from './vocab.js'
// 只为激活那两个件的 `declare module 'cordis'`——它们给 ctx 加上 gwbCommands / gwbSettings
import type {} from '@godcreator/gwb-commands'
import type {} from '@godcreator/gwb-settings'
// 只为激活 skills 件的 `declare module 'cordis'`——下面局部注入要用 gwbSkills 这个名字
import type {} from '@godcreator/gwb-skills'
// 只为激活 node-cli 件的 `declare module 'cordis'`——下面局部注入要用 gwbNodeCli 这个名字
import type {} from '@godcreator/gwb-node-cli'
import { DEFAULT_HOME, choosePort, defaultPort, endpointUrl, homeNameOf, mcpServers } from './endpoint.js'
import { gateRequest, loadOrCreateToken, rotateToken, TOKEN_SCHEME, type GateVerdict } from './auth.js'
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
 * MCP 门（`gwb-mcp`）：把命令面开给外部 agent（方向永远是 agent → 工作台）。
 * 2026-09-14 复位成唯一的门，同日工具面重设计为三枚——判据见轨迹卡「MCP 复位」
 * 与「三枚面」。门本身出问题时的逃生道是随包的 `bin/client.mjs`（总线命令 `mcp.client`）。
 *
 * - **自己起 `node:http`**。渲染层走内核那条 IPC 桥，只有外部 agent 需要真 HTTP，
 *   而这个 server 上眼下就只有本件一个客户——真出现第二个要开口的件，那时再把它拆出去
 * - `/mcp` 是**无状态 streamableHTTP**：每请求现造一对 server + transport，随响应关闭。
 *   发不出 list_changed 那类通知，而且**如实不广告这个能力**（capabilities 里显式
 *   false——SDK 缺省会谎报 true，等于邀请客户端等一个永不来的通知）。工具面封顶之后
 *   清单里没有会变的东西，这个能力本来也用不上
 * - **工具面封顶三枚**：`index`（地图：全部命令与说明书各带一句话）、`search`（按址取
 *   详情与兜底搜索，命中行带 usage；裸调＝全貌）、`run`（按名调一切命令）。写死在
 *   `registerTools`，没有运行时名单，登记方也没有申报顶层的字段。**封顶的粒度**：加一枚
 *   是 major 级协议变更、给现有枚加可选参数是 minor、改回执形状是 major——测试钉着
 *   tools/list 恰好这三枚。命令面的多变全在 `run` 的参数里，每次调用现打总线——与件的
 *   热重挂同一个新鲜度
 * - **说明书也从这道门出**：清单（一句话）进 `index` 的 skills 项，正文经 `run` 调
 *   `skill.read`；files 不投影——附件的目录归 SKILL.md 正文自己管。skills 件不在时门照开，
 *   清单那格是空表
 * - **口开在哪由 home 名定**，值从 `port` 设置来（配置一律走 `gwbSettings`，不吃
 *   `cordis.yml` 的 config）：`default` 认死 2870、被占就不开这道口（判断在 `endpoint.ts`，
 *   理由也在那儿）；其它 home 缺省系统随机口
 * - **要 token**（0.10 起；0.4 摘过、0.5～0.9 一路无鉴权）。回环绑定分得开本机与外部网络，
 *   分不开本机上的不同主体：浏览器里的页面、别的 home 的客户端配置、随手写的脚本都够得着
 *   127.0.0.1，而这道门后面是完整命令注册表。判据与「为什么不用 SDK 那三个开关」都在
 *   `auth.ts` 的头注里。**token 每 home 一份、落盘、重启不换**——0.4 摘它的理由是
 *   「跟着重启换新，逼人反复翻日志捞」，那条债由「持久」解开，不是由「取消鉴权」解开
 * - **取 token 的两条路**：`mcp.token` 命令回 { token, 片段 }；命令行脸直接读凭据文件，
 *   不用手抄（`node bin/client.mjs index` 开箱即用）
 * - **绑成之后把这道口落进 home 的 `runtime.json`**（见 `runtime.ts`）：这个数运行时才定，
 *   而下游要的是「说出 home 名就连得上它」。只补自己那格，内核那几格原样保留
 */

export const name = 'gwb-mcp'

/**
 * 那支命令行脸的身体（`bin/client.mjs`）。`../bin/` 两态都对：源码态本模块在 `src/`、
 * 产物态在 `dist/`，都是包根下一层
 */
const CLIENT_ENTRY = fileURLToPath(new URL('../bin/client.mjs', import.meta.url))

/** 缺哪个都不挂——inject 是 cordis 的等待机制，不是建议。settings 是硬依赖：端口从它来 */
export const inject = ['gwbCommands', 'gwbSettings']

/** 端口那一项设置的 key。改了要重启这个 home 才生效——口是 apply 时开的 */
const PORT_KEY = 'port'

/**
 * 报给 MCP 客户端的版本号：**本件自己的**。工具面是这个件渲染出来的，报「门是哪一版」。
 * 读不出来就 0.0.0，不为一个版本号让整道门起不来
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
 * 凭据取不出来时那道门一律 401，回执里得说清「去哪拿 token」。这句提示是拒绝路径上唯一
 * 的指路，抽成纯函数是为了两件事：**验机时能直接断言它带没带指路**，以及别在接线里
 * 拼一段没人测过的文案。
 */
export function credentialNote(file: string | undefined): string {
  return `token 取法见 mcp.token 命令${file === undefined ? '' : `（或读 ${file}）`}`
}

/** 三枚工具的执行口。抽成可注入的形状——测试用内存信道连一对，不用起 http */
export interface ToolHandlers {
  index(): ToolResult | Promise<ToolResult>
  search(query: SearchQuery): ToolResult | Promise<ToolResult>
  run(command: string, args: unknown): ToolResult | Promise<ToolResult>
}

/**
 * 工具面的全部：就三次 `registerTool`，**封顶的契约**。测试钉着 tools/list 恰好这三枚
 * ——谁想加第四枚，先过 major 版本那场对话，别在这儿顺手。
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
   * 这道口开在哪：home 名（`dataDir` 的末段）加 `port` 设置一起定，判断全在 `endpoint.ts`，
   * 这儿只接线。`gwbKernel` 不写进 `inject`，用 `requireKernel` 取。
   * 设置的缺省按 home 名给，跟 choosePort 不给值时的答案一致——界面上看到的就是真会用的口
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
   * 这道门的凭据。**在 apply 里取而不是绑成之后再取**：绑之前就可能有用例来敲门，而
   * 「门开着但不知道自己的 token」是比「门没开」更坏的中间态。
   *
   * **`let` 不是随手写的**：`mcp.token {"rotate":true}` 换发之后必须回写到这儿，判据才
   * 当场换新。只写文件不回写的话，回执已经报了新 token、门却还认旧的——症状是「换完
   * 新的用不了、旧的还能用」，要重挂这个件才生效。这一条被隔离 home 验机抓过一次。
   *
   * 取不出来（磁盘满、目录不可写）不让整个件挂掉：那道门照常开、`secret` 是 undefined，
   * 所有请求一律 401，日志里说清楚原因。**宁可全拒也不放行**。
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
   * 绑成之后才知道的真实口。Host / Origin 的允许名单要的是**这个**数——`default` 认死
   * 2870、别的 home 可能是系统随机口，拿候选值拼名单会在随机口上把自己拒掉。
   * 绑成之前用候选值（那一刻还没有请求进得来）
   */
  let listeningPort: number | undefined

  /**
   * 说明书清单那格。**局部注入,不写进 export const inject**:skills 件不在时这道门照开——
   * 清单不是它能不能干活的前提。effect 里上下线对称:skills 件停了/卸了置空,
   * 下一次 index 就不带清单。门自己也带一份说明书（skills/ 目录得进 package.json 的 files）
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
   * `run` 那枚的执行口：agent 的调用一律留痕，回执按形状翻译——CLI 运行器透传的那份摊平
   * （`stdout`/`exitCode` 在信封外的），其余走普通信封。写成箭头函数不是风格——`function`
   * 声明会 hoist，TS 认为它可能在上面那句 `if (cli === undefined) return` 之前就被调用，
   * 于是不给 `cli` 保留窄化
   */
  const runCommand = async (command: string, rawArgs: unknown): Promise<ToolResult> => {
    // 有的客户端发对象参数时把它序列化成了字符串（见 coerceArgs 头注），这儿收口
    const args = coerceArgs(rawArgs)
    const result = await cli.run(command, args)
    // 这道口是露在外面的：agent 每次调用都得留痕。commands.run 记不了「是 agent
    // 调的」——这一条补的正是来源
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

  /** `index` 那枚的执行口：现拼——每次都现取命令注册表与说明书清单，热挂上来的件当场就在 */
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

  /** `search` 那枚的执行口：同源现筛 */
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
   * 现造一台 MCP server。**每请求一台**：instructions 与工具面是部署期定死的，而 index 与
   * search 的内容每次调用现拼，不在连接里冻结任何会变的东西
   */
  const buildServer = (): McpServer => {
    const server = new McpServer(
      { name: 'gwb', version },
      {
        instructions: loadInstructions(),
        // 无状态口发不出清单变更通知——能力位在 handle 里注册完工具后拨回 false
        // （SDK 的 McpServer 注册工具时硬编码 true，构造项盖不掉，见 handle 里那段注）
        capabilities: { tools: { listChanged: false } },
      },
    )
    return server
  }

  const server = http.createServer((req, res) => {
    /**
     * **三道判据在这儿，派发任何东西之前**：token、Host、Origin。顺序是有意的——先问
     * 「你是谁」，再问「你是从哪儿来的」。判据全在 `auth.ts`，这儿只接线与留痕。
     *
     * 拒绝一条请求**不记 info 那一档**：这个口天天被探（浏览器预检、扫描器、别的 home
     * 连错口），记成信息会把真正的响动埋掉。warn 带原因，出事了 grep 得到。
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
     * **这里的 promise 必须有人接住**。漏成没人管的 rejection，整个工作台就靠内核那条
     * `process.on('unhandledRejection')` 兜着——它只记不退，可这一条本来就该在这儿接住，
     * 请求方等着一份回执。旧线上真炸过：一发错 token 的请求让宿主 code=1 退出
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
    // 空对象 = 无状态：不给 sessionIdGenerator，每请求现造一对、随响应关闭
    const transport = new StreamableHTTPServerTransport({})
    res.on('close', () => {
      void transport.close()
      void mcp.close()
    })
    await mcp.connect(transport)
    await transport.handleRequest(req, res)
  }

  /** 监听一次。绑 127.0.0.1——这道口只服务本机 */
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
   * 监听没成时的原因。**这一格必须在 `ready` 的第一个 catch 里填**：填晚了，先注册的
   * 那个处理器已经跑完，`mcp.info` 会拿到一句「原因未记下」
   */
  let listenError: string | undefined

  const ready = listenOnce(choice.port).catch(async (err: NodeJS.ErrnoException) => {
    const occupied = err.code === 'EADDRINUSE'
    // 许退让的只有「显式给了口的非 default home」——见 endpoint.ts
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
       * 把这道口落进 home 的运行记录，**只在绑成了这一刻**：下游要的是「说出 home 名就
       * 连得上它」，而这个数运行时才定。没绑成不写——那时这个 home 上根本没有这道门，
       * 写一格假的比不写坏得多。
       *
       * **写失败不影响这道门**：记录是附属品，门照常服务。
       */
      try {
        writeRuntimeMcp(requireKernel(ctx).dataDir, { port: p, url: endpointUrl(p) })
      } catch (err) {
        log.warn(`运行记录 ${RUNTIME_FILE} 没写成（这道门照常服务）：${String(err)}`)
      }
    },
    (err: unknown) => {
      // 本件其它部分照常挂着，只是这道门没开——mcp.info 会把同一句话再说一遍
      log.error(
        home === DEFAULT_HOME
          ? `default home 的 MCP 门 ${choice.port} 没开成，这次不开这道门。` +
              `**不退让到别的端口**：连上来的会话认死这个串，退让等于把它送给占着口的那个 home。` +
              `腾开 ${choice.port} 再重启这个 home。原因：${String(err)}`
          : `${home} home 的 MCP 门没开成（要的是 ${choice.port}）：${String(err)}`,
      )
    },
  )

  ctx.effect(() =>
    cli.register(
      {
        name: 'mcp.info',
        description: 'MCP 门的连接信息（url 与可照抄的 mcpServers 片段，片段里带 Authorization 头）',
        usage:
          '无参数。回执 { ok, data: { url, port, mcpServers, auth } }——mcpServers 片段贴进客户端配置即可连（auth 说 token 从哪来）；门没开时回 ok:false 说原因',
        plugin: '@godcreator/gwb-mcp',
      },
      async () => {
        /**
         * **端口先答**：这道门没开时报个能看的原因，比报一个连不上的 url 强——
         * default home 被别人占着口就是这一支。顺带等监听就绪，问早了拿到的是 0
         */
        const live = await ready.then(
          (p) => p,
          () => null,
        )
        if (live === null) {
          return { ok: false, error: `MCP 门没在监听（${home} home 要的是 ${choice.port} 口）：${listenError ?? '原因未记下'}` }
        }
        const url = endpointUrl(live)
        // mcpServers 是给客户端照抄的那份，拼装那一步不留给每个客户端各拼一遍。
        // **片段里只放环境变量引用，不放 token 本体**：这段回执会进会话记录，而凭据
        // 进记录等于这次加鉴权白加。要真值走 mcp.token。
        return {
          ok: true,
          data: {
            url,
            port: live,
            mcpServers: mcpServers(url),
            auth: `Authorization: ${TOKEN_SCHEME} <token>。token 取法：mcp.token 命令，或读 ${secret?.file ?? '凭据文件'}`,
          },
        }
      },
    ),
  )

  /**
   * token 的取用与换发。
   *
   * **`mcp.token` 是唯一会把 token 本体写进回执的地方**（`mcp.info` 只放环境变量引用）。
   * 那次回执会进调用方的会话记录——这是取 token 必须付的代价，写进 usage 让调用方自己选
   * 时机：机器上还有别人看得到你的会话记录时，别当众调它。
   */
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
        if (secret === undefined) {
          return { ok: false, error: `凭据文件取不出来（${home} home），这道口现在一律 401。先解决磁盘/权限问题再重启这个 home` }
        }
        const want = raw !== null && typeof raw === 'object' && (raw as { rotate?: unknown }).rotate === true
        const live = await ready.then(
          (p) => p,
          () => null,
        )
        if (live === null) {
          return { ok: false, error: `MCP 门没在监听（${home} home 要的是 ${choice.port} 口）：${listenError ?? '原因未记下'}` }
        }
        let token = secret.token
        let rotated = false
        if (want) {
          const made = rotateToken(requireKernel(ctx).dataDir)
          // **回写这份在场的凭据**：不然回执报了新 token、门还认旧的，要重挂这个件才生效。
          // 判据当场换新＝下一发请求就按新 token 判——隔离 home 验机抓过这一条
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

  // ── 一条 node CLI ──────────────────────────────────────────────────────────

  // CLI 形态的东西一律经 gwbNodeCli 登记，不做总线命令、不进程内调：登记的命令自动镜像
  // 成总线命令，于是经门的 run 就够得到，回执自带 stdout 与退出码。**局部注入**：node-cli
  // 件不在时这道门照开——命令行脸是甜点不是前提
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

  // 本件卸载时把 server 关干净
  ctx.effect(() => () => {
    server.closeAllConnections()
    server.close()
  })
}

import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { requireKernel, type GwbContext } from '@godcreator02/gwb-plugin-api'
// 只为激活那两个件的 `declare module 'cordis'`——它们给 ctx 加上 gwbCommands 与 gwbData
import type {} from '@godcreator02/gwb-commands'
import type {} from '@godcreator02/gwb-data'
// 只为激活 skills 件的 `declare module 'cordis'`——下面局部注入要用 gwbSkills 这个名字
import type {} from '@godcreator02/gwb-skills'
import { bearerMatches, loadOrCreateToken } from './auth.js'
import { DEFAULT_HOME, choosePort, endpointUrl, homeNameOf, mcpServers } from './endpoint.js'
import { buildInstructions, skillResources, type SkillsSlot } from './skills.js'
import { cliRunResult, isCliRunResult, textResult, toolNameOf, toolResult, type ToolResult } from './tools.js'

/**
 * MCP 桥：把命令面开给外部 agent（方向永远是 agent → 工作台）。
 *
 * - **自己起 `node:http`**。渲染层走内核那条 IPC 桥，只有外部 agent 需要真 HTTP，
 *   而这个 server 上眼下就只有本件一个客户——真出现第二个要开口的件，那时再把它拆出去
 * - `/mcp` 是**无状态 streamableHTTP**：每请求现造一对 server + transport，随响应关闭。
 *   代价是发不出 list_changed 那类通知，正连着的 agent 要等下一次重连才知道
 *   工具面变了。认下——每请求一对是这道口的立身之本
 * - **工具面就是命令注册表**：登记一条命令，就是一枚同名工具（`skill.list`→
 *   `skill_list`）；件卸了，下一请求工具自动消失。**暴露什么由登记命令的件决定**，
 *   mcp 一个门牌都不替别人开。参数统一装在 `args` 里——命令自己校验
 * - 自留 `gwb_command_list` / `gwb_command_run` 两件兜**时差**：无状态端点发不了
 *   list_changed，agent 连着时新装的件不长新工具，这两件是重连前够到新能力的唯一口
 * - **说明书（skill）也从这道口出**：`instructions` 点名此刻挂着的 skill（唯一的发现面），
 *   正文挂成 `skill://gwb/<名>/<文件>` resources。收的那头是 `gwb-skills` 件，局部注入
 *   接的——skills 件不在这儿时这道桥照开，只是 agent 读不到说明书
 * - **口开在哪由 home 名定**：`default` 认死 2870、被占就不开这道口（判断在
 *   `endpoint.ts`，理由也在那儿）；其它 home 默认系统随机口
 * - 鉴权见 `auth.ts`。token 落 `ctx.gwbData` 的 `token` 文档，并**打进日志**——
 *   这一版没有界面，日志是它唯一的示人出口
 */

export const name = 'gwb-mcp'

/** 缺哪个都不挂——inject 是 cordis 的等待机制，不是建议 */
export const inject = ['gwbCommands', 'gwbData']

/**
 * 报给 MCP 客户端的版本号：**本件自己的**。以前报的是内核的 `kernel.appVersion`，
 * 词汇表 0.1 里没有那个字段了——而报「桥是哪一版」本来也比报「宿主是哪一版」更贴题，
 * 工具面是这个件渲染出来的。读不出来就 0.0.0，不为一个版本号让整座桥起不来
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

export function apply(ctx: GwbContext, config?: { port?: number }): void {
  const log = ctx.logger(name)
  const version = ownVersion()
  const cli = ctx.gwbCommands
  // inject 保证了它在，这句只是把类型收窄
  if (cli === undefined) return

  /**
   * 这道口开在哪：home 名（`dataDir` 的末段）加配置一起定，判断全在 `endpoint.ts`，
   * 这儿只接线。`gwbKernel` 不写进 `inject`，用 `requireKernel` 取
   */
  const home = homeNameOf(requireKernel(ctx).dataDir)
  const choice = choosePort(home, config?.port)

  /**
   * 说明书那格。**局部注入,不写进 export const inject**:skills 件不在时这道桥照开——
   * 说明书的收发不是它能不能干活的前提。effect 里上下线对称:skills 件停了/卸了置空,
   * 下一台 server 起就不带说明书
   */
  let skills: SkillsSlot | undefined
  ctx.inject(['gwbSkills'], (scoped) => {
    skills = scoped.gwbSkills
    scoped.effect(() => () => {
      skills = undefined
    })
  })

  /**
   * 取令牌的那次尝试，**存的是 promise 而不是值**：首启那次要落一份盘（异步），
   * 而路由一挂上去随时可能进请求。各处 await 同一个 promise，先到的请求等的就是那
   * 一次首启，不会两个请求各生成一个互相盖掉。
   *
   * 失败之后把它置空，下一次请求重来一遍——盘一时写不进去（文件被占、权限）不该把
   * 这条口永久钉死在 503 上。失败原因另存一份给 `mcp.info`：**503 的 body 保持不透明**
   * （未鉴权的请求不该从错误文本里读出这台机器的情况），而问 mcp.info 的人本来就在本机
   */
  let tokenAttempt: Promise<string | null> | undefined
  let tokenError: string | undefined

  function ensureToken(): Promise<string | null> {
    tokenAttempt ??= loadOrCreateToken(ctx.gwbData).then(
      (token) => {
        tokenError = undefined
        return token
      },
      (err: unknown) => {
        tokenError = String(err)
        log.error(`令牌读写失败，这条口暂回 503（下次请求会再试一遍）：${tokenError}`)
        tokenAttempt = undefined
        return null
      },
    )
    return tokenAttempt
  }

  /**
   * 这道口的门：令牌拿不到 503、鉴权不过 401、不是 POST 405，三段之后才轮到正事。
   * **「没给」与「给错」逐字相同**——拒绝面一旦有差别，就是给外面一个试探面。
   * 回 true 才许往下走；回 false 时应答已经写完
   */
  async function guard(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const token = await ensureToken()
    if (token === null) {
      // body 不带原因：真原因经 mcp.info 与日志给人
      log.info('拒绝了一条请求：token 拿不到（503，原因见上面的错）')
      sendJson(res, 503, { error: 'token unavailable' })
      return false
    }
    // 鉴权最先做，任何分支都不得在这之前泄露注册表信息
    if (!bearerMatches(req.headers.authorization, token)) {
      // 日志只说「没过」，不说带的是什么——bearer 值进了日志跟写在门上没区别
      log.warn('拒绝了一条请求：鉴权没过（401）')
      sendJson(res, 401, { error: 'unauthorized' })
      return false
    }
    if (req.method !== 'POST') {
      log.info(`拒绝了一条请求：不是 POST（405，收到的是 ${String(req.method)}）`)
      res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
      res.end()
      return false
    }
    return true
  }

  /**
   * 所有工具共用的执行口：agent 的调用一律留痕，回执按形状翻译——CLI 运行器透传的
   * 那份摊平（`stdout`/`exitCode` 在信封外的），其余走普通信封。写成箭头函数不是
   * 风格——`function` 声明会 hoist，TS 认为它可能在上面那句
   * `if (cli === undefined) return` 之前就被调用，于是不给 `cli` 保留窄化
   */
  const runCommand = async (command: string, args: unknown): Promise<ToolResult> => {
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

  /**
   * 现造一台 MCP server。**每请求一台**：工具面随此刻挂着的件变，抓一份下来就固化了。
   */
  const buildServer = (): McpServer => {
    // 每请求现取:此刻挂着的 skill 当场进说明书,热挂的件不用等重连之外的动作
    const list = skills?.list() ?? []
    const server = new McpServer(
      { name: 'gwb', version },
      // instructions 是 skill 唯一的发现面:客户端不会自己 resources/list,
      // 不在这段里点名的 skill 等于不存在
      { instructions: buildInstructions(list) },
    )

    /** 自留的两件兜时差。压名从它们开始占位，命令渲染出的工具名让路 */
    const taken = new Set<string>(['gwb_command_list', 'gwb_command_run'])

    server.registerTool(
      'gwb_command_list',
      {
        description:
          '一页看完这个 home 此刻登记的全部命令（名字 + 描述 + 登记的件）。' +
          '每条命令平时就是一枚同名工具（skill.list→skill_list）；' +
          '连接之后新装的件要等重连才长出新工具，那期间靠这枚按名调用。',
      },
      () => {
        const commands = cli.list()
        log.info(`agent 列了一遍命令清单（${commands.length} 条）`)
        return textResult({ count: commands.length, commands })
      },
    )

    server.registerTool(
      'gwb_command_run',
      {
        description:
          '按命令名调工作台的命令面（先用 gwb_command_list 看有哪些）。' +
          '命令自身失败（不存在、参数不对）不算协议错误，回的是 isError 的结果文本，照常往下读。',
        inputSchema: {
          command: z.string().describe('命令名，如 skill.read'),
          args: z.unknown().optional().describe('可选参数，命令自己校验'),
        },
      },
      async ({ command, args }) => runCommand(command, args),
    )

    // 注册表照搬：登记一条命令就是一枚同名工具。**暴露什么由登记命令的件决定**，
    // mcp 不替任何人挑门牌；件停了/卸了，下一台 server 起来这份就没了
    for (const command of cli.list()) {
      const tool = toolNameOf(command.name, taken)
      taken.add(tool)
      server.registerTool(
        tool,
        {
          description: `（${command.plugin} 件）${command.description}`,
          inputSchema: {
            args: z.unknown().optional().describe('参数整体放这里，形状见命令描述；命令自己校验'),
          },
        },
        async ({ args }) => runCommand(command.name, args),
      )
    }

    // 说明书挂成 resources:主文件一条、附件各一条。正文回读走 skills 件的登记表,
    // **读不到就 throw**——回 JSON-RPC 错误好过骗对面「说明书是空的」
    for (const res of skillResources(list)) {
      server.registerResource(
        res.name,
        res.uri,
        { title: res.title, description: res.description, mimeType: res.mimeType },
        async () => {
          const text = await skills?.read(res.source.skill, res.source.file)
          if (text === undefined) throw new Error(`读不到 ${res.source.skill}/${res.source.file}（不在登记表里）`)
          return { contents: [{ uri: res.uri, mimeType: res.mimeType, text }] }
        },
      )
    }

    return server
  }

  async function mcpHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!(await guard(req, res))) return
    const server = buildServer()
    // 空对象 = 无状态：不给 sessionIdGenerator，每请求现造一对、随响应关闭
    const transport = new StreamableHTTPServerTransport({})
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res)
  }

  const server = http.createServer((req, res) => {
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
    if (url.pathname === '/mcp') {
      await mcpHandler(req, res)
      return
    }
    sendJson(res, 404, { error: 'not found' })
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
      const token = await ensureToken()
      // 这一版没有界面：token 的唯一出口就是这行日志与 mcp.info
      log.info(`MCP 端点就绪（${home} home）：${endpointUrl(p)}`)
      log.info(`token（仅本机使用，勿外传）：${token ?? '取不到，见上面的错'}`)
    },
    (err: unknown) => {
      // 本件其它部分照常挂着，只是这道口没开——mcp.info 会把同一句话再说一遍
      log.error(
        home === DEFAULT_HOME
          ? `default home 的 MCP 口 ${choice.port} 没开成，这次不开这道口。` +
              `**不退让到别的端口**：连上来的会话认死这个串，退让等于把它送给占着口的那个 home。` +
              `腾开 ${choice.port} 再重启这个 home。原因：${String(err)}`
          : `${home} home 的 MCP 口没开成（要的是 ${choice.port}）：${String(err)}`,
      )
    },
  )

  ctx.effect(() =>
    cli.register(
      {
        name: 'mcp.info',
        description: 'MCP 连接串（url + token + 实际端口 + 可直接抄进 .mcp.json 的 mcpServers 片段，仅本机使用，勿外传）',
        plugin: name,
      },
      async () => {
        /**
         * **端口先答**：这道口没开时报个能看的原因，比报一个连不上的 url 强——
         * default home 被别人占着口就是这一支。顺带等监听就绪，问早了拿到的是 0
         */
        const live = await ready.then(
          (p) => p,
          () => null,
        )
        if (live === null) {
          return { ok: false, error: `MCP 没在监听（${home} home 要的是 ${choice.port} 口）：${listenError ?? '原因未记下'}` }
        }
        const token = await ensureToken()
        if (token === null) {
          // 带上真原因：问这条的人本来就在本机，而「令牌不可用」五个字自己查不出盘为什么写不进去
          return { ok: false, error: `token 不可用：${tokenError ?? '原因未记下（上一次尝试还没结束？）'}` }
        }
        const url = endpointUrl(live)
        // mcpServers 是给客户端照抄的那份，拼装那一步不留给每个客户端各拼一遍
        return { ok: true, data: { url, port: live, token, mcpServers: mcpServers(url, token) } }
      },
    ),
  )

  // 本件卸载时把 server 关干净
  ctx.effect(() => () => {
    server.closeAllConnections()
    server.close()
  })
}

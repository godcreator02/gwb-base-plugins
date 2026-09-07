import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { requireKernel, type GwbContext } from '@godcreator02/gwb-plugin-api'
// 只为激活那两个件的 `declare module 'cordis'`——它们给 ctx 加上 gwbCli 与 gwbData
import type {} from '@godcreator02/gwb-cli'
import type {} from '@godcreator02/gwb-data'
import { bearerMatches, loadOrCreateToken } from './auth.js'
import { textResult, toolResult } from './tools.js'

/**
 * MCP 桥：把命令面开给外部 agent（方向永远是 agent → 工作台）。
 *
 * - **自己起 `node:http`**。渲染层走 `gwb://` 自定义协议，只有外部 agent 需要真 HTTP，
 *   而这个 server 上眼下就只有本件一个客户——真出现第二个要开口的件，那时再把它拆出去
 * - `/mcp` 是**无状态 streamableHTTP**：每请求现造一对 server + transport，随响应关闭。
 *   代价是发不出 list_changed 那类通知，正连着的 agent 要等下一次重连才知道
 *   工具面变了。认下——每请求一对是这道口的立身之本
 * - 工具面只有 `gwb_cli_list` / `gwb_cli_run` 两件：命令注册表随装了哪些件而变，
 *   没有一张固定清单，所以给的是「看清单」加「按名字调」，不是逐条门牌
 * - 鉴权见 `auth.ts`。token 落 `ctx.gwbData` 的 `token` 文档，并**打进日志**——
 *   这一版没有界面，日志是它唯一的示人出口
 */

export const name = 'gwb-mcp'

/** 缺哪个都不挂——inject 是 cordis 的等待机制，不是建议 */
export const inject = ['gwbCli', 'gwbData']

/** 首选端口。被占（多 home 同时开的常态）就退让到系统分配的那个 */
const DEFAULT_PORT = 2870

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
  const kernel = requireKernel(ctx)
  const cli = ctx.gwbCli
  // inject 保证了它在，这句只是把类型收窄
  if (cli === undefined) return

  const wantPort = Number(config?.port ?? DEFAULT_PORT)
  /**
   * 实际监听端口，listen 成功后回填。**端口现读不固化**：首选端口被占时真实端口是
   * 退让来的另一个，apply 时抓一个常量下来，连接串就会指向另一个 home 的宿主
   */
  let port = 0

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
      sendJson(res, 503, { error: 'token unavailable' })
      return false
    }
    // 鉴权最先做，任何分支都不得在这之前泄露注册表信息
    if (!bearerMatches(req.headers.authorization, token)) {
      sendJson(res, 401, { error: 'unauthorized' })
      return false
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
      res.end()
      return false
    }
    return true
  }

  /**
   * 现造一台 MCP server。**每请求一台**：工具面随此刻挂着的件变，抓一份下来就固化了。
   *
   * 写成箭头函数不是风格——`function` 声明会 hoist，TS 认为它可能在上面那句
   * `if (cli === undefined) return` 之前就被调用，于是不给 `cli` 保留窄化
   */
  const buildServer = (): McpServer => {
    const server = new McpServer({ name: 'gwb', version: kernel.appVersion ?? '0.0.0' })

    server.registerTool(
      'gwb_cli_list',
      { description: '列出这个 home 此刻有哪些命令（名字 + 描述 + 注册它的件）。命令随装了哪些件而变，没有固定清单。' },
      () => textResult({ count: cli.list().length, commands: cli.list() }),
    )

    server.registerTool(
      'gwb_cli_run',
      {
        description:
          '按命令名调工作台的命令面（先用 gwb_cli_list 看有哪些）。' +
          '命令自身失败（不存在、参数不对）不算协议错误，回的是 isError 的结果文本，照常往下读。',
        inputSchema: {
          command: z.string().describe('命令名，如 skill.list'),
          args: z.unknown().optional().describe('可选参数，命令自己校验'),
        },
      },
      async ({ command, args }) => toolResult(await cli.run(command, args)),
    )

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
     * **这里的 promise 必须有人接住**。一旦漏成没人管的 rejection，Node 会直接终止
     * 宿主进程——而宿主日志走 fd3，未捕获异常压根不经过它，死得一个字都没有。
     * 旧线真炸过：一发错 token 的请求让宿主 code=1 退出，日志停在「启动完成」
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

  const ready = listenOnce(wantPort)
    .catch(async (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EADDRINUSE' || wantPort === 0) throw err
      log.warn(`127.0.0.1:${wantPort} 已被占用（另一个 home？），改用系统分配端口`)
      return listenOnce(0)
    })
    .then((p) => {
      port = p
      return p
    })

  ready.then(
    async (p) => {
      const token = await ensureToken()
      // 这一版没有界面：token 的唯一出口就是这行日志与 mcp.info
      log.info(`MCP 端点就绪：http://127.0.0.1:${p}/mcp`)
      log.info(`token（仅本机使用，勿外传）：${token ?? '取不到，见上面的错'}`)
    },
    (err: unknown) => {
      log.error(`监听失败（首选 ${wantPort}）：${String(err)}`)
    },
  )

  ctx.effect(() =>
    cli.register(
      { name: 'mcp.info', description: 'MCP 连接串（url + token + 实际端口，仅本机使用，勿外传）', plugin: name },
      async () => {
        const token = await ensureToken()
        if (token === null) {
          // 带上真原因：问这条的人本来就在本机，而「令牌不可用」五个字自己查不出盘为什么写不进去
          return { ok: false, error: `token 不可用：${tokenError ?? '原因未记下（上一次尝试还没结束？）'}` }
        }
        // 先等监听就绪再报端口：问早了拿到的是未回填的 0
        const live = await ready.catch(() => port)
        return { ok: true, data: { url: `http://127.0.0.1:${live}/mcp`, port: live, token } }
      },
    ),
  )

  // 本件卸载时把 server 关干净
  ctx.effect(() => () => {
    server.closeAllConnections()
    server.close()
  })
}

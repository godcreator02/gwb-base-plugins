import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { isRecord, requireKernel, type GwbContext } from '@team/gwb-plugin-api'
// 只为激活那两个件的 `declare module 'cordis'`——它们给 ctx 加上 gwbCommands / gwbSettings
import type {} from '@team/gwb-commands'
import type {} from '@team/gwb-settings'
// 只为激活 skills 件的 `declare module 'cordis'`——下面局部注入要用 gwbSkills 这个名字
import type {} from '@team/gwb-skills'
import { DEFAULT_HOME, choosePort, defaultPort, endpointUrl, homeNameOf } from './endpoint.js'
import { RUNTIME_FILE, writeRuntimeHttp } from './runtime.js'
import { buildSurface, type SkillsSlot, type SurfaceQuery } from './surface.js'

/**
 * 命令 HTTP 口（`gwb-command-http`，正名自一天的 `gwb-http`）：把命令面开成本机无状态
 * JSON 接口（方向永远是 agent → 工作台）。2026-09-13 接 mcp 件的班——mcp 搁置、default
 * 卸载，理由与判据见轨迹卡「HTTP 门接班」。
 *
 * - **两条路由**：`GET /surface` 现拼命令与说明书清单（带 instructions 与自报 home 名），
 *   支持 `?plugin=` / `?prefix=` / `?q=` / `?slim=true` 过滤——全量约八千 token，陌生 home
 *   全量一次，此后定向取；`POST /run` body `{"command": 名字, "args": {...}}` 按名调命令。
 *   参数形状不在协议层，在**命令描述**里——命令自己校验
 * - **没有会话**。每个请求自包含：本件热重挂或工作台重启后，下一个请求自动就好。
 *   这是对 mcp 那条「断连要人工重连」的直接回答
 * - **不设鉴权**（0.2 起，mcp 时代那层 Bearer token 摘除）：口只绑 127.0.0.1、服务本机，
 *   本机进程本就同权；而 token 跟着内核重启换新，只会把 agent 侧的配置变成一桩要反复
 *   伺候的差事——本会话里两次逼着人翻日志捞 token，就是它最后的害处
 * - **零依赖**：只用 node:http / node:module——mcp 件那串 SDK（解包 4.3MB）随门退役
 * - **说明书从这条门出的是清单**：正文读走 `POST /run` 调 `skill.read`（skills 件登记的
 *   命令）；skills 件不在时门照开，清单那格是空表
 * - **口开在哪由 home 名定**，值从 `port` 设置来（配置一律走 `gwbSettings`，不吃
 *   `cordis.yml` 的 config）：`default` 认死 2870、被占就不开这道口（判断在 `endpoint.ts`）；
 *   其它 home 缺省系统随机口
 * - **绑成之后把这道口落进 home 的 `runtime.json`**（见 `runtime.ts`）：这个数运行时才定，
 *   而下游要的是「说出 home 名就连得上它」。只补自己那格（`command-http`），内核那几格原样保留
 */

export const name = 'gwb-command-http'

/** 缺哪个都不挂——inject 是 cordis 的等待机制，不是建议。settings 是硬依赖：端口从它来 */
export const inject = ['gwbCommands', 'gwbSettings']

/** 端口那一项设置的 key。改了要重启这个 home 才生效——口是 apply 时开的 */
const PORT_KEY = 'port'

/** 请求体的上限：调命令的 args 不该有 1MB，超了这一刀拒掉 */
const BODY_LIMIT = 1024 * 1024

/**
 * 报给 agent 的版本号：**本件自己的**。工具面是这个件渲染出来的，报「门是哪一版」。
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

/** 读一份请求体，超过上限当场拒 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
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
    title: 'HTTP 端口',
    type: 'number',
    default: defaultPort(home),
    description:
      'default home 认死 2870（被占就不开这道口，不退让）；其它 home 0 = 系统随机口，给了口被占就退让。改了要重启这个 home 才生效',
  })
  const choice = choosePort(home, ctx.gwbSettings.get(PORT_KEY))

  /**
   * 说明书清单那格。**局部注入,不写进 export const inject**:skills 件不在时这道门照开——
   * 清单不是它能不能干活的前提。effect 里上下线对称:skills 件停了/卸了置空,
   * 下一次 GET /surface 就不带清单
   */
  let skills: SkillsSlot | undefined
  ctx.inject(['gwbSkills'], (scoped) => {
    skills = scoped.gwbSkills
    // 门自己也带一份说明书（skills/ 目录得进 package.json 的 files）。register 回的
    // 注销函数交给 effect：skills 件停了/卸了，说明书跟着摘
    scoped.effect(() => scoped.gwbSkills.register(new URL('../skills/', import.meta.url)))
    scoped.effect(() => () => {
      skills = undefined
    })
  })

  /**
   * 执行口：agent 的调用一律留痕。命令自身失败（不存在、参数不对）不算门的错误——
   * 回 `{"ok":false,…}` 的 JSON、HTTP 200，agent 读得到原因；只有命令**抛出去**才落 500。
   * 写成箭头函数不是风格——`function` 声明会 hoist，TS 认为它可能在上面那句
   * `if (cli === undefined) return` 之前就被调用，于是不给 `cli` 保留窄化
   */
  const runCommand = async (command: string, args: unknown): Promise<unknown> => {
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
    return result
  }

  /** GET /surface：现拼。每次都现取命令注册表与说明书清单——热挂上来的件当场就在。
   * 带过滤时回执里带 `filter` 那格，自证这次筛了什么。箭头函数的理由同 runCommand：
   * function 声明会 hoist，TS 不给 `cli` 保留窄化 */
  const surfaceHandler = async (res: ServerResponse, query: SurfaceQuery): Promise<void> => {
    const commands = cli.list()
    const applied = [query.plugin, query.prefix, query.q, query.slim].filter((v) => v !== undefined)
    log.info(`agent 现扫了一遍表面（${commands.length} 条命令${applied.length > 0 ? '，带过滤' : ''}）`)
    sendJson(res, 200, buildSurface({ home, version, commands, skills: skills?.list(), query }))
  }

  /** POST /run：body {"command": 名字, "args": {...}}。args 原样递给命令——形状在命令描述里 */
  async function runHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: string
    try {
      body = await readBody(req)
    } catch {
      log.info('拒绝了一条请求：body 超 1MB（413）')
      sendJson(res, 413, { error: 'body too large' })
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      log.info('拒绝了一条请求：body 不是合法 JSON（400）')
      sendJson(res, 400, { error: 'bad json' })
      return
    }
    if (!isRecord(parsed) || typeof parsed.command !== 'string' || parsed.command === '') {
      sendJson(res, 400, { error: 'body 要是 {"command": 名字, "args": {...}}' })
      return
    }
    sendJson(res, 200, await runCommand(parsed.command, 'args' in parsed ? parsed.args : undefined))
  }

  const server = http.createServer((req, res) => {
    /**
     * **这里的 promise 必须有人接住**。漏成没人管的 rejection，整个工作台就靠内核那条
     * `process.on('unhandledRejection')` 兜着——它只记不退，可这一条本来就该在这儿接住，
     * 请求方等着一份回执。mcp 那条「一发错 token 的请求让宿主 code=1 退出」的墙就在这儿
     */
    void handle(req, res).catch((err: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
      else res.end()
      log.error(`${String(req.method)} ${String(req.url)} 处理异常：`, err)
    })
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const method = req.method ?? ''
    if (url.pathname === '/surface') {
      if (method !== 'GET') {
        res.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' })
        res.end()
        return
      }
      // 过滤参数收进来统一 trim，空串当没给——不为一个空参数筛出一张空表
      const query: SurfaceQuery = {}
      const plugin = url.searchParams.get('plugin')?.trim()
      if (plugin !== undefined && plugin !== '') query.plugin = plugin
      const prefix = url.searchParams.get('prefix')?.trim()
      if (prefix !== undefined && prefix !== '') query.prefix = prefix
      const q = url.searchParams.get('q')?.trim()
      if (q !== undefined && q !== '') query.q = q
      const slim = url.searchParams.get('slim')
      if (slim === 'true' || slim === '1') query.slim = true
      await surfaceHandler(res, query)
      return
    }
    if (url.pathname === '/run') {
      if (method !== 'POST') {
        res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
        res.end()
        return
      }
      await runHandler(req, res)
      return
    }
    sendJson(res, 404, { error: 'not found', routes: ['GET /surface', 'POST /run'] })
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
   * 那个处理器已经跑完，`http.info` 会拿到一句「原因未记下」
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
      log.info(`命令 HTTP 口就绪（${home} home）：${endpointUrl(p)}——无鉴权，绑 127.0.0.1 本机自用`)
      /**
       * 把这道口落进 home 的运行记录，**只在绑成了这一刻**：下游要的是「说出 home 名就
       * 连得上它」，而这个数运行时才定。没绑成不写——那时这个 home 上根本没有这道门，
       * 写一格假的比不写坏得多。
       *
       * **写失败不影响这道口**：记录是附属品，门照常服务。
       */
      try {
        writeRuntimeHttp(requireKernel(ctx).dataDir, { port: p, url: endpointUrl(p) })
      } catch (err) {
        log.warn(`运行记录 ${RUNTIME_FILE} 没写成（这道口照常服务）：${String(err)}`)
      }
    },
    (err: unknown) => {
      // 本件其它部分照常挂着，只是这道口没开——http.info 会把同一句话再说一遍
      log.error(
        home === DEFAULT_HOME
          ? `default home 的口 ${choice.port} 没开成，这次不开这道门。` +
              `**不退让到别的端口**：日常车道认死这个基址，退让等于把它送给占着口的那个 home。` +
              `腾开 ${choice.port} 再重启这个 home。原因：${String(err)}`
          : `${home} home 的口没开成（要的是 ${choice.port}）：${String(err)}`,
      )
    },
  )

  ctx.effect(() =>
    cli.register(
      {
        name: 'command-http.info',
        description: '命令 HTTP 口的连接信息（url + 两条 curl 例句，无鉴权本机自用）。无参数',
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
          return { ok: false, error: `命令口没在监听（${home} home 要的是 ${choice.port} 口）：${listenError ?? '原因未记下'}` }
        }
        const url = endpointUrl(live)
        return {
          ok: true,
          data: {
            url,
            port: live,
            example: {
              surface: `curl -s ${url}/surface`,
              run: `curl -s -X POST ${url}/run -d '{"command":"skill.list"}'`,
            },
          },
        }
      },
    ),
  )

  // 本件卸载时把 server 关干净
  ctx.effect(() => () => {
    server.closeAllConnections()
    server.close()
  })
}

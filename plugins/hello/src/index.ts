import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireKernel, type GwbContext } from '@godcreator02/gwb-plugin-api'
// 只为激活那几个件的 `declare module 'cordis'`——它们给 ctx 加上各自那个名字
import type {} from '@godcreator02/gwb-data'
import type {} from '@godcreator02/gwb-shell'
import type {} from '@godcreator02/gwb-skills'
import type {} from '@godcreator02/gwb-node-cli'
import type {} from '@godcreator02/gwb-py-cli'
import type {} from '@godcreator02/gwb-commands'

/**
 * node 半：拿 data 件存一份计数，每次启动 +1；往外壳注册**两格**窗格、报一下自己叫什么；
 * 再把自己那**一 node 一 python 两条 CLI** 登记给两个运行器。
 *
 * 这个件是**验收件**，它的活就是把链路走一遍给人看：浏览器那半验运行时环境与样式，
 * node 这半验数据落盘与窗格注册——读回上次写的值就说明真的落了盘、也真的认出了
 * 「我是谁」；注册那两格出现在 `shell.panes` 的回执里，就说明服务真从 fiber 上认出了
 * 注册方的条目与包名。
 *
 * 两格是**故意**的：`main` 只能开一份，`counter` 声明了 `duplicable`——一个件同时验
 * 「几格各画各的」与「同一格开两份互不干扰」这两件事。
 */
export const name = 'gwb-hello'

/** 本文件住 `<包根>/dist/index.js`，上一级就是包根 */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/**
 * node CLI 的入口。**吃的是 `dist/` 里的编译产物，不是 `src/` 里的源**——
 * 而且必须是绝对路径，相对路径运行器当场拒
 */
const NODE_CLI_ENTRY = path.join(PACKAGE_ROOT, 'dist', 'cli.js')
/** 浏览器半与样式表的地址，注册窗格时报给外壳。dist/ 下三个文件是邻居，从本模块算 */
const CLIENT_URL = new URL('./client.js', import.meta.url).href
const STYLE_URL = new URL('./style.css', import.meta.url).href

/** 缺哪个都不挂——inject 是 cordis 的等待机制，不是建议 */
export const inject = ['gwbData', 'gwbShell', 'gwbCommands']

interface Probe {
  runs?: number
  at?: string
}

export function apply(ctx: GwbContext): void {
  // 件说话的正规出口。裸 console 那阵子它只进得了文件、进不了窗格——样板得带好这个头
  const log = ctx.logger(name)
  // 注册在 apply 里,同步的。身份不用报——服务从 fiber 上认。也不用自己包 effect,
  // 本件卸载时这两格自动从表上摘掉
  ctx.gwbShell.registerPane({ id: 'main', title: '验收件', icon: 'flask-conical', client: CLIENT_URL, style: STYLE_URL })
  // **声明 duplicable 的那一格**:它每一份自己一个本地计数,开两份互不干扰
  ctx.gwbShell.registerPane({
    id: 'counter',
    title: '计数器',
    icon: 'hash',
    duplicable: true,
    client: CLIENT_URL,
    style: STYLE_URL,
  })
  ctx.gwbShell.describeSelf({ title: '验收件', icon: 'flask-conical' })
  log.info('注册了两格（main、counter）并报了名字')

  // 读盘 +1、写盘、回新值。启动探针与 hello.bump 命令走同一条路
  const report = async (): Promise<Probe> => {
    const before = (await ctx.gwbData.readDoc('probe')) as Probe | undefined
    const runs = (before?.runs ?? 0) + 1
    // 本地时间，sv-SE 的格式正好是「YYYY-MM-DD HH:mm:ss」；toISOString 是 UTC，看着像少了八小时
    const at = new Date().toLocaleString('sv-SE')
    await ctx.gwbData.writeDoc('probe', { runs, at })
    return { runs, at }
  }

  // 这条链上的错必须有出口:apply 是同步的,里头的 async 一旦静默 reject,
  // 现象就是「件挂上了但什么都没发生」——查起来毫无线索
  void (async () => {
    log.info(`gwbData = ${typeof ctx.gwbData}，dir = ${ctx.gwbData?.dir ?? '取不到'}`)
    const probe = await report()
    log.info(`data 通了：这是第 ${probe.runs} 次启动`)
    log.info(`home=${requireKernel(ctx).dataDir}`)
  })().catch((err: unknown) => {
    log.error(`data 探针失败：${err instanceof Error ? err.stack : String(err)}`)
  })

  // 探针数据的取数口。窗格那半与 agent（经 MCP）都走这两条：读回上次写的值就说明
  // 真的落了盘。
  const cli = ctx.gwbCommands
  // inject 保证了它在，这句只是把类型收窄。**两条都包 ctx.effect**：gwbCommands.register
  // 回的是注销函数，不包的话条目停了、fiber 灭了，名字还留在表上（2026-09-09 撞过，见文档站）
  if (cli !== undefined) {
    ctx.effect(() =>
      cli.register({ name: 'hello.probe', description: '读启动探针文档。无参数', plugin: name }, async () =>
        ctx.gwbData.readDoc('probe'),
      ),
    )
    ctx.effect(() =>
      cli.register({ name: 'hello.bump', description: '启动次数 +1，写盘回新值。无参数', plugin: name }, () => report()),
    )
  }

  // 说明书那一格。**局部注入,不写进 export const inject**:写进去,这个件在没装
  // skills 件的 home 里就整个挂不上了——而说明书不是它能不能干活的前提。
  // 产物在 dist/ 下,所以包根的 skills/ 是 '../skills/';那个目录得进 package.json 的 files
  ctx.inject(['gwbSkills'], (scoped) => {
    scoped.effect(() => scoped.gwbSkills.register(new URL('../skills/', import.meta.url)))
  })

  // 两条 CLI，同样是局部注入——**cordis 的 inject 全是硬依赖，没有可选形式**，
  // 「可选」靠的就是这一句开出来的子 fiber:缺服务时它自己永远 PENDING，
  // 而本件照常挂上、两格窗格照常画，界面上那两颗按钮置灰。
  //
  // 两个 register 都**不用自己包 effect**:运行器内部已经挂在调用方的 effect 上了
  // （跟 registerPane 一个待遇,跟上面 gwbSkills.register 与 gwbCommands.register 不一样——那两个要自己包）
  ctx.inject(['gwbNodeCli', 'gwbPyCli'], (scoped) => {
    scoped.gwbNodeCli.register({
      name: 'hello.node',
      description: '本件的 node CLI（dist/cli.js 是 tsc 编译产物）',
      entry: NODE_CLI_ENTRY,
    })
    // distName / version / command 三处要跟 py/pyproject.toml 对得上,
    // 对不上时症状是「venv 建好了但守卫说版本不对」。tests/artifact.test.ts 钉着这三处
    scoped.gwbPyCli.register({
      name: 'hello.python',
      description: '本件的 python CLI（venv 由守卫建在包根的 py/ 下）',
      packageRoot: PACKAGE_ROOT,
      distName: 'gwb-hello-py',
      version: '0.0.1',
      command: 'gwb-hello-py',
    })
    log.info('两条 CLI 登记好了（hello.node、hello.python）')
  })
}

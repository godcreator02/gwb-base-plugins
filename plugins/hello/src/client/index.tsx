import { useEffect, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Button } from '@/components/ui/button'

/**
 * 浏览器半——**两格窗格**（不再是整页外壳）。`mountPane` 按 `args.pane.id` 分派。
 *
 * 验的是这么几样：裸名 import 经页面 importmap 解析得到、自己那张表经 gwb:// 拿得到、
 * scope 生效、两张注册表过得了桥、**几格各画各的**、**同一格开两份互不干扰**，
 * 外加**跑得起本件自带的那两条 CLI**（一 node 一 python）并把回执显出来。
 *
 * **亮暗那颗按钮挪到状态栏去了**：它改的是 `html.dark`、影响整页，本来就该归外壳。
 * 「切换当场变色而不重新构建」那条验收因此也归那边。
 *
 * **样式与 scope 属性都不归这儿管了**：外壳的 `PluginPane` 在 import 这个束之前就把
 * `style.css` 注好、把 `data-gwb-plugin` 挂在容器上了。令牌表更是页面级的一份，
 * 由外壳注。窗格件只管画自己那一格。
 */

/** 外壳交出来的两条取表命令。这儿不 import shell 的常量：那是 node 半的包,浏览器半不牵它 */
const PANES_COMMAND = 'shell.panes'
const PLUGINS_COMMAND = 'shell.plugins'

/** 本件那两条 CLI。名字跟 node 半登记的那两条对得上,同样不 import 过来 */
const NODE_CLI_COMMAND = 'hello.node'
const PY_CLI_COMMAND = 'hello.python'

/** 格间总线上那个打招呼的事件名。两格约好的,外壳不认识它 */
const HELLO_EVENT = 'hello:wave'

/**
 * 外壳调 `mountPane` 时给的那几样。**按形状收**，不牵 shell 那个包的类型——那是 node
 * 半的包，浏览器半不该为一个接口把它拖进来。
 */
interface PaneArgs {
  host: { call: (command: string, args?: unknown) => Promise<unknown> }
  shell: {
    openPane: (paneId: string, options?: { duplicate?: boolean }) => void
    bus: {
      emit: (type: string, detail?: unknown) => void
      on: (type: string, listener: (detail: unknown) => void) => () => void
    }
  }
  pane: {
    /** 这一格是本件的哪一格 */
    id: string
    /** 这**一份**的唯一键。开两份时两份的这个值不一样 */
    instance: string
  }
}

/** 注册表里一条过桥之后的样子。按形状收，不牵 shell 那个包的类型 */
interface PaneRow {
  entryId: string
  pkg: string
  id: string
  title: string
  icon?: string
  duplicable?: boolean
}

interface PluginRow {
  entryId: string
  pkg: string
  title: string
  icon?: string
}

/**
 * 取一次表。**取不到回 undefined 而不是空表**：拿空表顶上去的话，「命令没挂上」
 * 跟「一条都没注册」在页面上长得一模一样。
 */
async function fetchTable<T>(host: PaneArgs['host'], command: string): Promise<T[] | undefined> {
  try {
    const reply = (await host.call(command)) as { ok?: boolean; data?: unknown; error?: string }
    if (reply.ok !== true || !Array.isArray(reply.data)) {
      console.error(`[hello] ${command} 没回一张表：${reply.error ?? JSON.stringify(reply)}`)
      return undefined
    }
    return reply.data as T[]
  } catch (err) {
    console.error(`[hello] ${command} 调不通：${String(err)}`)
    return undefined
  }
}

/**
 * 跑一条 CLI 之后拿到的东西。按形状收，不牵那两个运行器包的类型——它们是 node 半的包。
 *
 * **命令总线不会把它包进 `{ ok, data }`**：总线的规矩是「handler 自己判过成败就原样
 * 透传」，判据是回值上有没有 `ok` 字段——而这份回执正好自带一个。所以这儿收到的就是
 * 它本身，跟上面 `fetchTable` 那条路不一样，别照抄那边的解包。
 */
interface CliRunResult {
  ok: boolean
  exitCode: number | null
  timedOut: boolean
  timeoutMs: number
  durationMs: number
  stdout: { text: string; truncated: boolean; spillPath?: string }
  stderr: { text: string; truncated: boolean; spillPath?: string }
}

/** 一次运行的展示态：要么拿到回执，要么连命令都没调通（没注册、venv 没就绪之类）*/
interface CliShot {
  command: string
  args: readonly string[]
  result?: CliRunResult
  error?: string
}

async function runCli(host: PaneArgs['host'], command: string, args: readonly string[]): Promise<CliShot> {
  try {
    const reply = (await host.call(command, args)) as Partial<CliRunResult> & { error?: string }
    // 有 stdout 就是运行器的回执;只有 ok/error 的那种是总线自己回的
    // （「没有这条命令」，或者 handler 抛了——python 那半 venv 没就绪就走这条）
    if (!('stdout' in reply)) return { command, args, error: reply.error ?? JSON.stringify(reply) }
    return { command, args, result: reply as CliRunResult }
  } catch (err) {
    return { command, args, error: String(err) }
  }
}

function Empty({ what }: { what: string }): ReactElement {
  return <p className="text-sm text-muted-foreground">{what}</p>
}

/** 两条 CLI 各跑一趟，外加一条注定失败的——验退出码真能原样带回界面 */
function CliBlock({ args }: { args: PaneArgs }): ReactElement {
  const [shot, setShot] = useState<CliShot | undefined>()
  const [busy, setBusy] = useState(false)

  const fire = (command: string, cliArgs: readonly string[]): void => {
    setBusy(true)
    void runCli(args.host, command, cliArgs).then((next) => {
      setShot(next)
      setBusy(false)
    })
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 text-card-foreground">
      <p className="text-sm font-semibold">两条 CLI（本件自带，一 node 一 python）</p>
      <p className="text-sm text-muted-foreground">
        node 那条跑的是 <span className="font-mono">dist/cli.js</span>——tsc 编译产物；python
        那条跑包根 <span className="font-mono">py/.venv</span> 里的入口点垫片，那个 venv 由守卫现建。
      </p>

      <div className="flex flex-wrap gap-3">
        <Button data-probe="run-node" disabled={busy} onClick={() => fire(NODE_CLI_COMMAND, ['来自界面'])}>
          跑 node CLI
        </Button>
        <Button
          data-probe="run-python"
          variant="secondary"
          disabled={busy}
          onClick={() => fire(PY_CLI_COMMAND, ['来自界面'])}
        >
          跑 python CLI
        </Button>
        <Button
          data-probe="run-fail"
          variant="outline"
          disabled={busy}
          onClick={() => fire(NODE_CLI_COMMAND, ['--fail'])}
        >
          跑一条注定失败的
        </Button>
      </div>

      {shot === undefined ? (
        <Empty what={busy ? '跑着呢……' : '还没跑过。点上面任意一颗。'} />
      ) : (
        <CliShotView shot={shot} />
      )}
    </div>
  )
}

function CliShotView({ shot }: { shot: CliShot }): ReactElement {
  const { result } = shot
  return (
    <div className="space-y-2" data-probe="cli-out">
      <p className="font-mono text-xs text-muted-foreground">
        {shot.command} {shot.args.join(' ')}
      </p>
      {result === undefined ? (
        // 调不通跟「跑了但失败了」是两回事,分开显示——前者多半是件没装或 venv 没就绪
        <p className="text-sm text-destructive" data-probe="cli-error">
          调不通：{shot.error}
        </p>
      ) : (
        <>
          <p className="font-mono text-xs" data-probe="cli-meta">
            {`exitCode=${String(result.exitCode)} ok=${String(result.ok)} ${
              result.timedOut ? '超时 ' : ''
            }${String(result.durationMs)}ms`}
          </p>
          {result.stdout.text === '' ? null : (
            <pre
              className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap"
              data-probe="cli-stdout"
            >
              {result.stdout.text}
            </pre>
          )}
          {result.stderr.text === '' ? null : (
            <pre
              className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap text-destructive"
              data-probe="cli-stderr"
            >
              {result.stderr.text}
            </pre>
          )}
        </>
      )}
    </div>
  )
}

function PaneTable({ panes }: { panes: PaneRow[] | undefined }): ReactElement {
  if (panes === undefined) return <Empty what="窗格表取不到——看 console 那条错。" />
  if (panes.length === 0) return <Empty what="注册表是空的：没有件注册过窗格。" />
  return (
    <ul className="space-y-1 text-sm">
      {panes.map((p) => (
        <li key={`${p.entryId}:${p.id}`} className="font-mono">
          {`plugin:${p.entryId}:${p.id}`} — {p.title}
          {p.duplicable === true ? ' ×N' : ''} — <span className="text-muted-foreground">{p.pkg}</span>
        </li>
      ))}
    </ul>
  )
}

function PluginTable({ plugins }: { plugins: PluginRow[] | undefined }): ReactElement {
  if (plugins === undefined) return <Empty what="件表取不到——看 console 那条错。" />
  if (plugins.length === 0) return <Empty what="没有件报过名字。" />
  return (
    <ul className="space-y-1 text-sm">
      {plugins.map((p) => (
        <li key={p.entryId} className="font-mono">
          {p.entryId} — {p.title}
          {p.icon === undefined ? '' : ` (${p.icon})`} — <span className="text-muted-foreground">{p.pkg}</span>
        </li>
      ))}
    </ul>
  )
}

/** `main` 那一格：验样式、验两张表、跑那两条 CLI、给出开另一格的三个入口 */
function MainPane({ args }: { args: PaneArgs }): ReactElement {
  const [panes, setPanes] = useState<PaneRow[] | undefined>()
  const [plugins, setPlugins] = useState<PluginRow[] | undefined>()

  useEffect(() => {
    let alive = true
    void (async () => {
      const [p, g] = await Promise.all([
        fetchTable<PaneRow>(args.host, PANES_COMMAND),
        fetchTable<PluginRow>(args.host, PLUGINS_COMMAND),
      ])
      if (!alive) return
      setPanes(p)
      setPlugins(g)
    })()
    return () => {
      alive = false
    }
  }, [args.host])

  return (
    <div className="h-full space-y-6 overflow-auto p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">gwb 验收件</h1>
        <p className="text-sm text-muted-foreground">
          这一格的类名全由本件自己那张表提供，颜色取自共享的那份令牌。
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button>默认</Button>
        <Button variant="secondary">次要</Button>
        <Button variant="destructive">危险</Button>
        <Button variant="outline">描边</Button>
        <Button variant="ghost">幽灵</Button>
        <Button variant="link">链接</Button>
      </div>

      <div className="rounded-lg border bg-card p-4 text-card-foreground">
        <p className="text-sm">这块是 bg-card——它跟页面底色差一档，换主题时两个一起变。</p>
      </div>

      <div className="space-y-2 rounded-lg border bg-card p-4 text-card-foreground">
        <p className="text-sm font-semibold">窗格注册表（{PANES_COMMAND}）</p>
        <PaneTable panes={panes} />
      </div>

      <div className="space-y-2 rounded-lg border bg-card p-4 text-card-foreground">
        <p className="text-sm font-semibold">件表（{PLUGINS_COMMAND}）</p>
        <PluginTable plugins={plugins} />
      </div>

      <CliBlock args={args} />

      <div className="flex flex-wrap gap-3">
        <Button data-probe="open-counter" onClick={() => args.shell.openPane('counter')}>
          打开计数器
        </Button>
        <Button
          data-probe="dup-counter"
          variant="secondary"
          onClick={() => args.shell.openPane('counter', { duplicate: true })}
        >
          再开一份计数器
        </Button>
        <Button
          data-probe="dup-main"
          variant="outline"
          onClick={() => args.shell.openPane('main', { duplicate: true })}
        >
          再开一份「验收件」（开不出来，它没声明 duplicable）
        </Button>
        <Button
          data-probe="wave"
          variant="secondary"
          onClick={() => args.shell.bus.emit(HELLO_EVENT, { at: Date.now() })}
        >
          朝总线喊一嗓子
        </Button>
      </div>
    </div>
  )
}

/**
 * `counter` 那一格：**每一份自己一个本地计数**。
 *
 * 开两份、各点各的，两个数字对不上就说明它们是两棵独立的 React 树、`mountPane` 真的
 * 跑了两次。而 `main` 喊一嗓子时**两份同时**加一——那说明格间总线的桶按条目分，
 * 重复实例落在同一个桶里。
 */
function CounterPane({ args }: { args: PaneArgs }): ReactElement {
  const [count, setCount] = useState(0)
  const [waves, setWaves] = useState<{ n: number; at: string }>({ n: 0, at: '' })

  useEffect(() => {
    return args.shell.bus.on(HELLO_EVENT, () => {
      setWaves((prev) => ({ n: prev.n + 1, at: new Date().toLocaleTimeString('zh-CN') }))
    })
  }, [args.shell])

  return (
    <div className="h-full space-y-4 overflow-auto p-8">
      <h1 className="text-xl font-semibold">计数器</h1>
      <p className="font-mono text-xs text-muted-foreground" data-probe="instance">
        {args.pane.instance}
      </p>

      <div className="flex items-center gap-3">
        <Button data-probe="bump" onClick={() => setCount((n) => n + 1)}>
          +1
        </Button>
        <span className="font-mono text-2xl" data-probe="count">
          {count}
        </span>
      </div>

      <div className="rounded-lg border bg-card p-4 text-card-foreground">
        <p className="text-sm" data-probe="waves">
          {waves.n === 0 ? '还没收到过喊话' : `收到 main 喊话 ${String(waves.n)} 次，最后一次 ${waves.at}`}
        </p>
      </div>
    </div>
  )
}

async function boot(args: PaneArgs, container: HTMLElement): Promise<Root> {
  const root = createRoot(container)
  // **认不出的 paneId 报错，不回落到 main**：「注册了 counter 却画出 main」是那种
  // 没有任何现象的错，而分派表与注册那两行必须一一对上
  if (args.pane.id === 'main') root.render(<MainPane args={args} />)
  else if (args.pane.id === 'counter') root.render(<CounterPane args={args} />)
  else root.render(<p className="p-3 text-sm text-destructive">本件没有叫 {args.pane.id} 的窗格</p>)
  return root
}

/**
 * 窗格件那半的入口。**导出名是 `mountPane` 不是 `bootShell`**——外壳占的是整页那个根，
 * 窗格占的是井里一格，两个角色各用各的动词，单看导出名就知道自己是哪种件。
 *
 * **回一个 `{ dispose }`**：关掉这一格时外壳会调它，这棵 React 树得有人拆。拿不到
 * 它外壳会当场报契约不符，不装作成功。
 */
export function mountPane(args: PaneArgs, container: HTMLElement): { dispose(): void } {
  const mounted = boot(args, container).catch((err: unknown) => {
    container.textContent = `验收件起不来：${String(err)}`
    return undefined
  })
  return {
    dispose() {
      // 挂载是异步的：dispose 可能赶在它之前，所以接在同一条链上而不是拿个变量去猜
      void mounted.then((root) => root?.unmount())
      container.textContent = ''
    },
  }
}

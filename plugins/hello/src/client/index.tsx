import { useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Button } from '@/components/ui/button'

/**
 * 浏览器半——**一格窗格**（不再是整页外壳）。验的是五样：裸名 import 经页面 importmap
 * 解析得到、自己那张表经 gwb:// 拿得到、scope 生效、亮暗切换当场变色而不重新构建任何
 * 东西，外加**窗格注册表过得了桥**——node 那半注册的那一格，经 `shell.panes` 这条命令
 * 原样到得了这边。
 *
 * **样式与 scope 属性都不归这儿管了**：外壳的 `PluginPane` 在 import 这个束之前就把
 * `style.css` 注好、把 `data-gwb-plugin` 挂在容器上了。令牌表更是页面级的一份，
 * 由外壳注。窗格件只管画自己那一格。
 */

/** 外壳交出来的取表命令。这儿不 import shell 的常量：那是 node 半的包,浏览器半不牵它 */
const PANES_COMMAND = 'shell.panes'

/** 注册表里一条过桥之后的样子。按形状收，不牵 shell 那个包的类型 */
interface PaneRow {
  entryId: string
  pkg: string
  id: string
  title: string
  icon?: string
}

/** 表过来了没有：`undefined` 是还没到手 / 取不到，跟「表是空的」不是一回事 */
function PaneTable({ panes }: { panes: PaneRow[] | undefined }): ReactElement {
  if (panes === undefined) {
    return <p className="text-sm text-muted-foreground">窗格表取不到——看 console 那条错。</p>
  }
  if (panes.length === 0) {
    return <p className="text-sm text-muted-foreground">注册表是空的：没有件注册过窗格。</p>
  }
  return (
    <ul className="space-y-1 text-sm">
      {panes.map((p) => (
        <li key={`${p.entryId}:${p.id}`} className="font-mono">
          {`plugin:${p.entryId}:${p.id}`} — {p.title}
          {p.icon === undefined ? '' : ` (${p.icon})`} — <span className="text-muted-foreground">{p.pkg}</span>
        </li>
      ))}
    </ul>
  )
}

function App({ panes }: { panes: PaneRow[] | undefined }): ReactElement {
  const [dark, setDark] = useState(false)
  const toggle = (): void => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
  }

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

      <Button variant="outline" onClick={toggle}>
        切到{dark ? '亮色' : '暗色'}
      </Button>
    </div>
  )
}

/**
 * 外壳调 `mountPane` 时给的那几样。**按形状收**，不牵 shell 那个包的类型——那是 node
 * 半的包，浏览器半不该为一个接口把它拖进来。
 */
interface PaneArgs {
  host: { call: (command: string, args?: unknown) => Promise<unknown> }
  /** 这一格是本件的哪一格（注册时给的那个 id）。本件只注册了一格，所以还没用上 */
  pane: { id: string }
}

/**
 * 取一次注册表。**取不到回 undefined 而不是空表**：拿空表顶上去的话，「命令没挂上」
 * 跟「一个件都没注册」在页面上长得一模一样。
 */
async function fetchPanes(host: PaneArgs['host']): Promise<PaneRow[] | undefined> {
  try {
    const reply = (await host.call(PANES_COMMAND)) as { ok?: boolean; data?: unknown; error?: string }
    if (reply.ok !== true || !Array.isArray(reply.data)) {
      console.error(`[hello] ${PANES_COMMAND} 没回一张表：${reply.error ?? JSON.stringify(reply)}`)
      return undefined
    }
    return reply.data as PaneRow[]
  } catch (err) {
    console.error(`[hello] ${PANES_COMMAND} 调不通：${String(err)}`)
    return undefined
  }
}

async function boot(args: PaneArgs, container: HTMLElement): Promise<Root> {
  const panes = await fetchPanes(args.host)
  const root = createRoot(container)
  root.render(<App panes={panes} />)
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

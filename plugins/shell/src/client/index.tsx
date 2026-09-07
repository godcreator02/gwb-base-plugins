import { type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewPanelProps,
} from 'dockview-react'
import { PluginPane } from './PluginPane.js'
import { assetUrl, loadStyle } from './asset.js'
import { listOpenable, type OpenableSpec } from '../openable.js'
import { PLUGIN_COMPONENT } from '../panels.js'
import type { HostBridge, PaneRow, ShellArgs } from './types.js'

/**
 * 外壳的浏览器半：一口 dockview 窗格井，把注册表里的每一格开出来。
 *
 * 第三刀只到这儿——**没有导航、没有状态栏、布局不落盘**（那三样是第四刀）。所以默认
 * 布局就是「表里有几格开几格」，没有「上次摆成什么样」要恢复。
 */

const SELF = '@godcreator02/gwb-shell'
const TOKENS = '@godcreator02/gwb-tokens'
const PANES_COMMAND = 'shell.panes'

/**
 * 主题类，**两个一起挂**：前者是 dockview 自带的一整套默认值（尺寸、圆角、z-index，
 * 那 60 多个跟颜色无关的变量），后者只覆盖配色、把它们接到令牌上。它俩特异性相同，
 * 我们那张表拼在 dockview 原表后面，所以覆盖生效。
 *
 * **亮暗不靠换这个类**——值全是 `var(--…)`，令牌自己会跟着 `html.dark` 变，所以基底
 * 固定用 light 那套，dockview 内置的 dark 一次都用不上。
 */
const THEME_CLASSES = ['dockview-theme-light', 'dockview-theme-gwb']

/**
 * **必须经 `theme` 选项交给 dockview**，光挂在 `<html>` 上没用：dockview 自己会把
 * 主题类名写到它内部的 `.dv-shell` 上（不给就是默认的 `dockview-theme-abyss`），
 * 那一层比 `<html>` 近，把我们的值整个压掉——症状是井底一片深蓝黑，而 `<html>` 上读
 * `--dv-group-view-background-color` 明明是对的。这是实机撞出来的。
 *
 * `className` 那边是 `split(' ')` 收的，所以一个字段塞得下两个类。
 */
const GWB_THEME: DockviewTheme = {
  name: 'gwb',
  className: THEME_CLASSES.join(' '),
  colorScheme: 'light',
}

/**
 * 内核交出来的命令口。**存在模块级而不是经 params 传**：面板组件表必须是模块级常量
 * （换引用会让 dockview 重建全部格），组件因此拿不到 `bootShell` 的闭包；而塞进
 * `params` 会跟着布局一起落盘，第四刀就得在序列化时把它挑出去。
 *
 * 一扇窗只有一个外壳，`bootShell` 只调一次——这个变量因此不会有第二个写者。
 */
let hostBridge: HostBridge | undefined

interface PluginParams {
  pluginKey: string
  entryId: string
  paneId: string
}

/**
 * 面板组件表。**必须是模块级常量**：dockview 拿它的引用做比对，每轮渲染换一个新对象
 * 会让它把所有格拆了重建。
 */
const COMPONENTS: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  [PLUGIN_COMPONENT]: (props: IDockviewPanelProps) => {
    const params = props.params as Partial<PluginParams> | undefined
    const pluginKey = params?.pluginKey
    const paneId = params?.paneId
    if (typeof pluginKey !== 'string' || typeof paneId !== 'string' || hostBridge === undefined) {
      // 这一格的 params 是外壳自己按 openable 拼的，缺项属于外壳的 bug。摆出来而不是
      // 画个空白——空白跟「件加载慢」分不开
      return <p className="text-destructive m-0 p-3 text-sm">这一格缺 params（外壳的 bug）</p>
    }
    return <PluginPane pluginKey={pluginKey} paneId={paneId} host={hostBridge} />
  },
}

function App({ specs }: { specs: OpenableSpec[] }): ReactElement {
  const onReady = (event: DockviewReadyEvent): void => {
    for (const spec of specs) {
      event.api.addPanel({
        id: spec.id,
        component: spec.component,
        title: spec.title,
        params: spec.params,
      })
    }
  }
  // fixed inset-0 而不是 h-screen:#root 没有高度样式,而外壳不该去改宿主那张 html
  return (
    <div className="fixed inset-0">
      <DockviewReact components={COMPONENTS} onReady={onReady} theme={GWB_THEME} />
    </div>
  )
}

/**
 * 取一次注册表。**取不到回空表并记一条错**：外壳照样画出空井，因为「一个件都没注册」
 * 本来就是合法状态，而井在不在跟表取没取到是两回事。
 */
async function fetchPanes(host: HostBridge): Promise<PaneRow[]> {
  try {
    const reply = (await host.call(PANES_COMMAND)) as { ok?: boolean; data?: unknown; error?: string }
    if (reply.ok !== true || !Array.isArray(reply.data)) {
      console.error(`[shell] ${PANES_COMMAND} 没回一张表：${reply.error ?? JSON.stringify(reply)}`)
      return []
    }
    return reply.data as PaneRow[]
  } catch (err) {
    console.error(`[shell] ${PANES_COMMAND} 调不通：${String(err)}`)
    return []
  }
}

async function boot(args: ShellArgs, root: HTMLElement): Promise<Root> {
  hostBridge = args.host
  // 三张表都等到位再渲染：令牌是值的来源（页面级，件不用自己注）、dockview 那张不 scope
  // （它管的 DOM 类名不经我们的手，而且门户元素在 body 下）、外壳自己那张 scope 过
  await Promise.all([
    loadStyle(assetUrl(TOKENS, 'theme.css')),
    loadStyle(assetUrl(SELF, 'dockview.css')),
    loadStyle(assetUrl(SELF, 'style.css')),
  ])
  // `<html>` 上这份是**兜底**：真正生效的是上面那个 theme 选项（dockview 把类写在
  // 它自己的 .dv-shell 上）。留着这份是给可能挂到 `body` 下的门户元素——多挂一个只
  // 定义变量的类代价是零,漏了的话那些元素一片没样式,而且要拖起来才发现
  document.documentElement.classList.add(...THEME_CLASSES)
  // 外壳自己的表 scope 在这个属性之下。井里每一格的件容器另挂它自己的那个
  root.setAttribute('data-gwb-plugin', SELF)

  const panes = await fetchPanes(args.host)
  // 第三刀没有导航,把它从表里滤掉——listOpenable 排的第一条是导航那格,而画它的组件
  // 第四刀才有。留着的话 dockview 会拿不到 'nav' 组件
  const specs = listOpenable(panes).filter((s) => s.component === PLUGIN_COMPONENT)
  console.log(`[shell] 开 ${specs.length} 格：${specs.map((s) => s.id).join('、') || '（表是空的）'}`)

  const reactRoot = createRoot(root)
  reactRoot.render(<App specs={specs} />)
  return reactRoot
}

/**
 * 外壳这一半的入口。**回一个 `{ dispose }`**：这个件被卸载时，页面上这棵树得有人拆。
 * 渲染层眼下还不会调它，但契约面先立在这儿。
 */
export function bootShell(args: ShellArgs, root: HTMLElement): { dispose(): void } {
  const mounted = boot(args, root).catch((err: unknown) => {
    root.textContent = `外壳起不来：${String(err)}`
    return undefined
  })
  return {
    dispose() {
      // 挂载是异步的：dispose 可能赶在它之前，所以接在同一条链上而不是拿个变量去猜
      void mounted.then((reactRoot) => reactRoot?.unmount())
      document.documentElement.classList.remove(...THEME_CLASSES)
      root.removeAttribute('data-gwb-plugin')
      root.textContent = ''
      hostBridge = undefined
    },
  }
}

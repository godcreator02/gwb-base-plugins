import { type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewPanelProps,
} from 'dockview-react'
import { PluginPane } from './PluginPane.js'
import { assetUrl, loadStyle } from './asset.js'
import { listOpenable, planOpen, specForOwnPane, titleForOrdinal, uniquePanelId, type OpenableSpec } from '../openable.js'
import { PLUGIN_COMPONENT } from '../panels.js'
import type { HostBridge, PaneRow, ShellArgs, ShellBridge } from './types.js'

/**
 * 外壳的浏览器半：一口 dockview 窗格井，把注册表里的每一格开出来。
 *
 * 第三刀半到这儿——**没有导航、没有状态栏、布局不落盘**（那三样是第四刀）。所以默认
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
 * **只剩这一样**：dockview 的 api 走面板组件自己的 `props.containerApi`，注册表
 * 每次开格现取（表是会变的——件挂上/卸掉都改它，存一份快照迟早过期）。
 */
let hostBridge: HostBridge | undefined

interface PluginParams {
  pluginKey: string
  entryId: string
  paneId: string
}

/** 这个 id 在井里已经有格了吗。`planOpen` 与 `addInstance` 同吃这一处 */
function takenIn(api: DockviewApi): (id: string) => boolean {
  return (id) => api.getPanel(id) !== undefined
}

/**
 * 开一格：算出这一份的实例 id 再 `addPanel`。
 *
 * **`addPanel` 撞已存在的 id 是同步抛 Error**（dockview 的 `_doAddPanel` 头一句就是
 * 这个守卫），所以 id 必须先算好——不能指望它回一个「已经有了」。`taken` 问的是
 * dockview 当下真有哪些格，因此第四刀恢复落盘布局之后再开也不会撞。
 */
function addInstance(api: DockviewApi, spec: OpenableSpec): void {
  const { id, ordinal } = uniquePanelId(spec.id, takenIn(api))
  api.addPanel({
    id,
    component: spec.component,
    title: titleForOrdinal(spec.title, ordinal),
    params: spec.params,
  })
}

/**
 * 件说「打开我的某一格」。判断全在 `planOpen` 那个纯函数里，这儿只按 kind 分派。
 *
 * `entryId` 由 `PluginPane` 那边闭包绑好，件报不出别人的条目，也就打不开别人的窗格。
 *
 * **表现取不用快照**：件是热挂载的，后挂上的件手上那份快照里没有它自己。取表是一次
 * 本地 IPC，而调用方全是 click 回调、没人等返回值。
 *
 * `await` 之后**算 id 与 addPanel 必须在同一个同步段里**：中间再插一次 await 的话，
 * 两次并发的 openPane 会算出同一个 id，第二个 addPanel 当场抛。
 */
async function openOwnPane(
  api: DockviewApi,
  host: HostBridge,
  who: { entryId: string; paneId: string },
  options: { duplicate?: boolean } | undefined,
): Promise<void> {
  const panes = await fetchPanes(host)
  const plan = planOpen(specForOwnPane(panes, who.entryId, who.paneId), options, takenIn(api), who)
  if (plan.kind !== 'open' && plan.notice !== undefined) console.warn(`[shell] ${plan.notice}`)
  if (plan.kind === 'none') return
  if (plan.kind === 'focus') {
    api.getPanel(plan.id)?.api.setActive()
    return
  }
  api.addPanel({
    id: plan.id,
    component: plan.spec.component,
    title: plan.title,
    params: plan.spec.params,
    // **重复那份摆到右边**：不给 position 的话它落进当前 group 当兄弟 tab，
    // 一开就把第一份盖住了——而「两份同时看得见」正是多实例唯一能眼见为实的地方
    ...(plan.id === plan.spec.id ? {} : { position: { direction: 'right' as const } }),
  })
}

/**
 * 面板组件表。**必须是模块级常量**：dockview 拿它的引用做比对，每轮渲染换一个新对象
 * 会让它把所有格拆了重建。
 */
const COMPONENTS: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  [PLUGIN_COMPONENT]: (props: IDockviewPanelProps) => {
    const params = props.params as Partial<PluginParams> | undefined
    const pluginKey = params?.pluginKey
    const entryId = params?.entryId
    const paneId = params?.paneId
    if (
      typeof pluginKey !== 'string' ||
      typeof entryId !== 'string' ||
      typeof paneId !== 'string' ||
      hostBridge === undefined
    ) {
      // 这一格的 params 是外壳自己按 openable 拼的，缺项属于外壳的 bug。摆出来而不是
      // 画个空白——空白跟「件加载慢」分不开
      return <p className="text-destructive m-0 p-3 text-sm">这一格缺 params（外壳的 bug）</p>
    }
    const bridge = hostBridge
    const openPane: ShellBridge['openPane'] = (target, options) => {
      // 件不等返回值（它是 click 回调），但这条链上的错得有出口
      void openOwnPane(props.containerApi, bridge, { entryId, paneId: target }, options).catch((err: unknown) => {
        console.error(`[shell] 开 ${target} 失败：${String(err)}`)
      })
    }
    return (
      <PluginPane
        pluginKey={pluginKey}
        entryId={entryId}
        paneId={paneId}
        panelId={props.api.id}
        host={hostBridge}
        openPane={openPane}
      />
    )
  },
}

function App({ specs }: { specs: OpenableSpec[] }): ReactElement {
  const onReady = (event: DockviewReadyEvent): void => {
    // 走跟 openPane 同一条路：算唯一 id 再开。裸 addPanel 的话，specs 里万一出现
    // 两条同 id，第二条会同步抛、异常冲出 onReady，**整口井起不来**而不是少开一格
    for (const spec of specs) addInstance(event.api, spec)
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
  document.documentElement.classList.add(...THEME_CLASSES)
  // 外壳自己的表 scope 在这个属性之下。井里每一格的件容器另挂它自己的那个
  root.setAttribute('data-gwb-plugin', SELF)

  const panes = await fetchPanes(args.host)
  // 第三刀半没有导航,把它从表里滤掉——listOpenable 排的第一条是导航那格,而画它的组件
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
      // **只清自己那份**：热换外壳的自然顺序是「新的先 boot、旧的后 dispose」，
      // 不判身份的话旧句柄会把新外壳的那份清掉,全井的件当场报「缺 params」——
      // 而外壳没有 bug,是 dispose 越了界
      if (hostBridge === args.host) hostBridge = undefined
    },
  }
}

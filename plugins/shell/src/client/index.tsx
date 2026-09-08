import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type SerializedDockview,
} from 'dockview-react'
import { GwbTab } from './GwbTab.js'
import { PluginPane } from './PluginPane.js'
import { StatusBar } from './StatusBar.js'
import { loadStyle } from './asset.js'
import { fetchPanes } from './panes.js'
import {
  listOpenable,
  planOpen,
  specForOwnPane,
  titleForOrdinal,
  uniquePanelId,
  type OpenableSpec,
  type OpenPlan,
} from '../openable.js'
import { PLUGIN_COMPONENT } from '../panels.js'
import {
  LAYOUT_GET_COMMAND,
  LAYOUT_SAVE_COMMAND,
  LAYOUT_VERSION,
  parseLayoutDoc,
  upsertSaved,
  type LayoutDoc,
  type SavedLayout,
} from '../layout.js'
import type { HostBridge, ShellArgs, ShellBridge } from './types.js'

/**
 * 外壳的浏览器半：一口 dockview 窗格井，把注册表里的每一格开出来。
 *
 * 布局落盘（第四刀欠的那半）在这份里落地：井一变就防抖整档写进 gwbData 的 `layout`
 * 档，重启回到上次的井；人还能把当前布局**起名存进清单**，日后点开哪套就铺哪套。
 * 多桌面（一张桌面一口井、井常驻保活）做到 0.0.14 后撤回——现场与理由见文档站。
 * 第四刀剩下的：导航。
 */

const SELF = '@godcreator02/gwb-shell'

/**
 * 主题件的启动样式命令。**软契约**：命令名两边各存一份字符串，外壳不 import 主题件的
 * 任何东西（那是 node 半的包，跟 hello 客户端不 import `shell.panes` 常量同一个道理）。
 * theme 件没装时总线自己回「没有这条命令」，这儿静默跳过——外壳不因此少一根毫毛。
 */
const THEME_COMMAND = 'theme.startupCss'
/** 页面上那张启动样式表的 id。主题件的编辑格预览时改的就是它 */
const THEME_STYLE_ID = 'gwb-theme-style'

/**
 * 开机把用户的外观样式（字体覆盖 + 自定义 CSS）放进页面。
 *
 * **必须在三张表之后、首帧之前**：这张表要压过令牌的默认值，同特异性下靠文档序取胜，
 * 所以它得是 head 里靠后的那张；而「重启后开机即生效」要求它赶在 createRoot 前落位。
 * 表幂等（按 id 取，已存在就改内容）——热换外壳时新壳重注同一张，不重不漏。
 */
async function applyThemeStyle(host: HostBridge): Promise<void> {
  try {
    const reply = (await host.call(THEME_COMMAND)) as { ok?: boolean; data?: unknown; error?: string }
    if (reply.ok !== true || typeof reply.data !== 'string' || reply.data.trim() === '') return
    let el = document.getElementById(THEME_STYLE_ID)
    if (el === null) {
      el = document.createElement('style')
      el.id = THEME_STYLE_ID
      document.head.appendChild(el)
    }
    el.textContent = reply.data
  } catch (err) {
    console.warn(`[shell] 启动样式没取到（theme 件没装？）：${String(err)}`)
  }
}

/**
 * 主题类，**就我们自己这一个**。dockview 自带的 18 套一个不挂——`build.ts` 把那些块
 * 整类裁掉了，产物里只剩它无条件生效的基础规则加我们那张 theme。
 *
 * 曾经挂过它的 `dockview-theme-light` 当基底、我们只覆盖配色。那样形状（35px 标签条、
 * 全直角、零间距）永远是它的，改起来是在别人的主张上打补丁。现在整套归我们。
 *
 * **亮暗不靠换这个类**——配色全是 `var(--…)`，令牌跟着 `html.dark` 变。
 */
const THEME_CLASSES = ['dockview-theme-gwb']

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
  // 跟默认深色对齐：boot 时给 <html> 挂 dark，令牌整套走暗的那半
  colorScheme: 'dark',
  // **沟 = gap: 8**。margin 算术是精确的（每个可见格让出 margin×(n-1)/n，最后一格
  // 右边正好贴容器边，实测零溢出）。外圈环走 .dv-shell 自身的 padding（见
  // dockview-theme.css 的 .dockview-theme-gwb.dv-shell）——它挂在被 ResizeObserver
  // 量 contentRect 的元素上，padding 天然不算进可用尺寸（dockview 官方
  // .dockview-spaced 同一机制）。内衬绝不能打在 .dv-shell 与 .dv-grid-view 之间：
  // BaseGrid.layout 会把网格根硬写成壳的 contentRect 尺寸，中间任何 padding 都会
  // 溢出裁边 + 触发 .dv-view 的滚动条。
  gap: 8,
  // 拖拽落点用整块高亮，不用细线——卡是填色的，fill 才看得清
  dndTabIndicator: 'fill',
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

/** 布局落盘的防抖窗口：一阵拖拽 / 开关格合并成一次写。母仓量下来的一档 */
const SAVE_DEBOUNCE_MS = 400

/**
 * 拆树前要抢着 flush 一次的钩子。跟 `hostBridge` 一样住模块级：`bootShell` 的 dispose
 * 够得着，而 App 内部的函数出不了那层闭包
 */
let flushLayoutSave: (() => void) | undefined

interface PluginParams {
  pluginKey: string
  entryId: string
  paneId: string
}

/** 这个 id 在井里已经有格了吗。`planOpen` 与 `addInstance` 同吃这一处 */
function takenIn(api: DockviewApi): (id: string) => boolean {
  return (id) => api.getPanel(id) !== undefined
}

/** dockview 的标签组件表按键取用，开格时 `tabComponent` 指到这个键 */
const TAB_COMPONENT = 'gwb-tab'

/**
 * 面板 params：件的识别三件套 + 标签要的图标名。图标走 params 是借道——dockview
 * 没给图标留位子，而 GwbTab 只拿得到面板 params 与 api。它本来就是格的静态属性，
 * 将来布局落盘时跟着 params 走也无妨。
 */
function panelParams(spec: OpenableSpec): Record<string, unknown> {
  return { ...spec.params, ...(spec.icon === undefined ? {} : { icon: spec.icon }) }
}

/**
 * 开一格：算出这一份的实例 id 再 `addPanel`。
 *
 * **`addPanel` 撞已存在的 id 是同步抛 Error**（dockview 的 `_doAddPanel` 头一句就是
 * 这个守卫），所以 id 必须先算好——不能指望它回一个「已经有了」。`taken` 问的是
 * dockview 当下真有哪些格，因此恢复存档布局之后再开也不会撞。
 */
function addInstance(api: DockviewApi, spec: OpenableSpec): void {
  const { id, ordinal } = uniquePanelId(spec.id, takenIn(api))
  api.addPanel({
    id,
    component: spec.component,
    tabComponent: TAB_COMPONENT,
    title: titleForOrdinal(spec.title, ordinal),
    params: panelParams(spec),
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
  applyPlan(api, planOpen(specForOwnPane(panes, who.entryId, who.paneId), options, takenIn(api), who))
}

/**
 * 外壳自己开一格（状态栏的＋列表点的就是这条）。**走跟件调 `openPane` 同一个 `planOpen`**
 * ——所以行为一致：已经开着的点了是聚焦，声明了 `duplicable` 的才开得出第二份。
 *
 * 跟 `openOwnPane` 的差别只在入口：那边件只给得出 `paneId`、要现取表查 spec，这边 spec
 * 本来就在手上（＋列表就是拿它排出来的）。
 */
function openSpec(api: DockviewApi, spec: OpenableSpec, duplicate: boolean): void {
  const who = { entryId: spec.params?.entryId ?? '', paneId: spec.params?.paneId ?? '' }
  applyPlan(api, planOpen(spec, { duplicate }, takenIn(api), who))
}

/** 把 `planOpen` 的判断落成动作。副作用全在这儿，判断一条都不在 */
function applyPlan(api: DockviewApi, plan: OpenPlan): void {
  if (plan.kind !== 'open' && plan.notice !== undefined) console.warn(`[shell] ${plan.notice}`)
  if (plan.kind === 'none') return
  if (plan.kind === 'focus') {
    api.getPanel(plan.id)?.api.setActive()
    return
  }
  api.addPanel({
    id: plan.id,
    component: plan.spec.component,
    tabComponent: TAB_COMPONENT,
    title: plan.title,
    params: panelParams(plan.spec),
    // **重复那份摆到右边**：不给 position 的话它落进当前 group 当兄弟 tab，
    // 一开就把第一份盖住了——而「两份同时看得见」正是多实例唯一能眼见为实的地方
    ...(plan.id === plan.spec.id ? {} : { position: { direction: 'right' as const } }),
  })
}

/**
 * 面板组件表。**必须是模块级常量**：dockview 拿它的引用做比对，每轮渲染换一个新对象
 * 会让它把所有格拆了重建。标签表同理——同一个理由，同一个待遇。
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
        setTitle={(title) => props.api.setTitle(title)}
      />
    )
  },
}

/** 标签一律走自己的 pill 组件：图标 + 标题 + 关闭叉，形状与四态见 GwbTab 头注 */
const TAB_COMPONENTS: Record<string, React.FunctionComponent<IDockviewPanelHeaderProps>> = {
  [TAB_COMPONENT]: GwbTab,
}

function App({
  specs,
  home,
  root,
  initialDoc,
}: {
  specs: OpenableSpec[]
  home: string
  root: HTMLElement
  /** 盘上的档。null = 第一次开机（或档废了），走默认铺格 */
  initialDoc: LayoutDoc | null
}): ReactElement {
  // 井外面那条状态栏要用 api（开格）与「此刻开着哪些」（标已开），而 api 只在 onReady
  // 的回调里出现——接住它
  const [api, setApi] = useState<DockviewApi | null>(null)
  const [openIds, setOpenIds] = useState<string[]>([])
  /** 人起名存下来的布局清单，档里那半 */
  const [saved, setSaved] = useState<SavedLayout[]>(initialDoc?.saved ?? [])
  const [saveFailed, setSaveFailed] = useState(false)

  // 回调读的都走 ref：防抖保存醒来时要读「当下」，不能读进闭包那一刻的旧账
  const apiRef = useRef(api)
  apiRef.current = api
  const savedRef = useRef(saved)
  savedRef.current = saved
  const timerRef = useRef<number | undefined>(undefined)

  const flushSave = useCallback((): void => {
    window.clearTimeout(timerRef.current)
    if (hostBridge === undefined) return
    // **整档为写单位**：current 问井自己（活着的那份才是真相），saved 用清单原文。
    // 迟到的旧定时器走不到这儿——schedule 每次重排，醒来的一定是最新这份
    const live = apiRef.current
    const doc: LayoutDoc = {
      v: LAYOUT_VERSION,
      current: live === null ? null : (live.toJSON() as unknown as Record<string, unknown>),
      saved: savedRef.current,
    }
    void hostBridge.call(LAYOUT_SAVE_COMMAND, doc).then(
      (reply) => {
        const typed = reply as { ok?: boolean; error?: string }
        setSaveFailed(typed.ok !== true)
        if (typed.ok !== true) console.error(`[shell] 布局没存上：${typed.error ?? '没说原因'}`)
      },
      (err: unknown) => {
        setSaveFailed(true)
        console.error(`[shell] 布局没存上：${String(err)}`)
      },
    )
  }, [])

  const scheduleSave = useCallback((): void => {
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(flushSave, SAVE_DEBOUNCE_MS)
  }, [flushSave])

  // 拆树前抢一把 flush（bootShell 的 dispose 经模块级钩子够到它）
  useEffect(() => {
    flushLayoutSave = flushSave
    return () => {
      flushLayoutSave = undefined
    }
  }, [flushSave])

  const openDefaults = (target: DockviewApi): void => {
    // 走跟 openPane 同一条路：算唯一 id 再开。裸 addPanel 的话，specs 里万一出现
    // 两条同 id，第二条会同步抛、异常冲出 onReady，**整口井起不来**而不是少开一格
    for (const spec of specs) addInstance(target, spec)
  }

  const onReady = (event: DockviewReadyEvent): void => {
    const current = initialDoc?.current ?? null
    if (current !== null) {
      try {
        event.api.fromJSON(current as unknown as SerializedDockview)
      } catch (err) {
        // 上次的井恢复不了（存档坏了 / dockview 升了版本）：回默认，不拦外壳起
        console.warn(`[shell] 上次的布局恢复不了，回默认：${String(err)}`)
        openDefaults(event.api)
      }
    } else {
      openDefaults(event.api)
    }
    setApi(event.api)
  }

  useEffect(() => {
    if (api === null) return
    const sync = (): void => setOpenIds(api.panels.map((p) => p.id))
    sync()
    // 两个用途一个事件：状态栏的「已开」跟着新，布局落盘也订它
    const sub = api.onDidLayoutChange(() => {
      sync()
      scheduleSave()
    })
    return () => sub.dispose()
  }, [api, scheduleSave])

  /** 点开哪套已存布局，就把哪套铺回井上。变化照常走防抖落盘（current 跟着换） */
  const applySaved = (row: SavedLayout): void => {
    if (api === null) return
    try {
      api.fromJSON(row.layout as unknown as SerializedDockview)
    } catch (err) {
      // 只报不回默认：人点名要的是这一套，铺不回去得让他知道是这套的存档坏了，
      // 而不是悄悄换回默认布局装没事
      console.warn(`[shell] 布局「${row.name}」铺不回去（存档是坏的？）：${String(err)}`)
    }
  }

  /** 把此刻的井起名存进清单。**同名覆盖**（名字就是钥匙），空名不存 */
  const saveCurrent = (name: string): void => {
    if (api === null || name === '') return
    setSaved((prev) => upsertSaved(prev, name, api.toJSON() as unknown as Record<string, unknown>))
    scheduleSave()
  }

  const removeSaved = (id: string): void => {
    setSaved((prev) => prev.filter((s) => s.id !== id))
    scheduleSave()
  }

  /** 重置：清掉井，照「表里有几格开几格」重铺。逐格关，**不走 `api.clear()`**——它内部
   * 账对不上时会抛（母仓撞过），而这儿用不着它：关完重开，id 查重问的是当下真有哪些 */
  const resetLayout = (): void => {
    if (api === null) return
    for (const panel of api.panels) api.removePanel(panel)
    openDefaults(api)
  }

  // fixed inset-0 而不是 h-screen:#root 没有高度样式,而外壳不该去改宿主那张 html。
  // 井那格 **min-h-0 少不了**:flex 子项默认 min-height:auto,内容一高就把状态栏挤出屏幕
  return (
    <div className="fixed inset-0 flex flex-col">
      <div className="min-h-0 flex-1">
        <DockviewReact components={COMPONENTS} tabComponents={TAB_COMPONENTS} onReady={onReady} theme={GWB_THEME} />
      </div>
      <StatusBar
        specs={specs}
        openIds={openIds}
        home={home}
        scopeRef={root}
        savedLayouts={saved}
        saveFailed={saveFailed}
        onOpen={(spec, duplicate) => {
          if (api === null) return
          openSpec(api, spec, duplicate)
        }}
        onApplyLayout={applySaved}
        onSaveLayout={saveCurrent}
        onDeleteLayout={removeSaved}
        onResetLayout={resetLayout}
        onRetrySave={() => flushSave()}
      />
    </div>
  )
}

/**
 * 取盘上的布局档。**取不到 / 取不回一律回 null**：第一次开机本来就没有档（`readDoc`
 * 对没有的文档回 undefined，**这不是错、不出声**）；data 件没装时这条命令回不了 ok
 * ——外壳照样起，只是不带记忆，落盘那条也会一样失败（状态栏会亮「布局没存上」）。
 * 档认不出（人手改坏、多桌面时代的 v1、将来升了版本）也走 null，当没有。
 */
async function fetchLayoutDoc(host: HostBridge): Promise<LayoutDoc | null> {
  try {
    const reply = (await host.call(LAYOUT_GET_COMMAND)) as { ok?: boolean; data?: unknown; error?: string }
    if (reply.ok !== true) {
      console.warn(`[shell] ${LAYOUT_GET_COMMAND} 没回档：${reply.error ?? '命令不在（data 件没装？）'}`)
      return null
    }
    if (reply.data === undefined || reply.data === null) return null
    const doc = parseLayoutDoc(reply.data)
    if (doc === null) console.warn('[shell] 盘上的布局档认不出，当没有处理（回默认布局）')
    return doc
  } catch (err) {
    console.error(`[shell] ${LAYOUT_GET_COMMAND} 调不通：${String(err)}`)
    return null
  }
}

async function boot(args: ShellArgs, root: HTMLElement): Promise<Root> {
  hostBridge = args.host
  // 三张表都等到位再渲染：令牌是值的来源（页面级，件不用自己注）、dockview 那张不 scope
  // （它管的 DOM 类名不经我们的手，而且门户元素在 body 下）、外壳自己那张 scope 过
  await Promise.all(args.styles.map((href) => loadStyle(href)))
  // 第四样：用户自己的外观样式（gwb-theme 件的字体覆盖 + 自定义 CSS）。它要压过令牌
  // 默认值，所以排在这三张 link 之后；theme 没装时这儿是个空操作
  await applyThemeStyle(args.host)
  document.documentElement.classList.add(...THEME_CLASSES)
  // 深色是默认态：令牌的 .dark 那套在这儿挂上，状态栏的开关之后随时摘。dispose 不摘
  // ——亮暗是页面级选择，热换外壳时新壳 boot 会再挂，这头摘了反而闪一下亮色
  document.documentElement.classList.add('dark')
  // 外壳自己的表 scope 在这个属性之下。井里每一格的件容器另挂它自己的那个
  root.setAttribute('data-gwb-plugin', SELF)

  const panes = await fetchPanes(args.host)
  // 导航还没有,把它从表里滤掉——listOpenable 排的第一条是导航那格,而画它的组件
  // 第四刀才有。留着的话 dockview 会拿不到 'nav' 组件
  const specs = listOpenable(panes).filter((s) => s.component === PLUGIN_COMPONENT)
  // 档赶在首帧之前到手——先铺默认再跳恢复，闪的那一下藏不住
  const initialDoc = await fetchLayoutDoc(args.host)
  console.log(
    `[shell] 表里 ${specs.length} 格可开：${specs.map((s) => s.id).join('、') || '（表是空的）'}；` +
      (initialDoc === null
        ? '没有档，从默认布局起'
        : `按档恢复（存着 ${initialDoc.saved.length} 套布局）`),
  )

  const reactRoot = createRoot(root)
  // root 传下去是给状态栏那个菜单的 portal 用的——挂 body 上就出了 scope
  reactRoot.render(<App specs={specs} home={args.home} root={root} initialDoc={initialDoc} />)
  return reactRoot
}

/** 内核 import 本模块后调的是默认导出（见文件末尾），它问完环境再调这个。**回一个 `{ dispose }`**：热换外壳时页面上这棵树得有人拆 */
export function bootShell(args: ShellArgs, root: HTMLElement): { dispose(): void } {
  const mounted = boot(args, root).catch((err: unknown) => {
    root.textContent = `外壳起不来：${String(err)}`
    return undefined
  })
  return {
    dispose() {
      // 布局还有没落盘的那半拍，拆树前抢着写一把——赶不上也就丢最后 400ms 的挪动
      flushLayoutSave?.()
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

/** 页面的公共面里本件用得着的一条。按形状收，正本在内核的词汇表包 */
declare global {
  interface Window {
    gwb: { command(command: string, args?: unknown): Promise<unknown> }
  }
}

/** node 半登记的那条环境命令。各存一份字符串，浏览器半不 import node 半 */
const ENV_COMMAND = 'shell.env'

/**
 * 内核契约的那一个默认导出：拿走 `#root`，回 `{ dispose }`。
 * 环境（home、样式表地址）问 node 半的 `shell.env`；importmap 内核在 import 本模块之前已经注好，
 * 所以本文件顶层的 react 裸名解析得到。
 */
export default function mountShell(root: HTMLElement): { dispose(): void } {
  let inner: { dispose(): void } | undefined
  let disposed = false
  ;(async () => {
    const reply = (await window.gwb.command(ENV_COMMAND)) as {
      ok?: boolean
      data?: { home: string; styles: string[] }
      error?: string
    }
    if (reply.ok !== true || reply.data === undefined) {
      throw new Error(`${ENV_COMMAND} 没回环境：${reply.error ?? '没说原因'}`)
    }
    if (disposed) return
    inner = bootShell(
      { host: { call: (command, args) => window.gwb.command(command, args) }, home: reply.data.home, styles: reply.data.styles },
      root,
    )
  })().catch((err: unknown) => {
    root.textContent = `外壳起不来：${String(err)}`
  })
  return {
    dispose() {
      disposed = true
      inner?.dispose()
    },
  }
}

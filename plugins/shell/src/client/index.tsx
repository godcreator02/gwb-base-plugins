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
  panelParamsOf,
  planOpen,
  specForOwnPane,
  titleForOrdinal,
  uniquePanelId,
  type OpenableSpec,
  type OpenPane,
  type OpenPaneOptions,
  type OpenPlan,
} from '../openable.js'
import {
  PLUGIN_COMPONENT,
  entryIdOf,
  isPreviewPanel,
  paneIdOf,
  paneKeyOf,
  pluginParamsIn,
  replaceParams,
} from '../panels.js'
import {
  LAYOUT_GET_COMMAND,
  LAYOUT_SAVE_COMMAND,
  LAYOUT_VERSION,
  defaultDoc,
  nextDesktopId,
  parseLayoutDoc,
  upsertSaved,
  type DesktopRow,
  type LayoutDoc,
  type SavedLayout,
} from '../layout.js'
import { defaultDesktopName, isDesktopAction, resolveDesktop } from '../desktops.js'
import { notifyDesktopVisibility } from '../visibility.js'
import { DESKTOP_ATTR } from './desktop-context.js'
import type { HostBridge, ShellArgs, ShellBridge } from './types.js'

/**
 * 外壳的浏览器半：多口 dockview 窗格井（一口桌面一口，常驻保活），把注册表里的每一格
 * 开出来。多桌面第一波（0.0.14）做过又撤回，这是第二波重做——语义、向量与判据见文档站
 * decisions「多桌面第二波」。
 *
 * 保活的形状：一口桌面一个 section，全部绝对定位叠在主区里，**非活动的只是不显示**
 * （visibility:hidden + pointer-events:none + inert），DOM、定时器、订阅全活着；开机只挂
 * 活动那口，别的桌面第一次切到才挂、挂上常驻。每口井各自防抖落盘，档是 v3（active +
 * desktops + saved）。切换 = 记账 → flush → 显隐 → 可见性通知 → 焦点接管 → body 探雷。
 *
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
 */
let hostBridge: HostBridge | undefined

/**
 * 全部井的注册表（desktopId → api）。井常驻，挂上就住到外壳拆。**桌面是分组不是宇宙**
 * （0.4.0）：开格的聚焦与查重要看**全井**——同一格开在别的桌面也算一份，key 命中就
 * 走聚焦（切过去激活），实例 id 全页唯一。面板组件因此连 `containerApi` 都不用传——
 * 判断全在模块层，喂表喂的是全井聚合。
 */
const wellApis = new Map<string, DockviewApi>()
/** 活动桌面 id。同样住模块级（同 hostBridge 的路子）：面板组件的闭包够不着 App 的状态 */
let activeDesktop = ''
/** 切桌面的分派（App 注入，同 flushLayoutSave 的路子）：聚焦落到别的井时由它切到台前 */
let switchDesktop: ((id: string) => void) | undefined

/** 布局落盘的防抖窗口：一阵拖拽 / 开关格合并成一次写。母仓量下来的一档 */
const SAVE_DEBOUNCE_MS = 400

/**
 * 拆树前要抢着 flush 一次的钩子。跟 `hostBridge` 一样住模块级：`bootShell` 的 dispose
 * 够得着，而 App 内部的函数出不了那层闭包
 */
let flushLayoutSave: (() => void) | undefined

/** 这个 id 在**任何一口井**里已经有格了吗。井是分组不是宇宙：实例 id 全页唯一，查重看全井 */
function takenAnywhere(id: string): boolean {
  for (const api of wellApis.values()) {
    if (api.getPanel(id) !== undefined) return true
  }
  return false
}

/**
 * **这一格此刻开着的几份——全井聚合**：`planOpen` 认身份、挑预览格、查重都吃这张表。
 * 开在别的桌面的份带 `here: false`（聚焦认它、预览槽与落位不认，判据归 planOpen）。
 *
 * 现从各口井里摘，不存快照——格是人随时关得掉的。滤的是「同一条条目的同一格」：`key`
 * 与 `preview` 都是这一格之内的概念，掺进别的格会让查重把别人的 id 也算上。
 */
function openInstancesAll(who: { entryId: string; paneId: string }): OpenPane[] {
  const out: OpenPane[] = []
  for (const [desktop, api] of wellApis) {
    for (const panel of api.panels) {
      if (entryIdOf(panel) !== who.entryId || paneIdOf(panel) !== who.paneId) continue
      out.push({
        id: panel.id,
        key: paneKeyOf(panel),
        preview: isPreviewPanel(panel),
        ...(desktop === activeDesktop ? {} : { here: false as const }),
      })
    }
  }
  return out
}

/** 这一条 spec 背后是谁的哪一格。导航那格没有 params，两段都回空串 */
function whoOf(spec: OpenableSpec): { entryId: string; paneId: string } {
  return { entryId: spec.params?.entryId ?? '', paneId: spec.params?.paneId ?? '' }
}

/**
 * 状态栏那张表上点这一条会不会走成**聚焦**——那个「已开」记号标的就是它。
 *
 * **记号必须跟点下去的效果对齐**：那条入口不给 `key`（等于空串），所以它开/聚焦的是
 * 「没装特定内容的那一份」——而**那一份可以在别的桌面**（全局表）：此时点下去走成
 * 切过去聚焦，记号照样标，任务栏语义。
 *
 * **问的就是 `planOpen` 自己**：在这儿另写一条「key 为空的那份在不在」就是第二份真相，
 * 两处迟早漂，而漂了没有任何现象——只是那个记号开始说谎。
 */
function willFocus(spec: OpenableSpec): boolean {
  const who = whoOf(spec)
  return planOpen(spec, undefined, openInstancesAll(who), who).kind === 'focus'
}

/** dockview 的标签组件表按键取用，开格时 `tabComponent` 指到这个键 */
const TAB_COMPONENT = 'gwb-tab'

/**
 * 面板 params：件的识别三件套 + 标签要的图标名 + 件开这一份时传的那些键（已由
 * `planOpen` 并进 `spec.params`）。图标走 params 是借道——dockview 没给图标留位子，
 * 而 GwbTab 只拿得到面板 params 与 api。
 *
 * **这一份跟着布局落盘**：dockview 的 `toJSON` 原样带上 params，整档写进 gwbData 的
 * `layout`，`fromJSON` 再原样喂回来。件传的参数免费活过重启，代价是它必须可 JSON
 * 序列化——所以往这儿塞活对象是不行的。
 */
function panelParams(spec: OpenableSpec): Record<string, unknown> {
  // 拼法归 `panelParamsOf`（开格与软换同吃那一处）。导航那格没有 params，回空表
  return panelParamsOf(spec) ?? {}
}

/**
 * 开一格：算出这一份的实例 id 再 `addPanel`。**查重看全井**（`takenAnywhere`）——桌面
 * 是分组不是宇宙，实例 id 全页唯一，第二份在任何一口井都叫 `:2`。
 *
 * **`addPanel` 撞已存在的 id 是同步抛 Error**（dockview 的 `_doAddPanel` 头一句就是
 * 这个守卫），所以 id 必须先算好——不能指望它回一个「已经有了」。
 */
function addInstance(api: DockviewApi, spec: OpenableSpec): void {
  const { id, ordinal } = uniquePanelId(spec.id, takenAnywhere)
  api.addPanel({
    id,
    component: spec.component,
    tabComponent: TAB_COMPONENT,
    title: titleForOrdinal(spec.title, ordinal),
    params: panelParams(spec),
  })
}

/**
 * 件说「打开我的某一格」。判断全在 `planOpen` 那个纯函数里，喂它的是**全井聚合**的表；
 * 这儿只按 kind 分派（聚焦可能落在别的井——`applyPlan` 会把那口井切到台前）。
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
  host: HostBridge,
  who: { entryId: string; paneId: string },
  options: OpenPaneOptions | undefined,
): Promise<void> {
  const panes = await fetchPanes(host)
  applyPlan(planOpen(specForOwnPane(panes, who.entryId, who.paneId), options, openInstancesAll(who), who))
}

/**
 * 外壳自己开一格（状态栏那张「可开的窗格」列表点的就是这条）。**走跟件调 `openPane`
 * 同一个 `planOpen`、同一张全局表**——所以行为一致：打开这一格，已经开着（**任何桌面**）
 * 就切过去聚焦，任务栏语义。
 */
function openSpec(spec: OpenableSpec): void {
  const who = whoOf(spec)
  applyPlan(planOpen(spec, undefined, openInstancesAll(who), who))
}

/** 把 `planOpen` 的判断落成动作。副作用全在这儿，判断一条都不在 */
function applyPlan(plan: OpenPlan): void {
  // 四种 kind 都可能带话：开出来了也可能顺带说了句「你传的保留键摘掉了」
  if (plan.notice !== undefined) console.warn(`[shell] ${plan.notice}`)
  if (plan.kind === 'none') return
  if (plan.kind === 'focus') {
    focusAcross(plan.id)
    return
  }
  // 预览槽与落位都只在本井找（planOpen 已保证 id 在活动井），新份也开在活动井
  const api = wellApis.get(activeDesktop)
  if (api === undefined) return
  if (plan.kind === 'retarget') {
    const panel = api.getPanel(plan.id)
    // 表是刚从井里摘的，这一格不该凭空没了。真没了就当什么都没发生——补开一格的话，
    // 人看到的是「点一下冒出来两格」，比少开一格更难往回查
    if (panel === undefined) return
    // **`replaceParams` 少不了**：dockview 的 updateParameters 是并不是换，上一份内容
    // 的参数不显式写成 undefined 就会赖在这一格里，跟着 toJSON() 一起落盘
    panel.api.updateParameters(replaceParams(panel.params, plan.params))
    panel.api.setActive()
    return
  }
  // 摆哪儿是 `planOpen` 算好的两格（`direction` / `referencePanel`），这儿只换成
  // dockview 的形状。**`referencePanel` 有就得带上**：只给 direction 的 position 在
  // dockview 那头是 AbsolutePosition，落的是整口井的边，不是「参照那一份的下面」
  const position =
    plan.direction === undefined
      ? undefined
      : plan.referencePanel === undefined
        ? { direction: plan.direction }
        : { direction: plan.direction, referencePanel: plan.referencePanel }
  api.addPanel({
    id: plan.id,
    component: plan.spec.component,
    tabComponent: TAB_COMPONENT,
    title: plan.title,
    params: panelParams(plan.spec),
    // 不给 position 的那一档是真的一个键都不给：它落进当前 group 当兄弟 tab
    ...(position === undefined ? {} : { position }),
  })
}

/**
 * **全局聚焦**：这一份在哪口井，就把那口井切到台前再激活——任务栏点一个在别的虚拟
 * 桌面上的窗口，Windows 干的就是这件事。井各管各的 panel 表，id 的属主唯一。井常驻
 * （保活），激活不必等显隐真落地（api 活着，CSS 只是衣裳）。
 */
function focusAcross(panelId: string): void {
  for (const [desktop, api] of wellApis) {
    const panel = api.getPanel(panelId)
    if (panel === undefined) continue
    if (desktop !== activeDesktop) switchDesktop?.(desktop)
    panel.api.setActive()
    return
  }
}

/**
 * 面板组件表。**必须是模块级常量**：dockview 拿它的引用做比对，每轮渲染换一个新对象
 * 会让它把所有格拆了重建。标签表同理——同一个理由，同一个待遇。
 */
const COMPONENTS: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  [PLUGIN_COMPONENT]: (props: IDockviewPanelProps) => {
    // 一份 params 装两半：外壳的识别三件套（加图标）在这儿读，件自己那半交给 pluginParamsIn 摘
    const params = props.params as Record<string, unknown> | undefined
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
      return <p className="shell:text-destructive shell:m-0 shell:p-3 shell:text-sm">这一格缺 params（外壳的 bug）</p>
    }
    const bridge = hostBridge
    const openPane: ShellBridge['openPane'] = (target, options) => {
      // 件不等返回值（它是 click 回调），但这条链上的错得有出口。井不传——判断在模块层
      // 看全井（聚焦可能落到别的桌面），面板组件连 containerApi 都不用了
      void openOwnPane(bridge, { entryId, paneId: target }, options).catch((err: unknown) => {
        console.error(`[shell] 开 ${target} 失败：${String(err)}`)
      })
    }
    /**
     * 转正：把 `preview` 从**这一份**的 params 上删掉。
     *
     * **写 `undefined` 就是删**（dockview 的 update 里那条：新值是 undefined 的键从
     * params 上摘掉），不是写成 false——「有没有这个键」只该有一种判法。
     *
     * 已经是正式格就什么都不做：件在每次击键时调它是预料之中的用法，而每调一次就发一轮
     * params 变更，会白白带起一次重渲染与一次布局落盘。
     */
    const keepPane: ShellBridge['keepPane'] = () => {
      if (params?.preview !== true) return
      props.api.updateParameters({ preview: undefined })
    }
    return (
      <PluginPane
        pluginKey={pluginKey}
        entryId={entryId}
        paneId={paneId}
        panelId={props.api.id}
        // 件那半只看得见自己传的那些键：保留键摘掉，件不该认识 entryId 这种外壳内部的东西
        paneParams={pluginParamsIn(params)}
        host={hostBridge}
        openPane={openPane}
        setTitle={(title) => props.api.setTitle(title)}
        keepPane={keepPane}
      />
    )
  },
}

/** 标签一律走自己的 pill 组件：图标 + 标题 + 关闭叉，形状与四态见 GwbTab 头注 */
const TAB_COMPONENTS: Record<string, React.FunctionComponent<IDockviewPanelHeaderProps>> = {
  [TAB_COMPONENT]: GwbTab,
}

/**
 * 切换后扫一眼 body：**探雷器，不是灭火器**。件的浮层若没把 radix Portal 的 container
 * 指到 `args.shell.portal`，它就挂在 body 上、不跟任何桌面走——藏掉桌面也藏不掉它
 * （0.0.14 那桩「后面的桌面盖住前面的」最可信的向量）。扫到只点名（console.warn），
 * **不删别人的 DOM**。状态栏自己的菜单也挂 body——它在桌面体系之外，应该常驻；radix
 * 的菜单在焦点离开时自己关，所以扫到的多半是没接容器那半的残影。
 */
function sweepBodyPortals(activeName: string): void {
  const strays: string[] = []
  for (const el of document.body.children) {
    // 根节点与三类非浮层的常态节点不算
    if (el.id === 'root' || /^(STYLE|SCRIPT|LINK|NOSCRIPT)$/.test(el.tagName)) continue
    const cls = el.getAttribute('class') ?? ''
    strays.push(`<${el.tagName.toLowerCase()}${cls === '' ? '' : ` class="${cls}"`}>`)
  }
  if (strays.length > 0) {
    console.warn(
      `[shell] 切到「${activeName}」时 body 上还挂着 ${strays.length} 个节点（多半是哪个件的浮层没跟着自己桌面走——radix Portal 的挂载点该指到 args.shell.portal）：${strays.join('、')}`,
    )
  }
}

function App({
  specs,
  home,
  initialDoc,
}: {
  specs: OpenableSpec[]
  home: string
  /** 盘上的档（已并好缺省：第一次开机或档废了就是 defaultDoc()，v2 在解析那层已迁成 v3） */
  initialDoc: LayoutDoc
}): ReactElement {
  /** 每口挂着的井各自的 api。井常驻（保活），挂上就不拆——「活动的那口」只是其中之一 */
  const [apis, setApis] = useState<Record<string, DockviewApi>>({})
  /** 已挂井的桌面 id。开机只挂 active 那口，别的桌面第一次切到才挂（冷挂）、挂上常驻 */
  const [mountedIds, setMountedIds] = useState<string[]>(() => [initialDoc.active])
  const [desktops, setDesktops] = useState<DesktopRow[]>(initialDoc.desktops)
  const [activeId, setActiveId] = useState(initialDoc.active)
  /** 状态栏那张表上点了会走成聚焦的那几条（spec 的基名）。判据归 `willFocus`，只看活动那口井 */
  const [focusIds, setFocusIds] = useState<string[]>([])
  /** 人起名存下来的布局清单，档里那半 */
  const [saved, setSaved] = useState<SavedLayout[]>(initialDoc.saved)
  const [saveFailed, setSaveFailed] = useState(false)

  // 回调读的都走 ref：防抖保存醒来时要读「当下」，不能读进闭包那一刻的旧账
  const apisRef = useRef(apis)
  apisRef.current = apis
  const mountedRef = useRef(mountedIds)
  mountedRef.current = mountedIds
  const rowsRef = useRef(desktops)
  rowsRef.current = desktops
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  // 模块级的活动桌面（面板组件的开格链读它），跟 ref 同一步走——switchTo 里另有一处同步赋值，
  // 保证聚焦分派在同一拍里看到新值
  activeDesktop = activeId
  const savedRef = useRef(saved)
  savedRef.current = saved
  const timerRef = useRef<number | undefined>(undefined)
  /** 每口井的 onDidLayoutChange 订阅。井常驻，跟着 App 卸载一起拆 */
  const wellSubsRef = useRef(new Map<string, { dispose(): void }>())

  const activeApi = apis[activeId] ?? null

  const flushSave = useCallback((): void => {
    window.clearTimeout(timerRef.current)
    if (hostBridge === undefined) return
    // **整档为写单位**：desktops 逐口问井自己（活着的那份才是真相；还没挂井的桌面用它
    // 那条存着的），saved 用清单原文。迟到的旧定时器走不到这儿——schedule 每次重排，
    // 醒来的一定是最新这份
    const doc: LayoutDoc = {
      v: LAYOUT_VERSION,
      active: activeIdRef.current,
      desktops: rowsRef.current.map((row) => {
        const api = apisRef.current[row.id]
        return api === undefined ? row : { ...row, layout: api.toJSON() as unknown as Record<string, unknown> }
      }),
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

  // 井常驻，订阅与注册表也常驻——App 卸载那趟统一拆
  useEffect(() => {
    const subs = wellSubsRef.current
    return () => {
      for (const sub of subs.values()) sub.dispose()
      subs.clear()
      wellApis.clear()
      activeDesktop = ''
    }
  }, [])

  const openDefaults = (target: DockviewApi): void => {
    // 走跟 openPane 同一条路：算唯一 id 再开。裸 addPanel 的话，specs 里万一出现
    // 两条同 id，第二条会同步抛、异常冲出 onReady，**整口井起不来**而不是少开一格
    for (const spec of specs) addInstance(target, spec)
  }

  /** 状态栏「已开」记号重算：问的是**全局表**的 `planOpen` 判据（别桌已开的也算，点它切过去） */
  const syncFocus = useCallback((): void => {
    setFocusIds(specs.filter((spec) => willFocus(spec)).map((spec) => spec.id))
  }, [specs])

  /** 一口井挂上（冷挂那一刻）：按它那条档恢复，或铺默认；订阅布局变化。井常驻，只走一次 */
  const onWellReady = (id: string, event: DockviewReadyEvent): void => {
    const row = rowsRef.current.find((r) => r.id === id)
    let restored = false
    if (row?.layout != null) {
      try {
        event.api.fromJSON(row.layout as unknown as SerializedDockview)
        restored = true
      } catch (err) {
        // 这口桌面存着的井恢复不了（存档坏了 / dockview 升了版本）：回默认，不拦井起
        console.warn(`[shell] 桌面「${row.name}」的布局恢复不了，回默认：${String(err)}`)
      }
    }
    if (!restored) openDefaults(event.api)
    wellApis.set(id, event.api)
    apisRef.current[id] = event.api
    setApis({ ...apisRef.current })
    // 井一变：活动的那口顺带重算「已开」记号（**换 params 也在这条上**——dockview 8.2.0
    // 把每一组的 onDidPanelParametersChange 接进了 onDidLayoutChange）；哪口变了都要落盘
    wellSubsRef.current.set(
      id,
      event.api.onDidLayoutChange(() => {
        if (activeIdRef.current === id) syncFocus()
        scheduleSave()
      }),
    )
  }

  // 切到一口已挂井的桌面时记号也得重算（那口井没有新事件）
  useEffect(() => {
    syncFocus()
  }, [activeApi, syncFocus])

  /** 切桌面。顺序是机制的一部分：先记账再 flush（档里的 active 跟这一趟走），显隐交给
   * React，可见性通知与焦点接管跟在后面。 */
  const switchTo = useCallback(
    (id: string): void => {
      if (id === activeIdRef.current) return
      const row = rowsRef.current.find((r) => r.id === id)
      if (row === undefined) return
      const prev = activeIdRef.current
      activeIdRef.current = id
      // 模块层同一拍看到新活动桌面（focusAcross 的聚焦分派跟着切换走）
      activeDesktop = id
      if (!mountedRef.current.includes(id)) setMountedIds((list) => [...list, id])
      flushSave()
      setActiveId(id)
      notifyDesktopVisibility(prev, false)
      notifyDesktopVisibility(id, true)
      // 键盘焦点从被藏的那口里被吐出来（visibility:hidden 不可聚焦）。接住：给新那口
      // 焦点，切回时人不用先点一下才能用键盘。rAF 等新那口真上了屏再找它
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[${DESKTOP_ATTR}="${id}"]`)?.focus({ preventScroll: true })
      })
      sweepBodyPortals(row.name)
    },
    [flushSave],
  )

  /** 新建一口桌面并切过去。名字缺省「桌面 N」；layout 留 null（第一次切到铺默认） */
  const createDesktop = useCallback(
    (name?: string): void => {
      const id = nextDesktopId(rowsRef.current)
      const trimmed = name?.trim()
      rowsRef.current = [
        ...rowsRef.current,
        { id, name: trimmed === undefined || trimmed === '' ? defaultDesktopName(id) : trimmed, layout: null },
      ]
      setDesktops(rowsRef.current)
      switchTo(id)
    },
    [switchTo],
  )

  // 跨井聚焦的切桌分派（模块层 focusAcross 经它够到 switchTo，跟 flushLayoutSave 同一个路子）
  useEffect(() => {
    switchDesktop = switchTo
    return () => {
      switchDesktop = undefined
    }
  }, [switchTo])

  // node 半转来的桌面动作（shell.desktop.switch / new）：井在页面这半，命令只是转发
  useEffect(() => {
    const off = window.gwb.on((payload) => {
      if (!isDesktopAction(payload)) return
      if (payload.action === 'switch') {
        const row = resolveDesktop(rowsRef.current, { id: payload.id, name: payload.name })
        if (row === undefined) {
          console.warn(
            `[shell] 要切的桌面认不出：${JSON.stringify({ id: payload.id, name: payload.name })}——盘上的档可能比这条命令旧，shell.desktop.list 现查`,
          )
          return
        }
        switchTo(row.id)
      } else if (payload.action === 'new') {
        createDesktop(typeof payload.name === 'string' ? payload.name : undefined)
      }
    })
    return off
  }, [switchTo, createDesktop])

  /** 点开哪套已存布局，就把哪套铺回**活动那口井**上。变化照常走防抖落盘。照片是模板，
   * 铺开即弃——它跟桌面是两回事（桌面各自自动存），判据见文档站 decisions */
  const applySaved = (row: SavedLayout): void => {
    if (activeApi === null) return
    try {
      activeApi.fromJSON(row.layout as unknown as SerializedDockview)
    } catch (err) {
      // 只报不回默认：人点名要的是这一套，铺不回去得让他知道是这套的存档坏了，
      // 而不是悄悄换回默认布局装没事
      console.warn(`[shell] 布局「${row.name}」铺不回去（存档是坏的？）：${String(err)}`)
    }
  }

  /** 把**活动那口井**起名存进清单。**同名覆盖**（名字就是钥匙），空名不存 */
  const saveCurrent = (name: string): void => {
    if (activeApi === null || name === '') return
    setSaved((prev) => upsertSaved(prev, name, activeApi.toJSON() as unknown as Record<string, unknown>))
    scheduleSave()
  }

  const removeSaved = (id: string): void => {
    setSaved((prev) => prev.filter((s) => s.id !== id))
    scheduleSave()
  }

  /** 重置**活动那口**：清掉井，照「表里有几格开几格」重铺。逐格关，**不走 `api.clear()`**
   * ——它内部账对不上时会抛（母仓撞过），而这儿用不着它：关完重开，id 查重问的是当下真有哪些 */
  const resetLayout = (): void => {
    if (activeApi === null) return
    for (const panel of activeApi.panels) activeApi.removePanel(panel)
    openDefaults(activeApi)
  }

  // fixed inset-0 而不是 h-screen:#root 没有高度样式,而外壳不该去改宿主那张 html。
  // 主区那格 **min-h-0 少不了**:flex 子项默认 min-height:auto,内容一高就把状态栏挤出屏幕。
  //
  // **桌面那一节上绝不加 transform / filter / perspective / will-change**：fixed 浮层的
  // 定位基准一旦从视口改成这层，户口迁进本桌的浮层坐标全漂——这条是 CSS 的硬规矩，
  // 不是风格偏好。
  return (
    <div className="shell:fixed shell:inset-0 shell:flex shell:flex-col">
      <div className="shell:relative shell:min-h-0 shell:flex-1">
        {mountedIds.map((id) => {
          const on = id === activeId
          return (
            <section
              key={id}
              data-gwb-desktop={id}
              tabIndex={-1}
              aria-hidden={!on}
              inert={!on}
            className={
              on
                ? 'shell:absolute shell:inset-0 shell:visible shell:pointer-events-auto'
                : 'shell:absolute shell:inset-0 shell:invisible shell:pointer-events-none'
            }
            >
              <div className="shell:absolute shell:inset-0">
                <DockviewReact
                  components={COMPONENTS}
                  tabComponents={TAB_COMPONENTS}
                  theme={GWB_THEME}
                  onReady={(event) => onWellReady(id, event)}
                />
              </div>
              {/* 这口桌面的浮层户口：件里 radix Portal 的 container 指到它（args.shell.portal）。
                  自身不挡鼠标（pointer-events-none），radix 内容自己带 auto；**不带 z 轴**——
                  让 radix 内容的 z-50 直接参与根层叠，状态栏（z 更高）才压得住模态遮罩 */}
              <div className={`gwb-portal-host shell:pointer-events-none shell:absolute shell:inset-0`} />
            </section>
          )
        })}
      </div>
      <StatusBar
        specs={specs}
        focusIds={focusIds}
        home={home}
        desktops={desktops}
        activeDesktopId={activeId}
        savedLayouts={saved}
        saveFailed={saveFailed}
        onOpen={openSpec}
        onSwitchDesktop={(id) => switchTo(id)}
        onNewDesktop={(name) => createDesktop(name)}
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
  // 三张表都等到位再渲染：令牌是值的来源（页面级，件不用自己注）、dockview 那张管的是
  // `.dv-*` 与 `.dockview-theme-gwb`（类名不经我们的手）、外壳自己那张类名一律带
  // `shell:` 前缀——三张都全页有效，谁也不靠祖先关系围栏
  await Promise.all(args.styles.map((href) => loadStyle(href)))
  // 第四样：用户自己的外观样式（gwb-theme 件的字体覆盖 + 自定义 CSS）。它要压过令牌
  // 默认值，所以排在这三张 link 之后；theme 没装时这儿是个空操作
  await applyThemeStyle(args.host)
  document.documentElement.classList.add(...THEME_CLASSES)
  // 深色是默认态：令牌的 .dark 那套在这儿挂上，状态栏的开关之后随时摘。dispose 不摘
  // ——亮暗是页面级选择，热换外壳时新壳 boot 会再挂，这头摘了反而闪一下亮色
  document.documentElement.classList.add('dark')
  // **只是身份标记**：围栏是类名前缀（外壳那张表里的类一律 `shell:` 开头），这个属性
  // 不参与任何选择器。挂它是为了 devtools 里一眼认得出这棵树是谁的——井里每一格的件
  // 容器另挂它自己的那个，同样只作身份用
  root.setAttribute('data-gwb-plugin', SELF)

  const panes = await fetchPanes(args.host)
  // 导航还没有,把它从表里滤掉——listOpenable 排的第一条是导航那格,而画它的组件
  // 第四刀才有。留着的话 dockview 会拿不到 'nav' 组件
  const specs = listOpenable(panes).filter((s) => s.component === PLUGIN_COMPONENT)
  // 档赶在首帧之前到手——先铺默认再跳恢复，闪的那一下藏不住。没有档（第一次开机 /
  // 档废了）就地取缺省：一口「桌面 1」
  const initialDoc = (await fetchLayoutDoc(args.host)) ?? defaultDoc()
  const activeRow = initialDoc.desktops.find((d) => d.id === initialDoc.active)
  console.log(
    `[shell] 表里 ${specs.length} 格可开：${specs.map((s) => s.id).join('、') || '（表是空的）'}；` +
      `${initialDoc.desktops.length} 口桌面（活动：「${activeRow?.name ?? initialDoc.active}」），` +
      `存着 ${initialDoc.saved.length} 套布局`,
  )

  const reactRoot = createRoot(root)
  reactRoot.render(<App specs={specs} home={args.home} initialDoc={initialDoc} />)
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

/** 页面的公共面里本件用得着的两条。按形状收，正本在内核的词汇表包 */
declare global {
  interface Window {
    gwb: {
      command(command: string, args?: unknown): Promise<unknown>
      /** 内核事件口的页面那半：node 半 gwbKernel.emit 推的载荷全从这儿出（logger 推日志同一条路） */
      on(listener: (payload: unknown) => void): () => void
    }
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

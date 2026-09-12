import { useState, type ReactElement } from 'react'
import { FolderOpen, LayoutGrid, Monitor, Moon, Plus, RefreshCw, Sun, TriangleAlert } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { DesktopRow, SavedLayout } from '../layout.js'
import type { OpenableSpec } from '../openable.js'

/**
 * 井底下那条。**它是唯一不进窗格系统的东西**——也正因如此它兜得住「窗格全关光了怎么办」，
 * 也正因如此它是桌面切换器唯一合理的落点：它不属于任何一口桌面，站在所有井外面。
 *
 * 左起：桌面切换、布局菜单、可开窗格的＋列表、home 路径；右边：刷新、亮暗，布局没存上时
 * 再亮一格告警。
 *
 * 那张「可开的窗格」列表只有一个动作：**打开这一格，已经开着就聚焦**（都在活动那口井里）。
 * 「再来一份」不在这儿——一格开几份取决于它装的是什么内容（件调 `openPane` 时给的
 * `key`），不是这行状态栏点得出来的事。
 */

/** 一格的外观：状态栏上所有格共用，免得每处各写一套。h-6 的幽灵 pill，跟井里的标签同一套语言 */
const CELL =
  'shell:flex shell:h-6 shell:items-center shell:gap-1.5 shell:rounded-full shell:px-2.5 shell:text-xs shell:text-muted-foreground'
const BUTTON = `${CELL} shell:cursor-default shell:select-none shell:hover:bg-accent shell:hover:text-accent-foreground`

/**
 * 桌面那一格：列出桌面、切换、新建（格子变输入框）。交互照 LayoutBar 那套——
 * 内联输入而不是弹窗，跟这行状态栏的分量相称。
 */
function DesktopBar({
  desktops,
  activeId,
  onSwitch,
  onNew,
}: {
  desktops: readonly DesktopRow[]
  activeId: string
  onSwitch: (id: string) => void
  onNew: (name: string) => void
}): ReactElement {
  const [naming, setNaming] = useState<string | null>(null)
  const active = desktops.find((d) => d.id === activeId)

  /** 提交新桌面名。空名 / 纯空白照收——外壳会拿缺省名「桌面 N」顶上，那不是没起，是懒得起 */
  const commit = (): void => {
    if (naming === null) return
    onNew(naming.trim())
    setNaming(null)
  }

  if (naming !== null) {
    return (
      <input
        className="shell:bg-background shell:h-6 shell:w-36 shell:rounded-full shell:px-2.5 shell:text-xs shell:text-foreground shell:outline-none"
        value={naming}
        autoFocus
        placeholder="桌面名（Enter 建，Esc 弃）"
        onChange={(e) => setNaming(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setNaming(null)
        }}
        onBlur={commit}
      />
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={BUTTON} title="桌面：切换 / 新建（井常驻保活，切走的那口原样活着）">
        <Monitor className="shell:size-3.5" />
        {active?.name ?? '桌面'}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuLabel>桌面</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {desktops.map((row) => (
          <DropdownMenuItem key={row.id} onSelect={() => onSwitch(row.id)}>
            <span className="shell:flex-1">{row.name}</span>
            {/* 活动的不 disable——再点一次是幂等的；标出来是让人认得出自己在哪口 */}
            {row.id === activeId && <span className="shell:text-muted-foreground shell:ml-2 shell:text-[10px]">当前</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setNaming('')}>新建桌面…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * 布局那一格：已存布局清单（点谁铺谁）＋ 存当前为布局（格子变输入框）＋ 重置。
 * 存名字是内联输入，不是弹窗——跟这行状态栏的分量相称。
 */
function LayoutBar({
  saved,
  onApply,
  onSave,
  onDelete,
  onReset,
}: {
  saved: readonly SavedLayout[]
  onApply: (row: SavedLayout) => void
  onSave: (name: string) => void
  onDelete: (id: string) => void
  onReset: () => void
}): ReactElement {
  const [naming, setNaming] = useState<string | null>(null)

  /** 提交存名。空名 / 纯空白不存——那不是一套布局的名字，是没起 */
  const commit = (): void => {
    if (naming === null) return
    const name = naming.trim()
    if (name !== '') onSave(name)
    setNaming(null)
  }

  if (naming !== null) {
    return (
      <input
        className="shell:bg-background shell:h-6 shell:w-36 shell:rounded-full shell:px-2.5 shell:text-xs shell:text-foreground shell:outline-none"
        value={naming}
        autoFocus
        placeholder="布局名（Enter 存，Esc 弃）"
        onChange={(e) => setNaming(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setNaming(null)
        }}
        onBlur={commit}
      />
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={BUTTON} title="布局：存当前 / 打开已存的 / 重置">
        <LayoutGrid className="shell:size-3.5" />
        布局
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuLabel>已存的布局</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {saved.length === 0 ? (
          <DropdownMenuItem disabled>还没有存过布局</DropdownMenuItem>
        ) : (
          saved.map((row) => (
            <DropdownMenuItem key={row.id} onSelect={() => onApply(row)}>
              <span className="shell:flex-1">{row.name}</span>
              <span
                role="button"
                tabIndex={-1}
                className="shell:hover:bg-accent shell:ml-2 shell:rounded shell:px-1 shell:text-[10px]"
                title="删掉这套"
                onClick={(e) => {
                  // 别让这一下冒泡成「选中这一项」——那会走成应用这套布局
                  e.preventDefault()
                  e.stopPropagation()
                  onDelete(row.id)
                }}
              >
                ✕
              </span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setNaming('')}>存当前为布局…</DropdownMenuItem>
        <DropdownMenuItem onSelect={onReset}>重置布局（铺回全部格）</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function StatusBar({
  specs,
  focusIds,
  home,
  desktops,
  activeDesktopId,
  savedLayouts,
  saveFailed,
  onOpen,
  onSwitchDesktop,
  onNewDesktop,
  onApplyLayout,
  onSaveLayout,
  onDeleteLayout,
  onResetLayout,
  onRetrySave,
}: {
  /** 可开的窗格清单（已经滤掉导航那条） */
  specs: readonly OpenableSpec[]
  /**
   * 点了会走成**聚焦**的那几条（spec 基名）。「已开」那个记号标的就是它——
   * **记号跟点下去的效果同一个判据**（上游 `willFocus` 直接问 `planOpen`），
   * 不是「这一格有没有开着」：那两者会岔开，那时记号就开始说谎。
   */
  focusIds: readonly string[]
  /** home 目录的绝对路径 */
  home: string
  /** 桌面清单与活动桌面 id。井常驻保活，切换只是换哪口显示 */
  desktops: readonly DesktopRow[]
  activeDesktopId: string
  onSwitchDesktop: (id: string) => void
  /** 新建桌面并切过去。空名由外壳拿缺省名顶上 */
  onNewDesktop: (name: string) => void
  /** 人起名存下来的布局清单 */
  savedLayouts: readonly SavedLayout[]
  /** 布局档最后一次落盘成没成。失败亮一格，点一下重试 */
  saveFailed: boolean
  /** 打开这一格；已经开着就聚焦。**这张表只干这一件事**——「再来一份」是件说了算的事，
   * 它要几份取决于装的是什么内容（`openPane` 的 `key`），不是状态栏点得出来的 */
  onOpen: (spec: OpenableSpec) => void
  onApplyLayout: (row: SavedLayout) => void
  onSaveLayout: (name: string) => void
  onDeleteLayout: (id: string) => void
  onResetLayout: () => void
  onRetrySave: () => void
}): ReactElement {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggleDark = (): void => {
    const next = !dark
    setDark(next)
    // 令牌整套跟着换：井底、标签条、件里的东西一起变，一行都不用重新构建
    document.documentElement.classList.toggle('dark', next)
  }

  return (
    // **relative + z-[60] + pointer-events-auto**：z 压过桌面里户口迁进本桌的模态遮罩
    //（radix 内容 z-50 参与根层叠）——模态从此只盖本桌主区，状态栏永远可点（含切桌面
    // 逃出模态）。pointer-events 得**显式**给：radix 的模态开着时会把 body 整个锁成
    // pointer-events:none（锁页的标准手法），而那把锁**不跟着桌面走**——模态藏在别的
    // 桌面时锁还扣着，继承它的话连活动桌面带状态栏全变成「看得见点不动」。这两处显式
    // auto 不靠 body 的继承，锁再扣也只锁得住桌面以外的空白。判据见文档站 decisions
    <footer className="shell:relative shell:z-[60] shell:pointer-events-auto shell:bg-card shell:text-card-foreground shell:flex shell:h-8 shell:flex-none shell:items-center shell:gap-0.5 shell:border-t shell:px-1 shell:text-xs">
      <DesktopBar desktops={desktops} activeId={activeDesktopId} onSwitch={onSwitchDesktop} onNew={onNewDesktop} />

      <LayoutBar
        saved={savedLayouts}
        onApply={onApplyLayout}
        onSave={onSaveLayout}
        onDelete={onDeleteLayout}
        onReset={onResetLayout}
      />

      <DropdownMenu>
        <DropdownMenuTrigger className={BUTTON} title="打开一格窗格">
          <Plus className="shell:size-3.5" />
          打开窗格
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top">
          <DropdownMenuLabel>可开的窗格</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {specs.length === 0 ? (
            <DropdownMenuItem disabled>没有件注册过窗格</DropdownMenuItem>
          ) : (
            specs.map((spec) => {
              const opened = focusIds.includes(spec.id)
              return (
                <DropdownMenuItem key={spec.id} onSelect={() => onOpen(spec)}>
                  <span className="shell:flex-1">{spec.title}</span>
                  {/* 已开的不 disable——点它是聚焦,那是个有用的动作 */}
                  {opened && <span className="shell:text-muted-foreground shell:ml-2 shell:text-[10px]">已开</span>}
                </DropdownMenuItem>
              )
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className={CELL} title={home}>
        <FolderOpen className="shell:size-3.5" />
        {/* 只摆最后一段:路径很长,而人要认的是「我在哪个 home 里」。全长在 title 上 */}
        <span className="shell:font-mono">{home.split(/[\\/]/).filter(Boolean).at(-1) ?? home}</span>
      </div>

      <span className="shell:flex-1" />

      {saveFailed && (
        <button
          type="button"
          className={`${BUTTON} shell:text-destructive`}
          title="布局没存上——点一下立刻重试一次"
          onClick={onRetrySave}
        >
          <TriangleAlert className="shell:size-3.5" />
          布局没存上
        </button>
      )}

      {/* **整页 reload**，不是外壳内部重建：渲染层那条 boot 链（取注册表 → 取布局档 →
          恢复）原样重跑，注册表过时这类「boot 后才变的事」全吃到；而内核那半与页面
          加载无关（IPC 句柄在主进程启动时注册，宿主进程也活在那边），reload 对它就是
          一次普通的重新连线 */}
      <button
        type="button"
        className={BUTTON}
        title="刷新界面：整页重跑——重取注册表、按档恢复布局（宿主进程不动）"
        onClick={() => location.reload()}
      >
        <RefreshCw className="shell:size-3.5" />
        刷新
      </button>

      <button type="button" className={BUTTON} onClick={toggleDark} title={dark ? '切到亮色' : '切到暗色'}>
        {dark ? <Sun className="shell:size-3.5" /> : <Moon className="shell:size-3.5" />}
        {dark ? '亮色' : '暗色'}
      </button>
    </footer>
  )
}

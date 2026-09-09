import { useState, type ReactElement } from 'react'
import { FolderOpen, LayoutGrid, Moon, Plus, RefreshCw, Sun, TriangleAlert } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { SavedLayout } from '../layout.js'
import type { OpenableSpec } from '../openable.js'

/**
 * 井底下那条。**它是唯一不进窗格系统的东西**——也正因如此它兜得住「窗格全关光了怎么办」。
 *
 * 左起：布局菜单、可开窗格的＋列表、home 路径；右边：刷新、亮暗，布局没存上时再亮一格告警。
 */

/** 一格的外观：状态栏上所有格共用，免得每处各写一套。h-6 的幽灵 pill，跟井里的标签同一套语言 */
const CELL =
  'shell:flex shell:h-6 shell:items-center shell:gap-1.5 shell:rounded-full shell:px-2.5 shell:text-xs shell:text-muted-foreground'
const BUTTON = `${CELL} shell:cursor-default shell:select-none shell:hover:bg-accent shell:hover:text-accent-foreground`

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
  openIds,
  home,
  savedLayouts,
  saveFailed,
  onOpen,
  onApplyLayout,
  onSaveLayout,
  onDeleteLayout,
  onResetLayout,
  onRetrySave,
}: {
  /** 可开的窗格清单（已经滤掉导航那条） */
  specs: readonly OpenableSpec[]
  /** 此刻井里开着哪些 panel id */
  openIds: readonly string[]
  /** home 目录的绝对路径 */
  home: string
  /** 人起名存下来的布局清单 */
  savedLayouts: readonly SavedLayout[]
  /** 布局档最后一次落盘成没成。失败亮一格，点一下重试 */
  saveFailed: boolean
  onOpen: (spec: OpenableSpec, duplicate: boolean) => void
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
    <footer className="shell:bg-card shell:text-card-foreground shell:flex shell:h-8 shell:flex-none shell:items-center shell:gap-0.5 shell:border-t shell:px-1 shell:text-xs">
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
              const opened = openIds.includes(spec.id)
              return (
                <DropdownMenuItem key={spec.id} onSelect={() => onOpen(spec, false)}>
                  <span className="shell:flex-1">{spec.title}</span>
                  {/* 已开的不 disable——点它是聚焦,那是个有用的动作 */}
                  {opened && <span className="shell:text-muted-foreground shell:ml-2 shell:text-[10px]">已开</span>}
                  {spec.duplicable === true && (
                    <span
                      role="button"
                      tabIndex={-1}
                      className="shell:hover:bg-accent shell:ml-2 shell:rounded shell:px-1 shell:text-[10px]"
                      title="再开一份"
                      onClick={(e) => {
                        // 别让这一下冒泡成「选中这一项」——那会走成聚焦
                        e.preventDefault()
                        e.stopPropagation()
                        onOpen(spec, true)
                      }}
                    >
                      ＋一份
                    </span>
                  )}
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

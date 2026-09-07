import { useState, type ReactElement } from 'react'
import { FolderOpen, Moon, Plus, Sun } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { OpenableSpec } from '../openable.js'

/**
 * 井底下那条。**它是唯一不进窗格系统的东西**——也正因如此它兜得住「窗格全关光了怎么办」。
 *
 * 三格：可开窗格的＋列表、home 路径、亮暗开关。
 */

/** 一格的外观：状态栏上所有格共用，免得每处各写一套 */
const CELL = 'flex h-full items-center gap-1 px-2 text-xs text-muted-foreground'
const BUTTON = `${CELL} hover:bg-accent hover:text-accent-foreground cursor-default select-none`

export function StatusBar({
  specs,
  openIds,
  home,
  scopeRef,
  onOpen,
}: {
  /** 可开的窗格清单（已经滤掉导航那条） */
  specs: readonly OpenableSpec[]
  /** 此刻井里开着哪些 panel id */
  openIds: readonly string[]
  /** home 目录的绝对路径 */
  home: string
  /**
   * 外壳根那个元素。**菜单的 portal 要挂回它**——挂到 `body` 上就出了
   * `[data-gwb-plugin="…gwb-shell"]` 那层 scope，菜单一个类名都不生效。
   */
  scopeRef: HTMLElement | null
  onOpen: (spec: OpenableSpec, duplicate: boolean) => void
}): ReactElement {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggleDark = (): void => {
    const next = !dark
    setDark(next)
    // 令牌整套跟着换：井底、标签条、件里的东西一起变，一行都不用重新构建
    document.documentElement.classList.toggle('dark', next)
  }

  return (
    <footer className="bg-card text-card-foreground flex h-7 flex-none items-stretch border-t text-xs">
      <DropdownMenu>
        <DropdownMenuTrigger className={BUTTON} title="打开一格窗格">
          <Plus className="size-3.5" />
          打开窗格
        </DropdownMenuTrigger>
        {/* container 少不了，理由见 scopeRef 那条 prop */}
        <DropdownMenuContent align="start" side="top" container={scopeRef}>
          <DropdownMenuLabel>可开的窗格</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {specs.length === 0 ? (
            <DropdownMenuItem disabled>没有件注册过窗格</DropdownMenuItem>
          ) : (
            specs.map((spec) => {
              const opened = openIds.includes(spec.id)
              return (
                <DropdownMenuItem key={spec.id} onSelect={() => onOpen(spec, false)}>
                  <span className="flex-1">{spec.title}</span>
                  {/* 已开的不 disable——点它是聚焦,那是个有用的动作 */}
                  {opened && <span className="text-muted-foreground ml-2 text-[10px]">已开</span>}
                  {spec.duplicable === true && (
                    <span
                      role="button"
                      tabIndex={-1}
                      className="hover:bg-accent ml-2 rounded px-1 text-[10px]"
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
        <FolderOpen className="size-3.5" />
        {/* 只摆最后一段:路径很长,而人要认的是「我在哪个 home 里」。全长在 title 上 */}
        <span className="font-mono">{home.split(/[\\/]/).filter(Boolean).at(-1) ?? home}</span>
      </div>

      <span className="flex-1" />

      <button type="button" className={BUTTON} onClick={toggleDark} title={dark ? '切到亮色' : '切到暗色'}>
        {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        {dark ? '亮色' : '暗色'}
      </button>
    </footer>
  )
}

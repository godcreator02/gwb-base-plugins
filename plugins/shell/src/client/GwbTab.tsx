import { useEffect, useState, type ReactElement } from 'react'
import type { IDockviewPanelHeaderProps } from 'dockview-react'
import {
  FileText,
  FlaskConical,
  FolderOpen,
  Folders,
  Hash,
  PanelLeft,
  Puzzle,
  ScrollText,
  Store,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from 'cn'

/**
 * 井里每一格的标签：**卡头上的一块浅色圆角底**（6px，照 god-dsh-panes 的标签做）。
 *
 * 底色、hover、过渡全画在这个组件身上——dockview 只认得「组活不活 × 页显不显」四个
 * 静态组合，表达不了 hover，主题表那四个态的底色已经整个让位成透明。图标名是件注册
 * 窗格时给的（`registerPane({ icon })`），外壳开格时把它塞进面板 params 借道过来；
 * 认不出就画 Hash，不认得的图标名不该让标签空一块。
 *
 * 激活态订阅的是**这一格自己的** activePanel，不是 `api.isActive`——后者问的是
 * 「这个面板是不是整个井里唯一激活的那枚」，多组时只会有 maximal 一枚亮。每格各亮
 * 各的才对：标签说的是「这一格现在显示的是谁」。面板会被拖去别的组，所以两级订阅：
 * 先跟住自己在哪一组，再跟住那一组当前显示的是谁。
 */

/** 窗格注册用的图标裸名 → 图标。加一枚就添一行，名字跟注册那边的 kebab 裸名对齐 */
const ICONS: Record<string, LucideIcon> = {
  'scroll-text': ScrollText,
  store: Store,
  puzzle: Puzzle,
  'flask-conical': FlaskConical,
  'panel-left': PanelLeft,
  'folder-open': FolderOpen,
  'file-text': FileText,
  folders: Folders,
}

function iconFor(name: string | undefined): LucideIcon {
  return name === undefined || ICONS[name] === undefined ? Hash : ICONS[name]
}

export function GwbTab(props: IDockviewPanelHeaderProps): ReactElement {
  const params = (props.params ?? {}) as { icon?: string }
  const Icon = iconFor(params.icon)
  const panelId = props.api.id
  const [group, setGroup] = useState(props.api.group)
  const [active, setActive] = useState(() => props.api.group.activePanel?.id === panelId)

  useEffect(() => {
    const d = props.api.onDidGroupChange(() => setGroup(props.api.group))
    return () => d.dispose()
  }, [props.api])

  useEffect(() => {
    const sync = (): void => setActive(group.activePanel?.id === panelId)
    sync()
    const d = group.api.onDidActivePanelChange(sync)
    return () => d.dispose()
  }, [group, panelId])

  // **标题跟住 api.title**：件运行时改标题（setPaneTitle → dockview 的 setTitle）时
  // 自定义标签不会自己重渲染——订上这条事件，标题变了当场跟
  const [title, setTitle] = useState(props.api.title ?? '')
  useEffect(() => {
    setTitle(props.api.title ?? '')
    const d = props.api.onDidTitleChange(() => setTitle(props.api.title ?? ''))
    return () => d.dispose()
  }, [props.api])

  return (
    // h-full：槽位高 26px（标签条 32 减上下各 3px，见 dockview-theme.css 形状那段），
    // 跟 god-dsh-panes 的标签同尺寸；6px 圆角也同款
    <div
      className={cn(
        'group/tab flex h-full w-full min-w-0 cursor-grab items-center gap-1.5 rounded-md px-2 text-[13px] transition-colors select-none',
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
      title={title}
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{title}</span>
      <button
        type="button"
        aria-label="关闭"
        // 叉只在悬停这枚标签时出现（选中不出——选中的那一格正是人在看的）。位置一直
        // 占着、切的是 opacity：用 display 的话标签宽度会在鼠标进出时跳一下
        className={cn(
          'hover:bg-accent flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md transition-opacity',
          'opacity-0 group-hover/tab:opacity-70 hover:opacity-100',
        )}
        onClick={(e) => {
          // 别让这一下冒泡成「激活这一格」——关掉就该是关掉
          e.stopPropagation()
          props.api.close()
        }}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

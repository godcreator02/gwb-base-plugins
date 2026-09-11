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
 *
 * **预览格标一下，正式格一个像素都不变**：标例外不标常态——预览格至多一份，正式格
 * 可以很多。记号是标题前面**一枚小空心圆点**，它是个**形状**，激活未激活都认得出：
 * 未激活的标签本来整体就是 muted 前景色，拿「标题淡一档」当记号在那半边等于没标。
 * **不用斜体**：中文没有真斜体，浏览器画的伪斜体很难看。**双击标签转正**（把 `preview`
 * 从这一份的 params 上删掉），跟件调 `keepPane()` 是同一个动作。
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
  const params = (props.params ?? {}) as { icon?: string; preview?: unknown }
  const Icon = iconFor(params.icon)
  // 判 `=== true`：正式格身上没有这个键（转正就是把它删掉），不是写成 false。
  // params 换了 dockview 会拿新的重渲染这枚标签，所以直读 props 就够，不用自己订事件
  const preview = params.preview === true
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
        'shell:group/tab shell:flex shell:h-full shell:w-full shell:min-w-0 shell:cursor-grab shell:items-center shell:gap-1.5 shell:rounded-md shell:px-2 shell:text-[13px] shell:transition-colors shell:select-none',
        active
          ? 'shell:bg-muted shell:text-foreground'
          : 'shell:text-muted-foreground shell:hover:bg-accent/50 shell:hover:text-foreground',
      )}
      title={preview ? `${title}（预览格：下一次打开会顶掉它。双击这枚标签留住它）` : title}
      // **转正的手势版**：dockview 那个包里一处 `dblclick` 都没有，我们自己的标签也
      // 只挂了 onClick，这条手势本来空着；拖拽走的是 pointer 那条，不跟它打架。
      // 已经是正式格时这一下是空操作（那份 params 上本来就没有 preview 这个键）
      onDoubleClick={() => props.api.updateParameters({ preview: undefined })}
    >
      <Icon className="shell:size-4 shell:shrink-0" />
      {preview && (
        // **空心圆点，不是淡一档**：形状跟前景色深浅无关，未激活那半边照样认得出。
        // 边框走 currentColor，所以它跟着标签四态一起变色，不用自己配一套色
        <span
          role="img"
          aria-label="预览格：这一格会被下一次打开顶掉"
          className="shell:size-2 shell:shrink-0 shell:rounded-full shell:border shell:border-current"
        />
      )}
      <span className="shell:min-w-0 shell:truncate">{title}</span>
      <button
        type="button"
        aria-label="关闭"
        // 叉只在悬停这枚标签时出现（选中不出——选中的那一格正是人在看的）。位置一直
        // 占着、切的是 opacity：用 display 的话标签宽度会在鼠标进出时跳一下
        className={cn(
          'shell:hover:bg-accent shell:flex shell:size-5 shell:shrink-0 shell:cursor-pointer shell:items-center shell:justify-center shell:rounded-md shell:transition-opacity',
          'shell:opacity-0 shell:group-hover/tab:opacity-70 shell:hover:opacity-100',
        )}
        onClick={(e) => {
          // 别让这一下冒泡成「激活这一格」——关掉就该是关掉
          e.stopPropagation()
          props.api.close()
        }}
      >
        <X className="shell:size-3" />
      </button>
    </div>
  )
}

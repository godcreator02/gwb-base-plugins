import { useMemo, useState, type ReactElement } from 'react'
import { cn } from 'cn'
import {
  BookOpen,
  ChevronRight,
  Database,
  Ellipsis,
  Eye,
  EyeOff,
  FileCode,
  FileCode2,
  LayoutDashboard,
  Lock,
  Plug,
  Puzzle,
  ScrollText,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Terminal,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { ORPHANS, PLUGINS, type PluginRow, type SettingRow } from './fixtures'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/**
 * 设置那一格：**一个件一条横条**，点开是那个件自己的设置项。
 *
 * 两层是两个来源，别当成一件事：
 * - **外层**（清单、开关、卸载）是条目树的事——`ctx.loader`，此刻没有命令，见 fixtures
 * - **里层**（设置项）是 `gwb-settings` 的事——`settings.all` / `settings.set`，此刻就有
 *
 * 之所以把两层叠在一格里而不是分两格：找一个件的设置，人先想到的是「哪个件」而不是
 * 「哪个分区」。而 `settings.all` 交出来的东西是按 `section`（entryId / 包名）平铺的，
 * 那串东西不是给人读的。
 */

/**
 * 件报的 lucide 图标名 → 组件。**写成映射表不做动态取**：动态取要把整个 lucide
 * 引进束（上千个图标），而件报的名字本来就是有限的一小撮。认不出的走 Puzzle。
 */
const ICONS: Record<string, typeof Puzzle> = {
  'layout-dashboard': LayoutDashboard,
  terminal: Terminal,
  settings: SettingsIcon,
  'scroll-text': ScrollText,
  plug: Plug,
  'book-open': BookOpen,
  database: Database,
  sparkles: Sparkles,
  'file-code': FileCode,
  'file-code-2': FileCode2,
}

type Filter = 'all' | 'on' | 'off' | 'bad'

const FILTER_LABEL: Record<Filter, string> = { all: '全部', on: '开着', off: '停了', bad: '有问题' }

const STATE_BADGE: Record<PluginRow['state'], { text: string; variant: 'secondary' | 'outline' | 'destructive' }> = {
  active: { text: '运行中', variant: 'secondary' },
  stopped: { text: '已停', variant: 'outline' },
  failed: { text: '挂载失败', variant: 'destructive' },
}

/** 一项设置在盘上的唯一位置。`settings.set` 也按这三样定位 */
function slotKey(s: SettingRow): string {
  return `${s.scope}/${s.section}/${s.key}`
}

/** 一项设置的编辑控件。按 `type` 挑，跟 `SettingDef.type` 那四个值一一对应 */
function SettingField({
  row,
  value,
  onChange,
}: {
  row: SettingRow
  value: unknown
  onChange: (next: unknown) => void
}): ReactElement {
  const [bare, setBare] = useState(false)

  if (row.type === 'boolean') {
    return <Switch checked={value === true} onCheckedChange={onChange} />
  }
  if (row.type === 'number') {
    return (
      <Input
        type="number"
        className="h-8 w-32 text-right tabular-nums"
        value={typeof value === 'number' ? String(value) : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    )
  }
  if (row.type === 'secret') {
    return (
      <div className="flex items-center gap-1">
        <Input
          type={bare ? 'text' : 'password'}
          className="h-8 w-56 font-mono text-xs"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          title={bare ? '遮起来' : '看一眼。注意：secret 只影响这里的显示，盘上照样明文'}
          onClick={() => setBare((v) => !v)}
        >
          {bare ? <EyeOff /> : <Eye />}
        </Button>
      </div>
    )
  }
  return (
    <Input
      className="h-8 w-56"
      placeholder="（空）"
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/** 一项设置的一行：左边说明，右边控件 */
function SettingLine({
  row,
  value,
  onChange,
}: {
  row: SettingRow
  value: unknown
  onChange: (next: unknown) => void
}): ReactElement {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm">{row.title ?? row.key}</span>
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">{row.key}</code>
          {/* 机器级要标出来：这一项跨 home 共享，改了别的 home 也跟着变 */}
          {row.scope === 'machine' && (
            <Badge variant="outline" className="px-1 py-0 text-[10px]" title="全机一份，跨 home 共享">
              全机
            </Badge>
          )}
          {row.type === 'secret' && (
            <Badge variant="outline" className="px-1 py-0 text-[10px] text-amber-600 dark:text-amber-500" title="secret 只影响显示打码，盘上存的是明文">
              明文落盘
            </Badge>
          )}
        </div>
        {row.description !== undefined && (
          <p className="mt-0.5 text-xs text-muted-foreground">{row.description}</p>
        )}
      </div>
      <div className="shrink-0 pt-0.5">
        <SettingField row={row} value={value} onChange={onChange} />
      </div>
    </div>
  )
}

function PluginBar({
  row,
  open,
  onToggleOpen,
  enabled,
  onToggleEnabled,
  values,
  onValue,
  onAskRemove,
}: {
  row: PluginRow
  open: boolean
  onToggleOpen: () => void
  enabled: boolean
  onToggleEnabled: (next: boolean) => void
  values: Record<string, unknown>
  onValue: (slot: string, next: unknown) => void
  onAskRemove: () => void
}): ReactElement {
  const Icon = ICONS[row.icon] ?? Puzzle
  const badge = STATE_BADGE[row.state]
  const locked = row.lockable !== undefined

  return (
    <Collapsible open={open} onOpenChange={onToggleOpen} className="border-b border-border last:border-b-0">
      <div className={cn('flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40', !enabled && 'opacity-60')}>
        {/* 展开热区只包住左半——右半有开关和菜单，点它们不该顺带展开 */}
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none">
          <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          {/*
            两行的分工：第一行**只放认件用得着的三样**（名字、版本、状态），第二行放包名
            与设置项数。「N 项设置」当初挤在第一行,窄格里 flex 先压 truncate 的那一格,
            件名当场被截成一个字——名字是这一行最不该让位的东西
          */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{row.title}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{row.version}</span>
              <Badge variant={badge.variant} className="shrink-0 px-1.5 py-0 text-[10px]">
                {badge.text}
              </Badge>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{row.pkg}</span>
              {row.settings.length > 0 && (
                <span className="shrink-0 text-xs text-muted-foreground">· {row.settings.length} 项设置</span>
              )}
            </div>
          </div>
        </CollapsibleTrigger>

        <div className="flex shrink-0 items-center gap-1">
          {locked && <Lock className="size-3.5 text-muted-foreground" />}
          <Switch
            checked={enabled}
            disabled={locked}
            title={row.lockable ?? (enabled ? '停掉这个件（热卸载，不删包）' : '挂上这个件')}
            onCheckedChange={onToggleEnabled}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" title="更多">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            {/* 弹层挂窗格容器不挂 body——那一手在组件内部（见 ui/dropdown-menu.tsx 与 ./portal） */}
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onToggleOpen}>
                <SettingsIcon /> 更多设置
              </DropdownMenuItem>
              <DropdownMenuItem>
                <ScrollText /> 查看它的日志
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={row.removable !== true}
                title={row.removable === true ? undefined : '这个件是这一版的地基，卸不得'}
                onSelect={onAskRemove}
              >
                <Trash2 /> 卸载
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <CollapsibleContent>
        <div className="border-t border-border bg-muted/30">
          {row.state === 'failed' && row.error !== undefined && (
            <div className="flex items-start gap-2 border-b border-border px-3 py-2 text-xs text-destructive">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span className="font-mono break-all">{row.error}</span>
            </div>
          )}
          {row.settings.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              这个件没声明设置项。
              {row.state === 'stopped' && '（件停着的时候本来也声明不了——挂上再看）'}
            </p>
          ) : (
            <div className="divide-y divide-border">
              {row.settings.map((s) => (
                <SettingLine
                  key={slotKey(s)}
                  row={s}
                  value={values[slotKey(s)] ?? s.value}
                  onChange={(next) => onValue(slotKey(s), next)}
                />
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function SettingsPane(): ReactElement {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(['logger']))
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PLUGINS.map((p) => [p.entryId, p.enabled])),
  )
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [asking, setAsking] = useState<PluginRow | null>(null)
  const [alsoDropSettings, setAlsoDropSettings] = useState(true)
  const [orphansOpen, setOrphansOpen] = useState(false)

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return PLUGINS.filter((p) => {
      const on = enabled[p.entryId] ?? p.enabled
      if (filter === 'on' && !on) return false
      if (filter === 'off' && on) return false
      if (filter === 'bad' && p.state !== 'failed') return false
      if (q === '') return true
      return (
        p.title.toLowerCase().includes(q) ||
        p.pkg.toLowerCase().includes(q) ||
        p.entryId.toLowerCase().includes(q) ||
        p.settings.some((s) => s.key.includes(q) || (s.title ?? '').toLowerCase().includes(q))
      )
    })
  }, [search, filter, enabled])

  const onCount = PLUGINS.filter((p) => enabled[p.entryId] ?? p.enabled).length
  const badCount = PLUGINS.filter((p) => p.state === 'failed').length

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-border px-3 py-2">
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="搜件名、包名、设置项"
            className="h-8 pl-7"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1">
          {(['all', 'on', 'off', 'bad'] as Filter[]).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? 'secondary' : 'ghost'}
              className={cn(f === 'bad' && badCount > 0 && filter !== f && 'text-destructive')}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABEL[f]}
              {f === 'bad' && badCount > 0 ? ` ${badCount}` : ''}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {shown.map((p) => (
          <PluginBar
            key={p.entryId}
            row={p}
            open={openIds.has(p.entryId)}
            onToggleOpen={() =>
              setOpenIds((prev) => {
                const next = new Set(prev)
                if (next.has(p.entryId)) next.delete(p.entryId)
                else next.add(p.entryId)
                return next
              })
            }
            enabled={enabled[p.entryId] ?? p.enabled}
            onToggleEnabled={(v) => setEnabled((prev) => ({ ...prev, [p.entryId]: v }))}
            values={values}
            onValue={(slot, next) => setValues((prev) => ({ ...prev, [slot]: next }))}
            onAskRemove={() => setAsking(p)}
          />
        ))}

        {shown.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              {PLUGINS.length} 个件都被筛掉了。
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSearch('')
                  setFilter('all')
                }}
              >
                清筛选
              </Button>
            </span>
          </div>
        )}

        {/* 无主的设置单独一块，压在最后：它们不属于任何一个件，混进上面那张表只会让人以为件还在 */}
        {ORPHANS.length > 0 && search === '' && filter === 'all' && (
          <Collapsible open={orphansOpen} onOpenChange={setOrphansOpen} className="border-t border-border">
            <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left outline-none hover:bg-accent/40">
              <ChevronRight className={cn('size-4 text-muted-foreground transition-transform', orphansOpen && 'rotate-90')} />
              <span className="text-sm text-muted-foreground">无主的设置</span>
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                {ORPHANS.length}
              </Badge>
              <span className="text-xs text-muted-foreground">盘上有值，此刻没有件声明它</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="divide-y divide-border bg-muted/30">
                {ORPHANS.map((s) => (
                  <div key={slotKey(s)} className="flex items-center justify-between gap-4 px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{s.title ?? s.key}</span>
                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {s.scope}/{s.section}/{s.key}
                        </code>
                      </div>
                      {s.description !== undefined && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" className="shrink-0 text-destructive" title="把这一格从盘上抹掉">
                      <Trash2 /> 抹掉
                    </Button>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-1 text-xs text-muted-foreground">
        <span>
          {shown.length === PLUGINS.length ? `${PLUGINS.length} 个件` : `${shown.length} / ${PLUGINS.length} 个件`}
          {` · ${onCount} 个开着`}
          {badCount > 0 && ` · ${badCount} 个挂载失败`}
        </span>
        <span className="truncate font-mono" title="home 级落 <home>/settings.json，机器级落 <userData>/machine.json">
          settings.json · machine.json
        </span>
      </div>

      <AlertDialog open={asking !== null} onOpenChange={(v) => !v && setAsking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>卸载 {asking?.title}？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  会把 <code className="font-mono">{asking?.pkg}</code> 从这个 home 的条目里摘掉，并从盘上删包。
                  别的 home 不受影响。
                </p>
                <p className="text-destructive">
                  这一步没有还原：装回来要重新走一次装机，版本也不保证是同一个。
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* 设置值删不删要问：不问就静默留下一堆无主的值，问了正好接住上面那一块 */}
          <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={alsoDropSettings}
              onChange={(e) => setAlsoDropSettings(e.target.checked)}
            />
            <span>
              一并抹掉它的设置值
              <span className="block text-xs text-muted-foreground">
                不勾的话这些值留在盘上，之后会出现在「无主的设置」里
              </span>
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>算了</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90">
              卸载
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

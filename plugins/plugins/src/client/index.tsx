import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  BookOpen,
  ChevronRight,
  Database,
  Ellipsis,
  Eye,
  EyeOff,
  FileCode,
  FlaskConical,
  Hash,
  LayoutDashboard,
  PackageX,
  PanelLeft,
  Pencil,
  Plug,
  Puzzle,
  RotateCw,
  ScrollText,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Store,
  Terminal,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { cn } from 'cn'
import {
  acceptPackages,
  asResult,
  summarize,
  toRows,
  type EntryRow,
  type PackageRow,
} from './rows'
import {
  acceptSettings,
  orphanSettings,
  parseSlotKey,
  settingsForEntry,
  slotKey,
  type SettingRow,
} from './settings'
import { MarketTab } from './market'
import { installedIndex, type InstalledIndex } from './market-rows'
import { describePeers } from './peers'
import { describeUpdateAll } from './update-all'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
 * 浏览器半：插件管理那一格，**装卸与设置在同一格**。
 *
 * 一格两段：**「已装」与「可装」**。已装那条骨架是「一条目一条横条」，点开是那件自己的
 * 设置项——找一个件的设置，人先想到的是「哪个件」而不是「哪个分区」；`settings.all` 交
 * 出来的按 section 平铺的表不是给人读的，join 到条目上它才是。可装那段是 **registry 检索**
 * （`plugins.search`，装从哪条源来搜就到哪去），见 `market.tsx`。段切换之上摆着「直接装
 * 包名」的框——检索结果之外的包名，两段里都走它。
 *
 * 三层数据各走各的命令，取表谁挂了就取谁的：
 * - `plugins.list`：包 → 条目两层，装卸启停全在这层
 * - `settings.all`：设置项与值，按 section（home 级 = 条目裸 id，machine 级 = 包名）join
 * - `shell.plugins`：件自己 describe 的显示名与图标，认不出就回退
 *
 * 另有 `plugins.outdated` 查新版本：窗格挂上自动查一次，「检查更新」随时重查；查出来的
 * 按包名 join 到条目卡上。有过期包时「全部更新」才亮——先在格内列 `from → to` 确认，再调
 * `plugins.update-all` 一键热升（不重启），回执贴上来；页面随后会被 `shell.reload` 整页重载，
 * 所以那之前 busy 态一直挂着。没有事件推送，所以每次操作完把该重取的都重取一遍。
 */

const PANE_ID = 'installed'

/** 外壳调 `mountPane` 时给的那几样。按形状收，只收用得着的两格（正本在 shell 件的 client/types.ts） */
interface PaneArgs {
  host: { call: (command: string, args?: unknown) => Promise<unknown> }
  pane: { id: string; instance: string }
}

const LIST = 'plugins.list'
const INSTALL = 'plugins.install'
const ADD_ENTRY = 'plugins.add-entry'
const ENABLE = 'plugins.enable'
const DISABLE = 'plugins.disable'
const SET_LABEL = 'plugins.set-label'
const REMOVE_ENTRY = 'plugins.remove-entry'
const SETTINGS_ALL = 'settings.all'
const SETTINGS_SET = 'settings.set'
const SETTINGS_DELETE = 'settings.delete'
const SHELL_PLUGINS = 'shell.plugins'
/**
 * 共享包那张表。以前问的是内核的 `kernel.info`——单进程内核没有那条自省命令了，改成问
 * 本件的 node 半：它去 home 的 node_modules 里逐包读 `gwb.shared`，跟内核算 importmap 时
 * 扫的是同一批声明
 */
const SHARED = 'plugins.shared'
const OUTDATED = 'plugins.outdated'
const UPDATE = 'plugins.update'
const UPDATE_ALL = 'plugins.update-all'
const UNINSTALL = 'plugins.uninstall'

/** 本件自己的包名。一键热升的确认框要说一声「这一格会先关再开」 */
const OWN_PKG = '@godcreator02/gwb-plugins'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 件报的 lucide 图标名 → 组件。**写成映射表不做动态取**：动态取要把整个 lucide
 * 引进束（上千个图标），而件报的名字本来就是有限的一小撮。认不出的走 Puzzle。
 */
const ICONS: Record<string, typeof Puzzle> = {
  'scroll-text': ScrollText,
  store: Store,
  puzzle: Puzzle,
  'flask-conical': FlaskConical,
  hash: Hash,
  'panel-left': PanelLeft,
  'layout-dashboard': LayoutDashboard,
  terminal: Terminal,
  settings: SettingsIcon,
  plug: Plug,
  'book-open': BookOpen,
  database: Database,
  sparkles: Sparkles,
  'file-code': FileCode,
}

/** 件自己 describe 出来的那一格（shell.plugins 的形状，按形状收） */
interface Face {
  title?: string
  icon?: string
}

function acceptFaces(raw: unknown): Record<string, Face> {
  if (!Array.isArray(raw)) return {}
  const out: Record<string, Face> = {}
  for (const item of raw as unknown[]) {
    if (!isRecord(item)) continue
    const entryId = item['entryId']
    if (typeof entryId !== 'string' || entryId === '') continue
    const face: Face = {}
    const title = item['title']
    const icon = item['icon']
    if (typeof title === 'string' && title !== '') face.title = title
    if (typeof icon === 'string' && icon !== '') face.icon = icon
    out[entryId] = face
  }
  return out
}

/** 一个包的版本差距（`plugins.outdated` 的形状，按形状收——不 import node 半的类型） */
interface UpdateInfo {
  current: string
  latest: string
}

/** `plugins.outdated` 的 data → 包名 → 版本差距。认不出的丢掉、不崩，跟 rows.ts 一个规矩 */
function acceptUpdates(raw: unknown): Record<string, UpdateInfo> {
  const out: Record<string, UpdateInfo> = {}
  if (!isRecord(raw)) return out
  for (const [pkg, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) continue
    const current = entry['current']
    const latest = entry['latest']
    if (typeof current === 'string' && current !== '' && typeof latest === 'string' && latest !== '') {
      out[pkg] = { current, latest }
    }
  }
  return out
}

/** 条目的四态 → 徽标。文案与提示的正本在 rows.ts 的 FACES，这儿只管颜色 */
const STATE_BADGE: Record<EntryRow['state'], { text: string; variant: 'secondary' | 'outline' | 'destructive' }> = {
  active: { text: '挂上了', variant: 'secondary' },
  stalled: { text: '没挂上', variant: 'destructive' },
  disabled: { text: '已停用', variant: 'outline' },
  'disabled-running': { text: '停了还在跑', variant: 'destructive' },
}

type Filter = 'all' | 'on' | 'off' | 'bad'

const FILTER_LABEL: Record<Filter, string> = { all: '全部', on: '启用', off: '停用', bad: '异常' }

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
        className="plugins:h-8 plugins:w-32 plugins:text-right plugins:tabular-nums"
        value={typeof value === 'number' ? String(value) : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    )
  }
  if (row.type === 'secret') {
    return (
      <div className="plugins:flex plugins:items-center plugins:gap-1">
        <Input
          type={bare ? 'text' : 'password'}
          className="plugins:h-8 plugins:w-56 plugins:font-mono plugins:text-xs"
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
      className="plugins:h-8 plugins:w-56"
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
    <div className="plugins:flex plugins:items-start plugins:justify-between plugins:gap-4 plugins:px-3 plugins:py-2">
      <div className="plugins:min-w-0 plugins:flex-1">
        <div className="plugins:flex plugins:items-center plugins:gap-2">
          <span className="plugins:text-sm">{row.title ?? row.key}</span>
          <code className="plugins:rounded plugins:bg-muted plugins:px-1 plugins:py-0.5 plugins:font-mono plugins:text-[10px] plugins:text-muted-foreground">{row.key}</code>
          {row.live === false && (
            <Badge variant="outline" className="plugins:px-1 plugins:py-0 plugins:text-[10px]" title="此刻没有件声明它——件停着或者已经卸了">
              无主
            </Badge>
          )}
          {row.type === 'secret' && (
            <Badge
              variant="outline"
              className="plugins:px-1 plugins:py-0 plugins:text-[10px] plugins:text-amber-600 plugins:dark:text-amber-500"
              title="secret 只影响显示打码，盘上存的是明文"
            >
              明文落盘
            </Badge>
          )}
        </div>
        {row.description !== undefined && <p className="plugins:mt-0.5 plugins:text-xs plugins:text-muted-foreground">{row.description}</p>}
      </div>
      <div className="plugins:shrink-0 plugins:pt-0.5">
        <SettingField row={row} value={value} onChange={onChange} />
      </div>
    </div>
  )
}

/** 展开区里的一格：设置行序列 + 暂存语义的 footer。数据与动作都由上层供 */
function EntryCard({
  card,
  face,
  open,
  onToggleOpen,
  busy,
  draft,
  saveError,
  saving,
  onValue,
  onSave,
  onDiscard,
  onToggleEnabled,
  onAskRemove,
  onAskUninstall,
  update,
  onUpdate,
  editing,
  onRenameStart,
  onRenameChange,
  onRenameSave,
  onRenameCancel,
}: {
  card: {
    entry: EntryRow
    pkg: string
    spec?: string
    settings: SettingRow[]
  }
  face: Face | undefined
  open: boolean
  onToggleOpen: () => void
  busy: boolean
  draft: Record<string, unknown> | undefined
  saveError: string | undefined
  saving: boolean
  onValue: (slot: string, next: unknown) => void
  onSave: () => void
  onDiscard: () => void
  onToggleEnabled: (next: boolean) => void
  onAskRemove: () => void
  /** 卸载是**包级**动作：从这个条目进，摘的是这个包的全部条目 + 包本身 */
  onAskUninstall: () => void
  /** 这个包有新版本。undefined = 没查到它的份（没查、查失败、或者已是最新） */
  update?: UpdateInfo
  /** 给了才摆「更新」按钮 */
  onUpdate?: () => void
  editing: boolean
  onRenameStart: () => void
  onRenameChange: (value: string) => void
  onRenameSave: () => void
  onRenameCancel: () => void
}): ReactElement {
  const entry = card.entry
  const Icon = ICONS[face?.icon ?? ''] ?? Puzzle
  const badge = STATE_BADGE[entry.state]
  // __label__ 是改名行借道的槽，不算「改了设置」——它有自己的按钮与回执
  const dirtyCount = Object.keys(draft ?? {}).filter((slot) => slot !== '__label__').length
  // 改名行输入框里的字：借道的槽里只有名字，多半是字符串；不是就回落到现在的显示名
  const labelDraft = draft?.['__label__']
  const labelValue = typeof labelDraft === 'string' ? labelDraft : (entry.label ?? '')
  const title = entry.label ?? face?.title ?? entry.id

  return (
    <Collapsible open={open} onOpenChange={onToggleOpen} className="plugins:border-b plugins:border-border plugins:last:border-b-0">
      <div className={cn('plugins:flex plugins:items-center plugins:gap-3 plugins:px-3 plugins:py-2.5 plugins:hover:bg-accent/40', entry.disabled && 'plugins:opacity-60')}>
        {/* 展开热区只包住左半——右半有开关和菜单，点它们不该顺带展开 */}
        <CollapsibleTrigger className="plugins:flex plugins:min-w-0 plugins:flex-1 plugins:items-center plugins:gap-3 plugins:text-left plugins:outline-none">
          <ChevronRight className={cn('plugins:size-4 plugins:shrink-0 plugins:text-muted-foreground plugins:transition-transform', open && 'plugins:rotate-90')} />
          <Icon className="plugins:size-4 plugins:shrink-0 plugins:text-muted-foreground" />
          {/*
            两行的分工：第一行**只放认件用得着的三样**（名字、未保存、状态），第二行放
            身份（裸 id）与包名。id 是身份，日志和 yml 里出现的是它，label 只是给人看的皮
          */}
          <div className="plugins:min-w-0 plugins:flex-1">
            <div className="plugins:flex plugins:items-center plugins:gap-2">
              <span className="plugins:truncate plugins:text-sm plugins:font-medium">{title}</span>
              {dirtyCount > 0 && (
                <Badge className="plugins:shrink-0 plugins:border-0 plugins:bg-amber-500/15 plugins:px-1.5 plugins:py-0 plugins:text-[10px] plugins:text-amber-600 plugins:dark:text-amber-400">
                  未保存
                </Badge>
              )}
              <Badge variant={badge.variant} className="plugins:shrink-0 plugins:px-1.5 plugins:py-0 plugins:text-[10px]">
                {badge.text}
              </Badge>
              {update !== undefined && (
                <Badge
                  variant="outline"
                  className="plugins:shrink-0 plugins:border-amber-500/40 plugins:px-1.5 plugins:py-0 plugins:text-[10px] plugins:text-amber-600 plugins:dark:text-amber-400"
                  title={`home 里是 ${update.current}，registry 上最新是 ${update.latest}`}
                >
                  有新版 {update.current} → {update.latest}
                </Badge>
              )}
            </div>
            <div className="plugins:flex plugins:items-baseline plugins:gap-2">
              <span className="plugins:min-w-0 plugins:truncate plugins:font-mono plugins:text-xs plugins:text-muted-foreground" title={entry.entryId}>
                {entry.id}
              </span>
              <span className="plugins:shrink-0 plugins:font-mono plugins:text-xs plugins:text-muted-foreground">
                {card.pkg}
                {card.spec !== undefined ? `@${card.spec}` : ''}
              </span>
              {card.settings.length > 0 && (
                <span className="plugins:shrink-0 plugins:text-xs plugins:text-muted-foreground">· {card.settings.length} 项设置</span>
              )}
            </div>
          </div>
        </CollapsibleTrigger>

        <div className="plugins:flex plugins:shrink-0 plugins:items-center plugins:gap-1">
          {onUpdate !== undefined && (
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              title={`pnpm add ${card.pkg}@latest，不加条目。跑着的件重启内核后才换成新的`}
              onClick={onUpdate}
            >
              更新
            </Button>
          )}
          {/* 看的是 disabled 不是 active：没挂上的条目照样可以「停用」 */}
          <Switch
            checked={!entry.disabled}
            disabled={busy}
            title={!entry.disabled ? '停用（往 cordis.yml 写 disabled: true，当场卸下）' : '启用（抹掉 disabled，当场挂上）'}
            onCheckedChange={onToggleEnabled}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" title="更多">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onRenameStart}>
                <Pencil /> 改名
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={onAskRemove}>
                <Trash2 /> 删条目…
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={onAskUninstall}>
                <PackageX /> 卸载这个包…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 改名行在头部下面、折叠区外面——收着的时候也要能改名 */}
      {editing && (
        <div className="plugins:flex plugins:items-center plugins:gap-2 plugins:border-t plugins:border-border plugins:px-3 plugins:py-2">
          <Input
            autoFocus
            className="plugins:h-7 plugins:w-56 plugins:text-xs"
            placeholder="空着保存就是抹掉显示名"
            value={labelValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSave()
              if (e.key === 'Escape') onRenameCancel()
            }}
          />
          <Button size="xs" disabled={busy} onClick={onRenameSave}>
            保存
          </Button>
          <Button size="xs" variant="ghost" onClick={onRenameCancel}>
            取消
          </Button>
        </div>
      )}

      <CollapsibleContent>
        <div className="plugins:border-t plugins:border-border plugins:bg-muted/30">
          {/* 挂不上的原因人话先说——attention 的两态（没挂上、停了还在跑）都是最该被看见的 */}
          {entry.attention && (
            <div className="plugins:flex plugins:items-start plugins:gap-2 plugins:border-b plugins:border-border plugins:px-3 plugins:py-2 plugins:text-xs plugins:text-amber-600 plugins:dark:text-amber-400">
              <TriangleAlert className="plugins:mt-0.5 plugins:size-3.5 plugins:shrink-0" />
              <span>{entry.hint}</span>
            </div>
          )}
          {card.settings.length === 0 ? (
            <p className="plugins:px-3 plugins:py-3 plugins:text-xs plugins:text-muted-foreground">
              这件没声明设置项。
              {entry.state !== 'active' && '（件挂上了才会声明——没挂上时这里多半是空的）'}
            </p>
          ) : (
            <div className="plugins:divide-y plugins:divide-border">
              {card.settings.map((s) => {
                const slot = slotKey(s)
                return (
                  <SettingLine
                    key={slot}
                    row={s}
                    value={draft?.[slot] !== undefined ? draft[slot] : s.value}
                    onChange={(next) => onValue(slot, next)}
                  />
                )
              })}
            </div>
          )}
          {dirtyCount > 0 && (
            <div className="plugins:flex plugins:items-center plugins:gap-2 plugins:border-t plugins:border-border plugins:px-3 plugins:py-2">
              {saveError !== undefined ? (
                <span className="plugins:flex-1 plugins:text-xs plugins:break-all plugins:whitespace-pre-wrap plugins:text-destructive">{saveError}</span>
              ) : (
                <span className="plugins:flex-1 plugins:text-xs plugins:text-muted-foreground">
                  改了 {dirtyCount} 项，还没存盘
                </span>
              )}
              <Button size="xs" variant="ghost" disabled={saving} onClick={onDiscard}>
                放弃
              </Button>
              <Button size="xs" disabled={saving} onClick={onSave}>
                {saving ? '存着…' : '保存'}
              </Button>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function PluginsPane({ args }: { args: PaneArgs }): ReactElement {
  /** null 是「还没取到」，跟「取到了但一个包都没有」不是一回事——三份表各自独立 */
  const [rows, setRows] = useState<PackageRow[] | null>(null)
  const [settingsRows, setSettingsRows] = useState<SettingRow[] | null>(null)
  const [faces, setFaces] = useState<Record<string, Face>>({})
  /** 声明了 gwb.shared 的包（页面级共享基础设施）。内核没这字段时回退从 shared 表推导 */
  const [sharedPkgs, setSharedPkgs] = useState<Set<string> | null>(null)
  /** 共享包各自提供的裸名，展示用 */
  const [provided, setProvided] = useState<Record<string, string[]>>({})
  /** 取表本身没成时的那句话。跟操作的回执分开——它说的是整格都没有内容 */
  const [listError, setListError] = useState('')
  /** 上一次操作的回执。**不吞 error**，尤其 set-label 在没装数据件时会回一句话 */
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  /** 展开着的条目。以 entryId 记——跨重取表稳定 */
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set())
  /** 每条条目的设置草稿：slot（转义过的定位串）→ 新值。空对象 = 没 dirty */
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({})
  /** 就地改名：正在编的那条与输入框里的字（塞进 drafts 的 __label__ 槽里过渡） */
  const [editing, setEditing] = useState<string | null>(null)
  /** 删条目确认框：对象 + 「一并抹掉设置值」 */
  const [asking, setAsking] = useState<{ card: Card; homeSettings: SettingRow[] } | null>(null)
  const [alsoDrop, setAlsoDrop] = useState(true)
  /** 卸载确认框：**包级**——这个包的全部条目 + 包本身。isSelf 是「卸的是本件自己」 */
  const [askingUninstall, setAskingUninstall] = useState<{
    pkg: string
    count: number
    settings: SettingRow[]
    isSelf: boolean
  } | null>(null)
  const [uninstallDrop, setUninstallDrop] = useState(false)
  const [installInput, setInstallInput] = useState('')
  const [orphansOpen, setOrphansOpen] = useState(false)
  const [sharedOpen, setSharedOpen] = useState(false)
  const [noEntryOpen, setNoEntryOpen] = useState(false)
  /** 「已装 / 可装」两段。可装那段见 market.tsx */
  const [tab, setTab] = useState<'installed' | 'market'>('installed')
  /** outdated 的表。null 是「还没查到」——跟「查到了、全都最新」（空对象）分得开 */
  const [updates, setUpdates] = useState<Record<string, UpdateInfo> | null>(null)
  const [checking, setChecking] = useState(false)
  /** 一键热升的确认框开着；`updatingAll` 是点了确认、命令还没回来（或回来了、页面正等着被重载） */
  const [askingUpdateAll, setAskingUpdateAll] = useState(false)
  const [updatingAll, setUpdatingAll] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    // 四份表**各取各的、各败各的**——设置件没装时插件管理照样能用，只是展开区空着
    const [list, settings, faces, shared] = await Promise.allSettled([
      args.host.call(LIST),
      args.host.call(SETTINGS_ALL),
      args.host.call(SHELL_PLUGINS),
      args.host.call(SHARED),
    ])
    if (list.status === 'fulfilled') {
      const result = asResult(list.value)
      if (result.ok) {
        setRows(toRows(acceptPackages(result.data)))
        setListError('')
      } else {
        setListError(result.error ?? '')
      }
    } else {
      setListError(`取不到表：${String(list.reason)}`)
    }
    if (settings.status === 'fulfilled') {
      const result = asResult(settings.value)
      setSettingsRows(result.ok ? acceptSettings(result.data) : null)
    } else {
      setSettingsRows(null)
    }
    if (faces.status === 'fulfilled') {
      const result = asResult(faces.value)
      if (result.ok) setFaces(acceptFaces(result.data))
    }
    if (shared.status === 'fulfilled') {
      const result = asResult(shared.value)
      // 形状是 { packages: { 包名 → 它提供的裸名 } }。**空数组也算共享包**：gwb-tokens 只出
      // 一张令牌表、一个裸名都不提供，可它照样不该出现在「装了没挂条目」那一区里
      const packages = isRecord(result.data) ? result.data['packages'] : undefined
      if (result.ok && isRecord(packages)) {
        const providedMap: Record<string, string[]> = {}
        for (const [pkg, bares] of Object.entries(packages)) {
          providedMap[pkg] = Array.isArray(bares) ? bares.filter((v): v is string => typeof v === 'string') : []
        }
        setSharedPkgs(new Set(Object.keys(providedMap)))
        setProvided(providedMap)
      }
    }
  }, [args.host])

  /**
   * 查一遍新版本。`manual` 说这次是谁发起的：按钮点的把失败摆上 notice；挂上时自动那次
   * 失败就安静放下（`updates` 回 null，界面上什么都不标，也不挡清单）。
   */
  const checkOutdated = useCallback(
    async (manual: boolean): Promise<void> => {
      setChecking(true)
      try {
        const result = asResult(await args.host.call(OUTDATED))
        if (!result.ok) {
          setUpdates(null)
          if (manual) setNotice({ ok: false, text: result.error ?? '' })
          return
        }
        // 命令的信封里还套着一层回执（outdated 自己的 ok/error），同样不吞
        const receipt = isRecord(result.data) ? result.data : {}
        if (receipt['ok'] === true) {
          setUpdates(acceptUpdates(receipt['updates']))
        } else {
          setUpdates(null)
          if (manual) {
            setNotice({ ok: false, text: typeof receipt['error'] === 'string' ? receipt['error'] : '查新版本没成' })
          }
        }
      } catch (err: unknown) {
        setUpdates(null)
        if (manual) setNotice({ ok: false, text: String(err) })
      } finally {
        setChecking(false)
      }
    },
    [args.host],
  )

  useEffect(() => {
    let alive = true
    void refresh().catch((err: unknown) => {
      if (alive) setListError(`取不到表：${String(err)}`)
    })
    // 挂上就顺手查一次新版本。查不成就安静放下——没有 pnpm 不该每开一次格都闹一场，
    // 「检查更新」按钮点一下才把原因摆上脸
    void checkOutdated(false)
    return () => {
      alive = false
    }
  }, [refresh, checkOutdated])

  /**
   * 跑一条命令，然后**一定重新取一遍表**——没有事件推送，不重取的话界面会停在旧样子上，
   * 而那正是「点了没反应」这种最难查的现象。
   */
  const run = async (command: string, params: unknown, done: string): Promise<void> => {
    setBusy(true)
    try {
      const result = asResult(await args.host.call(command, params))
      setNotice(result.ok ? { ok: true, text: done } : { ok: false, text: result.error ?? '' })
    } catch (err: unknown) {
      setNotice({ ok: false, text: String(err) })
    }
    try {
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  // ── 派生：把三层表摊平成「一条目一卡」────────────────────────────────────────
  interface Card {
    entry: EntryRow
    pkg: string
    spec?: string
    settings: SettingRow[]
  }

  const cards = useMemo<Card[]>(() => {
    const out: Card[] = []
    for (const row of rows ?? []) {
      for (const entry of row.entries) {
        out.push({
          entry,
          pkg: row.pkg,
          spec: row.spec,
          settings: settingsRows === null ? [] : settingsForEntry(settingsRows, entry.entryId),
        })
      }
    }
    return out
  }, [rows, settingsRows])

  /** 「可装」那段吃的已装索引：从已取的这份表推导，不再二次调 plugins.list */
  const marketIndex = useMemo<InstalledIndex | null>(() => (rows === null ? null : installedIndex(rows)), [rows])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return cards.filter((card) => {
      const on = !card.entry.disabled
      if (filter === 'on' && !on) return false
      if (filter === 'off' && on) return false
      if (filter === 'bad' && !card.entry.attention) return false
      if (q === '') return true
      return (
        card.entry.id.toLowerCase().includes(q) ||
        (card.entry.label ?? '').toLowerCase().includes(q) ||
        card.pkg.toLowerCase().includes(q) ||
        card.entry.entryId.toLowerCase().includes(q) ||
        card.settings.some(
          (s) => s.key.toLowerCase().includes(q) || (s.title ?? '').toLowerCase().includes(q),
        )
      )
    })
  }, [cards, filter, search])

  /** 已装但没挂条目的包，按身份一分为二：共享基础设施（tokens、共享 react 这类）与待挂条目的件 */
  const noEntryRows = useMemo(() => (rows ?? []).filter((row) => row.entries.length === 0), [rows])
  const sharedRows = useMemo(
    () => noEntryRows.filter((row) => sharedPkgs?.has(row.pkg) === true),
    [noEntryRows, sharedPkgs],
  )
  /** sharedPkgs 没取到（内核自省口挂了）时全按待挂算——那是旧行为，不添新错 */
  const pendingRows = useMemo(
    () => noEntryRows.filter((row) => sharedPkgs?.has(row.pkg) !== true),
    [noEntryRows, sharedPkgs],
  )

  const orphans = useMemo(() => {
    if (settingsRows === null) return []
    return orphanSettings(settingsRows, cards.map((card) => card.entry.entryId))
  }, [settingsRows, cards])

  const summary = useMemo(() => summarize(rows ?? []), [rows])
  const onCount = cards.filter((card) => !card.entry.disabled).length
  const badCount = cards.filter((card) => card.entry.attention).length

  // ── 动作───────────────────────────────────────────────────────────────────

  const toggleOpen = (entryId: string): void =>
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      return next
    })

  const onValue = (entryId: string, slot: string, next: unknown): void =>
    setDrafts((prev) => ({ ...prev, [entryId]: { ...prev[entryId], [slot]: next } }))

  const discardEntry = (entryId: string): void =>
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[entryId]
      return next
    })

  /** 保存一条条目的草稿：逐键 settings.set，**有一个失败就全留在草稿里** */
  const saveEntry = async (entryId: string): Promise<void> => {
    const draft = drafts[entryId]
    const slots = Object.entries(draft ?? {}).filter(([slot]) => slot !== '__label__')
    if (slots.length === 0) return
    setSavingId(entryId)
    const failures: string[] = []
    for (const [slot, value] of slots) {
      const pos = parseSlotKey(slot)
      try {
        const result = asResult(await args.host.call(SETTINGS_SET, { ...pos, value }))
        if (!result.ok) failures.push(`${pos.section}.${pos.key}：${result.error ?? ''}`)
      } catch (err: unknown) {
        failures.push(`${pos.section}.${pos.key}：${String(err)}`)
      }
    }
    setSavingId(null)
    if (failures.length > 0) {
      setSaveErrors((prev) => ({ ...prev, [entryId]: failures.join('\n') }))
      return
    }
    setSaveErrors((prev) => {
      const next = { ...prev }
      delete next[entryId]
      return next
    })
    discardEntry(entryId)
    // 设置落了盘，重取 settings 一份让「无主/全机」那几个徽标跟上
    const settings = await args.host.call(SETTINGS_ALL)
    const result = asResult(settings)
    if (result.ok) setSettingsRows(acceptSettings(result.data))
    setNotice({ ok: true, text: '设置存好了' })
  }

  const saveLabel = async (): Promise<void> => {
    if (editing === null) return
    const entry = cards.find((card) => card.entry.entryId === editing)?.entry
    const value = drafts[editing]?.['__label__']
    const text = typeof value === 'string' ? value : (entry?.label ?? '')
    setEditing(null)
    discardEntry(editing)
    // **空串是合法的，意思是抹掉**——不 trim 成 undefined、也不当成「没改」
    await run(SET_LABEL, { entryId: editing, label: text }, text === '' ? '显示名抹掉了' : `显示名改成了「${text}」`)
  }

  const install = async (): Promise<void> => {
    const pkg = installInput.trim()
    if (pkg === '') return
    setBusy(true)
    try {
      const result = asResult(await args.host.call(INSTALL, { pkg }))
      if (!result.ok) {
        setNotice({ ok: false, text: result.error ?? '' })
      } else {
        const inner = isRecord(result.data) ? result.data : {}
        if (inner['ok'] === false) {
          const errText = inner['error']
          const message = typeof errText === 'string' && errText !== '' ? errText : '装包没成'
          const tail = typeof inner['tail'] === 'string' && inner['tail'] !== '' ? `\n${inner['tail']}` : ''
          setNotice({ ok: false, text: `${message}${tail}` })
        } else {
          const entryId = typeof inner['entryId'] === 'string' ? `，条目 ${inner['entryId']}` : ''
          // peer 没装上时件本身照样是装上了的，可提示不能是绿的——那条依赖跑起来会扑空
          const peers = describePeers(inner)
          setNotice({ ok: peers.ok, text: `装好了 ${pkg}${entryId}${peers.line}` })
        }
      }
    } catch (err: unknown) {
      setNotice({ ok: false, text: String(err) })
    }
    setInstallInput('')
    await refresh()
    setBusy(false)
  }

  /** 升一个包到最新。run 自己会重取表；再把 outdated 重查一遍，让「有新版」徽标跟上 */
  const updatePkg = (pkg: string): void => {
    void run(UPDATE, { pkg }, `${pkg} 升到最新了。跑着的件重启内核后才换成新的（要热生效点「全部更新」）`).then(() => {
      void checkOutdated(false)
    })
  }

  /** 过期清单，按包名排——确认框里列的、「全部更新」亮不亮，都看它 */
  const outdatedRows = useMemo(
    () => Object.entries(updates ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    [updates],
  )

  /**
   * 一键热升。回执贴到 notice 上；**reload 在路上时 busy 不撤**——页面随时会被 `shell.reload`
   * 整页重载（自己也升了的话先是这一格关掉再开），撤了只会让人在最后一帧点到什么。
   * 没在路上（命令表里没 shell.reload、或者没成）才照常重取表、撤 busy
   */
  const updateAll = async (): Promise<void> => {
    setBusy(true)
    setUpdatingAll(true)
    let reloading = false
    try {
      const view = describeUpdateAll(asResult(await args.host.call(UPDATE_ALL)))
      reloading = view.reloading
      setNotice({ ok: view.ok, text: view.text })
    } catch (err: unknown) {
      setNotice({ ok: false, text: String(err) })
    }
    setAskingUpdateAll(false)
    if (reloading) return
    setUpdatingAll(false)
    try {
      await refresh()
      await checkOutdated(false)
    } finally {
      setBusy(false)
    }
  }

  const removeEntry = async (): Promise<void> => {
    if (asking === null) return
    const {
      card: { entry, settings },
    } = asking
    setBusy(true)
    try {
      const result = asResult(await args.host.call(REMOVE_ENTRY, { entryId: entry.entryId }))
      if (!result.ok) {
        setNotice({ ok: false, text: result.error ?? '' })
      } else {
        let wiped = 0
        if (alsoDrop) {
          for (const s of settings) {
            try {
              await args.host.call(SETTINGS_DELETE, { section: s.section, key: s.key })
              wiped += 1
            } catch {
              // 一条没抹掉不算整件事失败——它留在「无主的设置」里还找得到
            }
          }
        }
        setNotice({ ok: true, text: `条目 ${entry.id} 删了，包没动${wiped > 0 ? `，抹掉了 ${wiped} 项设置值` : ''}` })
      }
      await refresh()
    } finally {
      setBusy(false)
    }
    setAsking(null)
  }

  const askRemove = (card: Card): void => {
    // 设置没有第二份了：settings.json 一份，section 就是条目裸 id——展开区里那几张全是
    setAlsoDrop(true)
    setAsking({ card, homeSettings: card.settings })
  }

  /** 弹卸载确认框。条目数现场数（cards 里这个包的条目），设置值也是现场收 */
  const askUninstall = (pkg: string): void => {
    const own = cards.filter((card) => card.pkg === pkg)
    setUninstallDrop(false)
    setAskingUninstall({
      pkg,
      count: own.length,
      settings: own.flatMap((card) => card.settings),
      isSelf: pkg === '@godcreator02/gwb-plugins',
    })
  }

  const uninstallPkg = async (): Promise<void> => {
    if (askingUninstall === null) return
    const { pkg, settings } = askingUninstall
    setBusy(true)
    try {
      const result = asResult(await args.host.call(UNINSTALL, { pkg }))
      if (!result.ok) {
        // 命令的信封里还套着一层回执（uninstall 自己的 ok/error），同样不吞
        const inner = isRecord(result.data) ? result.data : {}
        const detail = inner['ok'] === false && typeof inner['error'] === 'string' ? `\n${inner['error']}` : ''
        setNotice({ ok: false, text: `${result.error ?? '卸载没成'}${detail}` })
      } else {
        let wiped = 0
        if (uninstallDrop) {
          for (const s of settings) {
            try {
              await args.host.call(SETTINGS_DELETE, { section: s.section, key: s.key })
              wiped += 1
            } catch {
              // 一条没抹掉不算整件事失败——它留在「无主的设置」里还找得到
            }
          }
        }
        setNotice({
          ok: true,
          text: `${pkg} 卸载了，包与条目一起拿掉${wiped > 0 ? `，抹掉了 ${wiped} 项设置值` : '；设置与数据留盘'}${
            pkg === '@godcreator02/gwb-plugins' ? '。本件自己的格还开着，关掉它就没了' : ''
          }`,
        })
      }
      await refresh()
    } finally {
      setBusy(false)
    }
    setAskingUninstall(null)
  }

  // ── 画─────────────────────────────────────────────────────────────────────

  return (
    <div className="plugins:flex plugins:h-full plugins:flex-col plugins:bg-background plugins:text-foreground">
      {/* 直接装包名的框摆在段切换之上：清单外的、第三方的件，两段里都走它 */}
      <div className="plugins:border-b plugins:border-border plugins:px-3 plugins:py-2">
        <div className="plugins:flex plugins:items-center plugins:gap-2">
          <Input
            className="plugins:h-8 plugins:flex-1 plugins:font-mono plugins:text-xs"
            placeholder="直接装包名，如 @godcreator02/gwb-hello（可带版本 @scope/name@^1.0）"
            value={installInput}
            onChange={(e) => setInstallInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy && installInput.trim() !== '') void install()
            }}
          />
          <Button size="sm" disabled={busy || installInput.trim() === ''} onClick={() => void install()}>
            装
          </Button>
        </div>
      </div>

      {notice !== null && (
        <div
          className={`plugins:flex plugins:items-start plugins:gap-2 plugins:border-b plugins:border-border plugins:px-3 plugins:py-2 plugins:text-xs ${
            notice.ok ? 'plugins:text-muted-foreground' : 'plugins:text-destructive'
          }`}
        >
          <span className="plugins:flex-1 plugins:whitespace-pre-wrap plugins:break-all">{notice.text}</span>
          <Button size="xs" variant="ghost" onClick={() => setNotice(null)}>
            知道了
          </Button>
        </div>
      )}

      {/* 「已装」与「可装」两段。刷新按钮两段共用——可装那段的「装没装」吃同一份表 */}
      <div className="plugins:flex plugins:items-center plugins:gap-1 plugins:border-b plugins:border-border plugins:px-3 plugins:py-1.5">
        <Button size="sm" variant={tab === 'installed' ? 'secondary' : 'ghost'} onClick={() => setTab('installed')}>
          已装
        </Button>
        <Button size="sm" variant={tab === 'market' ? 'secondary' : 'ghost'} onClick={() => setTab('market')}>
          可装
        </Button>
        <span className="plugins:flex-1" />
        <Button
          size="sm"
          variant="ghost"
          title="查一遍 home 里已装的包哪些有新版本"
          disabled={checking || busy}
          onClick={() => void checkOutdated(true)}
        >
          {checking ? '查着…' : '检查更新'}
        </Button>
        {/* 有过期包才亮：没查过（null）与查了全新（空表）都是灰的 */}
        <Button
          size="sm"
          variant={outdatedRows.length > 0 ? 'secondary' : 'ghost'}
          title={
            outdatedRows.length > 0
              ? `一键热升 ${outdatedRows.length} 个包：一趟 pnpm add，逐条停用→启用重挂新版本，不重启，最后整页重载`
              : '没有过期的包'
          }
          disabled={checking || busy || outdatedRows.length === 0}
          onClick={() => setAskingUpdateAll(true)}
        >
          {updatingAll ? '升级中…' : '全部更新'}
          {!updatingAll && outdatedRows.length > 0 ? ` ${outdatedRows.length}` : ''}
        </Button>
        <Button size="icon-sm" variant="ghost" title="重新取一遍" disabled={busy} onClick={() => void refresh()}>
          <RotateCw />
        </Button>
      </div>

      {tab === 'market' ? (
        <MarketTab host={args.host} installed={marketIndex} busy={busy} onChanged={refresh} />
      ) : (
        <>
          <div className="plugins:flex plugins:flex-wrap plugins:items-center plugins:gap-x-2 plugins:gap-y-2 plugins:border-b plugins:border-border plugins:px-3 plugins:py-2">
            <div className="plugins:relative plugins:min-w-40 plugins:flex-1">
              <Search className="plugins:pointer-events-none plugins:absolute plugins:top-1/2 plugins:left-2 plugins:size-3.5 plugins:-translate-y-1/2 plugins:text-muted-foreground" />
              <Input
                type="search"
                placeholder="搜件名、包名、设置项"
                className="plugins:h-8 plugins:pl-7"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="plugins:flex plugins:items-center plugins:gap-1">
              {(['all', 'on', 'off', 'bad'] as Filter[]).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={filter === f ? 'secondary' : 'ghost'}
                  className={cn(f === 'bad' && badCount > 0 && filter !== f && 'plugins:text-destructive')}
                  onClick={() => setFilter(f)}
                >
                  {FILTER_LABEL[f]}
                  {f === 'bad' && badCount > 0 ? ` ${badCount}` : ''}
                </Button>
              ))}
            </div>
          </div>

          <div className="plugins:flex-1 plugins:overflow-auto">
            {listError !== '' && <p className="plugins:p-6 plugins:text-sm plugins:whitespace-pre-wrap plugins:text-destructive">{listError}</p>}

            {listError === '' && rows !== null && cards.length === 0 && (
              <p className="plugins:p-6 plugins:text-sm plugins:text-muted-foreground">home 里一个件都没挂。</p>
            )}

            {shown.map((card) => (
              <EntryCard
                key={card.entry.entryId}
                card={card}
                face={faces[card.entry.entryId]}
                open={openIds.has(card.entry.entryId)}
                onToggleOpen={() => toggleOpen(card.entry.entryId)}
                busy={busy}
                draft={drafts[card.entry.entryId]}
                saveError={saveErrors[card.entry.entryId]}
                saving={savingId === card.entry.entryId}
                onValue={(slot, next) => onValue(card.entry.entryId, slot, next)}
                onSave={() => void saveEntry(card.entry.entryId)}
                onDiscard={() => discardEntry(card.entry.entryId)}
                onToggleEnabled={(next) =>
                  void run(
                    next ? ENABLE : DISABLE,
                    { entryId: card.entry.entryId },
                    next ? `条目 ${card.entry.id} 启用了` : `条目 ${card.entry.id} 停用了`,
                  )
                }
                onAskRemove={() => askRemove(card)}
            onAskUninstall={() => askUninstall(card.pkg)}
                update={updates?.[card.pkg]}
                onUpdate={
                  updates?.[card.pkg] !== undefined ? () => updatePkg(card.pkg) : undefined
                }
                editing={editing === card.entry.entryId}
                onRenameStart={() => {
                  setEditing(card.entry.entryId)
                  setDrafts((prev) => ({ ...prev, [card.entry.entryId]: { ...prev[card.entry.entryId] } }))
                }}
                onRenameChange={(value) => onValue(card.entry.entryId, '__label__', value)}
                onRenameSave={() => void saveLabel()}
                onRenameCancel={() => {
                  setEditing(null)
                  discardEntry(card.entry.entryId)
                }}
              />
            ))}

            {shown.length === 0 && cards.length > 0 && (
              <div className="plugins:p-6 plugins:text-sm plugins:text-muted-foreground">
                <span className="plugins:inline-flex plugins:items-center plugins:gap-2">
                  {cards.length} 条条目都被筛掉了。
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

            {/*
              无主的设置单独一块，压在最后：它们不属于画面上任何一个件，混进上面那张表只会
              让人以为件还在。只在没筛选的时候出现——筛选中的清单应该是纯粹的
            */}
            {search === '' && filter === 'all' && orphans.length > 0 && (
              <Collapsible open={orphansOpen} onOpenChange={setOrphansOpen} className="plugins:border-t plugins:border-border">
                <CollapsibleTrigger className="plugins:flex plugins:w-full plugins:items-center plugins:gap-2 plugins:px-3 plugins:py-2 plugins:text-left plugins:outline-none plugins:hover:bg-accent/40">
                  <ChevronRight
                    className={cn('plugins:size-4 plugins:text-muted-foreground plugins:transition-transform', orphansOpen && 'plugins:rotate-90')}
                  />
                  <span className="plugins:text-sm plugins:text-muted-foreground">无主的设置</span>
                  <Badge variant="outline" className="plugins:px-1.5 plugins:py-0 plugins:text-[10px]">
                    {orphans.length}
                  </Badge>
                  <span className="plugins:text-xs plugins:text-muted-foreground">盘上有值，此刻没有件认领</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="plugins:divide-y plugins:divide-border plugins:bg-muted/30">
                    {orphans.map((s) => (
                      <div key={slotKey(s)} className="plugins:flex plugins:items-center plugins:justify-between plugins:gap-4 plugins:px-3 plugins:py-2">
                        <div className="plugins:min-w-0">
                          <div className="plugins:flex plugins:items-center plugins:gap-2">
                            <span className="plugins:text-sm">{s.title ?? s.key}</span>
                            <code className="plugins:rounded plugins:bg-muted plugins:px-1 plugins:py-0.5 plugins:font-mono plugins:text-[10px] plugins:text-muted-foreground">
                              {s.section}/{s.key}
                            </code>
                          </div>
                          {s.description !== undefined && <p className="plugins:mt-0.5 plugins:text-xs plugins:text-muted-foreground">{s.description}</p>}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="plugins:shrink-0 plugins:text-destructive"
                          title="把这一格从盘上抹掉"
                          onClick={() =>
                            void run(
                              SETTINGS_DELETE,
                              { section: s.section, key: s.key },
                              `抹掉了 ${s.section}.${s.key}`,
                            )
                          }
                        >
                          <Trash2 /> 抹掉
                        </Button>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {sharedRows.length > 0 && (
              <Collapsible open={sharedOpen} onOpenChange={setSharedOpen} className="plugins:border-t plugins:border-border">
                <CollapsibleTrigger className="plugins:flex plugins:w-full plugins:items-center plugins:gap-2 plugins:px-3 plugins:py-2 plugins:text-left plugins:outline-none plugins:hover:bg-accent/40">
                  <ChevronRight
                    className={cn('plugins:size-4 plugins:text-muted-foreground plugins:transition-transform', sharedOpen && 'plugins:rotate-90')}
                  />
                  <span className="plugins:text-sm plugins:text-muted-foreground">共享包</span>
                  <Badge variant="outline" className="plugins:px-1.5 plugins:py-0 plugins:text-[10px]">
                    {sharedRows.length}
                  </Badge>
                  <span className="plugins:text-xs plugins:text-muted-foreground">页面级基础设施，没有条目也不会有</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="plugins:divide-y plugins:divide-border plugins:bg-muted/30">
                    {sharedRows.map((row) => (
                      <div key={row.pkg} className="plugins:flex plugins:items-center plugins:justify-between plugins:gap-4 plugins:px-3 plugins:py-2">
                        <div className="plugins:min-w-0">
                          <div className="plugins:flex plugins:items-baseline plugins:gap-2">
                            <span className="plugins:min-w-0 plugins:truncate plugins:font-mono plugins:text-xs">{row.pkg}</span>
                            {row.spec !== undefined && (
                              <span className="plugins:shrink-0 plugins:font-mono plugins:text-xs plugins:text-muted-foreground">{row.spec}</span>
                            )}
                          </div>
                          <p className="plugins:mt-0.5 plugins:text-xs plugins:text-muted-foreground">
                            {provided[row.pkg]?.length
                              ? `页面 importmap 提供 ${provided[row.pkg]?.join('、')}`
                              : '页面级基础设施，没有可挂的窗格'}
                          </p>
                        </div>
                        {updates?.[row.pkg] !== undefined && (
                          <span
                            className="plugins:shrink-0 plugins:font-mono plugins:text-xs plugins:text-amber-600 plugins:dark:text-amber-400"
                            title={`home 里是 ${updates[row.pkg]!.current}，registry 上最新是 ${updates[row.pkg]!.latest}`}
                          >
                            有新版 → {updates[row.pkg]!.latest}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {pendingRows.length > 0 && (
              <Collapsible open={noEntryOpen} onOpenChange={setNoEntryOpen} className="plugins:border-t plugins:border-border">
                <CollapsibleTrigger className="plugins:flex plugins:w-full plugins:items-center plugins:gap-2 plugins:px-3 plugins:py-2 plugins:text-left plugins:outline-none plugins:hover:bg-accent/40">
                  <ChevronRight
                    className={cn('plugins:size-4 plugins:text-muted-foreground plugins:transition-transform', noEntryOpen && 'plugins:rotate-90')}
                  />
                  <span className="plugins:text-sm plugins:text-muted-foreground">已装、没挂条目的插件</span>
                  <Badge variant="outline" className="plugins:px-1.5 plugins:py-0 plugins:text-[10px]">
                    {pendingRows.length}
                  </Badge>
                  <span className="plugins:text-xs plugins:text-muted-foreground">装了还没往 cordis.yml 挂条目的件在这</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="plugins:divide-y plugins:divide-border plugins:bg-muted/30">
                    {pendingRows.map((row) => (
                      <div key={row.pkg} className="plugins:flex plugins:items-center plugins:justify-between plugins:gap-4 plugins:px-3 plugins:py-2">
                        <div className="plugins:min-w-0">
                          <div className="plugins:flex plugins:items-baseline plugins:gap-2">
                            <span className="plugins:min-w-0 plugins:truncate plugins:font-mono plugins:text-xs">{row.pkg}</span>
                            {row.spec !== undefined && (
                              <span className="plugins:shrink-0 plugins:font-mono plugins:text-xs plugins:text-muted-foreground">{row.spec}</span>
                            )}
                          </div>
                          <p className="plugins:mt-0.5 plugins:text-xs plugins:text-muted-foreground" title={row.noteHint}>
                            {row.note}
                          </p>
                        </div>
                        {updates?.[row.pkg] !== undefined && (
                          <span
                            className="plugins:shrink-0 plugins:font-mono plugins:text-xs plugins:text-amber-600 plugins:dark:text-amber-400"
                            title={`home 里是 ${updates[row.pkg]!.current}，registry 上最新是 ${updates[row.pkg]!.latest}`}
                          >
                            有新版 → {updates[row.pkg]!.latest}
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="plugins:shrink-0"
                          disabled={busy}
                          title={`往 cordis.yml 里加一条引 ${row.pkg} 的条目并当场挂上`}
                          onClick={() => void run(ADD_ENTRY, { pkg: row.pkg }, `给 ${row.pkg} 挂了条目`)}
                        >
                          挂条目
                        </Button>
                        {/* 没挂条目的包也能卸——卸载是包级动作，不走条目那一层 */}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="plugins:shrink-0 plugins:text-destructive"
                          disabled={busy}
                          title={`pnpm remove 掉 ${row.pkg}。设置与数据留盘`}
                          onClick={() => askUninstall(row.pkg)}
                        >
                          卸载
                        </Button>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>

          <div className="plugins:flex plugins:items-center plugins:justify-between plugins:gap-3 plugins:border-t plugins:border-border plugins:px-3 plugins:py-1 plugins:text-xs plugins:text-muted-foreground">
            <span>
              {shown.length === cards.length
                ? `${summary.entries} 条条目`
                : `${shown.length} / ${summary.entries} 条条目`}
              {` · ${onCount} 个启用`}
              {badCount > 0 && ` · ${badCount} 个异常`}
            </span>
            <span className="plugins:truncate plugins:font-mono" title="设置落在 <home>/settings.json，跟 cordis.yml 并排——home 自持全部配置">
              settings.json
            </span>
          </div>
        </>
      )}

      <AlertDialog open={asking !== null} onOpenChange={(v) => !v && setAsking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删条目 {asking?.card.entry.label ?? asking?.card.entry.id}？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="plugins:space-y-2">
                <p>
                  会把 <code className="plugins:font-mono">{asking?.card.entry.id}</code> 这条条目从 cordis.yml 里摘掉，fiber
                  当场卸下。**包不删**，还留在 home 里；要拿掉包自己去 home 里 pnpm remove。
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* 设置值删不删要问：不问就静默留下一堆无主的值，问了正好接住列表末尾那一块 */}
          <label className="plugins:flex plugins:items-center plugins:gap-2 plugins:rounded-md plugins:border plugins:border-border plugins:px-3 plugins:py-2 plugins:text-sm">
            <input
              type="checkbox"
              className="plugins:size-4 plugins:accent-primary"
              checked={alsoDrop}
              onChange={(e) => setAlsoDrop(e.target.checked)}
            />
            <span>
              一并抹掉它的设置值
              <span className="plugins:block plugins:text-xs plugins:text-muted-foreground">
                不勾的话这些值留在盘上，之后会出现在「无主的设置」里
              </span>
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>算了</AlertDialogCancel>
            <AlertDialogAction
              className="plugins:bg-destructive plugins:text-white plugins:hover:bg-destructive/90"
              disabled={busy}
              onClick={() => void removeEntry()}
            >
              删条目
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 一键热升：先把 from → to 列出来让人看一眼再动手，照卸载确认框的做法。升级中不许关（onOpenChange 不收） */}
      <AlertDialog open={askingUpdateAll} onOpenChange={(v) => !v && !updatingAll && setAskingUpdateAll(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>全部更新 {outdatedRows.length} 个包？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="plugins:space-y-2">
                <p>
                  一趟 <code className="plugins:font-mono">pnpm add</code> 把下面这些升到 registry 上的最新版，再把它们的每条条目
                  停用→启用重挂成新版本（本来就停用的保持停用），**不重启内核**；升完整页重载。
                </p>
                {outdatedRows.some(([pkg]) => pkg === OWN_PKG) && (
                  <p className="plugins:text-amber-600 plugins:dark:text-amber-400">
                    插件管理件自己也在清单里：回执发出之后这一格会先关再开，随后整页重载。
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="plugins:max-h-64 plugins:divide-y plugins:divide-border plugins:overflow-auto plugins:rounded-md plugins:border plugins:border-border">
            {outdatedRows.map(([pkg, info]) => (
              <div key={pkg} className="plugins:flex plugins:items-baseline plugins:justify-between plugins:gap-3 plugins:px-3 plugins:py-1.5 plugins:font-mono plugins:text-xs">
                <span className="plugins:min-w-0 plugins:truncate">{pkg}</span>
                <span className="plugins:shrink-0 plugins:text-muted-foreground">
                  {info.current} → <span className="plugins:text-foreground">{info.latest}</span>
                </span>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updatingAll}>算了</AlertDialogCancel>
            <AlertDialogAction disabled={updatingAll} onClick={() => void updateAll()}>
              {updatingAll ? '升级中，完成后界面会自动重载…' : '全部更新'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 卸载是包级动作，与删一条条目是两回事——对话框把两边的边界说清楚 */}
      <AlertDialog open={askingUninstall !== null} onOpenChange={(v) => !v && setAskingUninstall(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>卸载 {askingUninstall?.pkg}？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="plugins:space-y-2">
                <p>
                  会把这个包的 <code className="plugins:font-mono">{String(askingUninstall?.count ?? 0)}</code> 条条目从
                  cordis.yml 里摘掉（fiber 当场卸下），再 pnpm remove 把包从 home 移走。
                </p>
                <p>
                  **设置与数据留在盘上**——重装回来还是那份。只想删一条条目、包留着的话，取消后走那条上的「删条目…」。
                </p>
                {askingUninstall?.isSelf && (
                  <p className="plugins:text-destructive">
                    这是插件管理件自己：卸了之后**这一格就没有了**，重启内核后界面退回阶段页。真要重来得回命令行装。
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {askingUninstall !== null && askingUninstall.settings.length > 0 && (
            <label className="plugins:flex plugins:items-center plugins:gap-2 plugins:rounded-md plugins:border plugins:border-border plugins:px-3 plugins:py-2 plugins:text-sm">
              <input
                type="checkbox"
                className="plugins:size-4 plugins:accent-primary"
                checked={uninstallDrop}
                onChange={(e) => setUninstallDrop(e.target.checked)}
              />
              <span>
                一并抹掉这 {askingUninstall.settings.length} 项设置值
                <span className="plugins:block plugins:text-xs plugins:text-muted-foreground">
                  不勾的话这些值留在盘上，之后会出现在「无主的设置」里
                </span>
              </span>
            </label>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>算了</AlertDialogCancel>
            <AlertDialogAction
              className="plugins:bg-destructive plugins:text-white plugins:hover:bg-destructive/90"
              disabled={busy}
              onClick={() => void uninstallPkg()}
            >
              卸载
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function boot(args: PaneArgs, container: HTMLElement): Root {
  const root = createRoot(container)
  // 认不出的 paneId 报错、不回落——「注册了 x 却画出 installed」是那种没有任何现象的错
  if (args.pane.id === PANE_ID) {
    // 弹层（下拉、两个确认框）**照 radix 的默认 portal 到 body**：0.2 起围栏是类名前缀，
    // 规则全页有效，挂到容器外面照样有样式。原先那层 `PortalContainer` 上下文与两个
    // 组件里「把容器透给 Portal」的手改，连同 src/client/portal.tsx 一起退场了
    root.render(<PluginsPane args={args} />)
  } else {
    root.render(<p className="plugins:p-3 plugins:text-sm plugins:text-destructive">本件没有叫 {args.pane.id} 的窗格</p>)
  }
  return root
}

/** 窗格件那半的入口。导出名是 `mountPane`——外壳占整页那个根，窗格占井里一格 */
export function mountPane(args: PaneArgs, container: HTMLElement): { dispose(): void } {
  // **不再给容器加 position:relative**：那一句是为「弹层 absolute 定位、参照系取最近的
  // positioned 祖先」配的，而弹层现在是官方原样——portal 到 body、confirm 那层 fixed。
  // 随之而来的行为变化：确认框的遮罩盖整窗而不是只盖这一格，模态对话框本该如此
  const root = boot(args, container)
  return {
    dispose() {
      root.unmount()
      container.textContent = ''
    },
  }
}

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  acceptEntries,
  clockOf,
  LEVELS,
  mergeEntries,
  type LogEntry,
  type LogLevel,
  type LogSource,
} from './entries'
import { ALL_SOURCES, countBySource, groupNames, matches, type FilterState } from './filter'
import { PortalContainer } from './portal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * 浏览器半：一格日志窗格。
 *
 * **日志不从 `args` 来**——`mountPane` 给的是 `{ host, shell, pane }`，而日志走的是页面的
 * 公共面 `window.gwb.logs`。外壳不该转发它：它凭什么认识「日志」。
 *
 * ⚠️ **这一格在收日志的路径上一个 `console` 都不许打。** 渲染层的 console 是四路之一：
 * 打一句 → 主进程收走 → 进缓冲 → 推回这儿 → 那条路上如果又打了一句，就是一变二、二变四，
 * 界面当场冻死。取表失败那种一次性的、非循环路径上的，走界面显示，也别打 console。
 */

/** 这一格最多挂多少行。**渲染成本定的**，不是缓冲大小——内核那圈比这个大，更早的去日志文件翻 */
const CAP = 2000

/** 离底多近算「跟着走」 */
const STICK_SLACK = 24

/** 「全部来源」那一项的值。Radix 的 SelectItem **不收空串**，得给它一个真值 */
const ALL_KEY = '*'

const SOURCE_LABEL: Record<LogSource, string> = { plugin: '件', host: '宿主', main: '主', renderer: '渲' }

const LEVEL_MARK: Record<LogLevel, string> = { error: 'E', warn: 'W', info: 'I', debug: 'D' }

/** 级别徽标的样子。只有 error 用 destructive——一行里颜色太多就没有重点了 */
const LEVEL_BADGE: Record<LogLevel, { variant: 'destructive' | 'secondary' | 'outline'; className?: string }> = {
  error: { variant: 'destructive' },
  warn: { variant: 'secondary', className: 'text-amber-600 dark:text-amber-400' },
  info: { variant: 'outline' },
  debug: { variant: 'outline', className: 'opacity-60' },
}

const LEVEL_TEXT: Record<LogLevel, string> = { error: 'Error', warn: 'Warn', info: 'Info', debug: 'Debug' }

/** 外壳调 `mountPane` 时给的那几样。按形状收，不牵 shell 那个包的类型 */
interface PaneArgs {
  host: { call: (command: string, args?: unknown) => Promise<unknown> }
  shell: {
    openPane: (paneId: string, options?: { duplicate?: boolean }) => void
    bus: {
      emit: (type: string, detail?: unknown) => void
      on: (type: string, listener: (detail: unknown) => void) => () => void
    }
  }
  pane: { id: string; instance: string }
}

/** 页面的公共面。同样按形状收——条目的正本钉在内核仓的契约页上 */
declare global {
  interface Window {
    gwb: {
      command<T = unknown>(command: string, args?: unknown): Promise<T>
      logs: {
        backlog(): Promise<unknown>
        on(cb: (batch: unknown) => void): () => void
      }
    }
  }
}

function LoggerPane({ args, container }: { args: PaneArgs; container: HTMLElement }): ReactElement {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [failed, setFailed] = useState('')
  const [where, setWhere] = useState<{ home: string; logDir: string } | null>(null)
  const [filter, setFilter] = useState<FilterState>({
    level: 'debug',
    sources: ALL_SOURCES,
    key: '',
    search: '',
  })
  const [stick, setStick] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const take = (batch: unknown): void => {
      if (!alive) return
      setEntries((prev) => mergeEntries(prev, acceptEntries(batch), CAP))
    }
    // **先订阅、后取历史**：反过来的话，订阅生效与历史截止之间那一瞬推来的条目会漏掉。
    // 两段交叠的部分靠 seq 去重挡住
    const off = window.gwb.logs.on(take)
    window.gwb.logs.backlog().then(take, (err: unknown) => {
      if (alive) setFailed(`历史段取不到：${String(err)}`)
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  useEffect(() => {
    let alive = true
    args.host.call('kernel.info').then(
      (res) => {
        const data = (res as { data?: { dataDir?: string; logDir?: string } }).data
        if (alive && data !== undefined) setWhere({ home: data.dataDir ?? '', logDir: data.logDir ?? '' })
      },
      () => {
        /* 脚注上少两行路径而已，不值得打断什么 */
      },
    )
    return () => {
      alive = false
    }
  }, [args.host])

  const shown = useMemo(() => entries.filter((e) => matches(e, filter)), [entries, filter])
  const counts = useMemo(() => countBySource(entries), [entries])
  const groups = useMemo(() => groupNames(entries), [entries])

  // 吸附：跟着走的时候每次有新行就贴到底
  useEffect(() => {
    if (!stick) return
    const el = listRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [shown, stick])

  const toggleSource = (s: LogSource): void => {
    setFilter((f) => {
      const next = new Set(f.sources)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return { ...f, sources: next }
    })
  }

  const filtering =
    filter.level !== 'debug' || filter.sources.size !== ALL_SOURCES.size || filter.key !== '' || filter.search !== ''

  return (
    // 门户组件（Select 的弹层）挂到这一格自己的容器下，不挂 body——见 ./portal
    <PortalContainer value={container}>
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1">
          {LEVELS.map((l) => (
            <Button
              key={l}
              size="sm"
              variant={filter.level === l ? 'default' : 'outline'}
              title={`显示 ${LEVEL_TEXT[l]} 及以上`}
              onClick={() => setFilter((f) => ({ ...f, level: l }))}
            >
              {LEVEL_TEXT[l]}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {(['plugin', 'host', 'main', 'renderer'] as LogSource[]).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={filter.sources.has(s) ? 'secondary' : 'ghost'}
              title={`${SOURCE_LABEL[s]}这一路`}
              className={filter.sources.has(s) ? '' : 'text-muted-foreground line-through'}
              onClick={() => toggleSource(s)}
            >
              {SOURCE_LABEL[s]} {counts[s]}
            </Button>
          ))}
        </div>

        <Select
          value={filter.key === '' ? ALL_KEY : filter.key}
          onValueChange={(v) => setFilter((f) => ({ ...f, key: v === ALL_KEY ? '' : v }))}
        >
          <SelectTrigger size="sm" className="w-44">
            <SelectValue placeholder="全部来源" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_KEY}>全部来源</SelectItem>
            {groups.map((g) => (
              <SelectGroup key={g.source}>
                <SelectLabel>{SOURCE_LABEL[g.source]}</SelectLabel>
                {g.names.map((n) => (
                  <SelectItem key={n} value={`${g.source}|${n}`}>
                    {n}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="search"
          placeholder="搜索"
          className="h-8 min-w-32 flex-1"
          value={filter.search}
          onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
        />

        <Button
          size="sm"
          variant="ghost"
          title="只清这一份视图，不动内核的缓冲，也不动日志文件。清完不会自己回来，重开这一格才会"
          onClick={() => setEntries([])}
        >
          清屏
        </Button>
      </div>

      <div ref={listRef} className="relative flex-1 overflow-auto" onScroll={() => {
        const el = listRef.current
        if (el !== null) setStick(el.scrollHeight - el.scrollTop - el.clientHeight < STICK_SLACK)
      }}>
        {shown.map((e) => (
          <div key={e.seq} className="flex items-start gap-2 px-3 py-0.5 font-mono text-xs hover:bg-accent/40">
            <span className="shrink-0 tabular-nums text-muted-foreground">{clockOf(e.ts)}</span>
            <Badge
              variant={LEVEL_BADGE[e.level].variant}
              className={`w-5 shrink-0 justify-center px-0 py-0 font-mono text-[10px] ${LEVEL_BADGE[e.level].className ?? ''}`}
            >
              {LEVEL_MARK[e.level]}
            </Badge>
            <span className="w-7 shrink-0 text-muted-foreground">{SOURCE_LABEL[e.source]}</span>
            <span className="shrink-0 text-primary">{e.name}</span>
            <span className="whitespace-pre-wrap break-all">{e.msg}</span>
          </div>
        ))}

        {shown.length === 0 && (
          <div className="p-6 text-sm text-muted-foreground">
            {/* 空态得分得清「一条都没有」和「被筛掉了」——后者带一颗清筛选 */}
            {entries.length === 0 ? (
              (failed === '' ? '还没有日志。' : failed)
            ) : (
              <span className="inline-flex items-center gap-2">
                {entries.length} 条都被筛掉了。
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setFilter({ level: 'debug', sources: ALL_SOURCES, key: '', search: '' })}
                >
                  清筛选
                </Button>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-1 text-xs text-muted-foreground">
        <span>
          {filtering ? `${shown.length} / ${entries.length} 条` : `${entries.length} 条`}
          {entries.length >= CAP ? `（挂满 ${CAP}，更早的去日志文件翻）` : ''}
          {stick ? '' : ' · 已暂停吸附，滚回底部恢复'}
        </span>
        {where !== null && (
          <span className="truncate font-mono" title={`home：${where.home}`}>
            {where.logDir === '' ? where.home : where.logDir}
          </span>
        )}
      </div>
    </div>
    </PortalContainer>
  )
}

function boot(args: PaneArgs, container: HTMLElement): Root {
  const root = createRoot(container)
  // 认不出的 paneId 报错、不回落到 main：「注册了 x 却画出 main」是那种没有任何现象的错
  if (args.pane.id === 'main') root.render(<LoggerPane args={args} container={container} />)
  else root.render(<p className="p-3 text-sm text-destructive">本件没有叫 {args.pane.id} 的窗格</p>)
  return root
}

/**
 * 窗格件那半的入口。导出名是 `mountPane` 不是 `bootShell`——外壳占整页那个根，
 * 窗格占井里一格，单看导出名就知道自己是哪种件。
 */
export function mountPane(args: PaneArgs, container: HTMLElement): { dispose(): void } {
  const root = boot(args, container)
  return {
    dispose() {
      root.unmount()
      container.textContent = ''
    },
  }
}

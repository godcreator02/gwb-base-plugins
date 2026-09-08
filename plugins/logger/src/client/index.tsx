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
import { ScrollText, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
 * **实时那段不从 `args` 来**——`mountPane` 给的是 `{ host, shell, pane }`，而实时行走的是
 * 页面的公共面 `window.gwb.on`：node 半经 `gwbKernel.emit` 推，载荷上带自己的记号 `t`。
 * 外壳不该转发它：它凭什么认识「日志」。历史段与脚注那两条才走 `args.host` 的命令。
 *
 * 版面是 2026-09-08 视觉精修后的样子（效果图 `design/logger-pane.html` 定稿）：
 * 日志行 grid 定宽列齐头、error/warn 整行色调加左缘色条、级别分段控件带门限可视化、
 * 路胶囊开关、吸附提示浮在右下角。行为语义没动：门限、多选路、复合键、seq 去重、
 * 吸附 24px、2000 上限切尾、空态双文案。
 *
 * ⚠️ **这一格在收日志的路径上一个 `console` 都不许打。** 渲染层的 console 是三路之一：
 * 打一句 → 主进程收走 → 进缓冲 → 推回这儿 → 那条路上如果又打了一句，就是一变二、二变四，
 * 界面当场冻死。取表失败那种一次性的、非循环路径上的，走界面显示，也别打 console。
 */

/** 这一格最多挂多少行。**渲染成本定的**，不是缓冲大小——内核那圈比这个大，更早的去日志文件翻 */
const CAP = 2000

/** 离底多近算「跟着走」 */
const STICK_SLACK = 24

/** 「全部来源」那一项的值。Radix 的 SelectItem **不收空串**，得给它一个真值 */
const ALL_KEY = '*'

const SOURCE_LABEL: Record<LogSource, string> = { plugin: '件', kernel: '核', renderer: '渲' }

/**
 * 三路的点色。**效果图定稿的自有色**，令牌表里还没有——要转正进 gwb-tokens 是另一件事。
 * 用在两处：路胶囊上的小点、每行路标上的小点，让「筛选开关」和「流水行」用同一个颜色锚。
 */
const SOURCE_DOT: Record<LogSource, string> = {
  plugin: 'oklch(0.623 0.214 259.815)',
  kernel: 'oklch(0.746 0.13 195)',
  renderer: 'oklch(0.72 0.14 330)',
}

/** 内核事件口上认自己那条的记号，跟 node 半的 EVENT 是同一个字符串 */
const EVENT = 'gwb-logger'
const BACKLOG_COMMAND = 'logger.backlog'
const WHERE_COMMAND = 'logger.where'

const LEVEL_MARK: Record<LogLevel, string> = { error: 'E', warn: 'W', info: 'I', debug: 'D' }

const LEVEL_TEXT: Record<LogLevel, string> = { error: 'Error', warn: 'Warn', info: 'Info', debug: 'Debug' }

/** 级别字母的颜色。只有 error/warn 有色，info/debug 退成灰——一行里颜色太多就没有重点了 */
const LEVEL_TONE: Record<LogLevel, string> = {
  error: 'text-destructive',
  warn: 'text-amber-600 dark:text-amber-400',
  info: 'text-muted-foreground opacity-70',
  debug: 'text-muted-foreground opacity-40',
}

/** 整行色调：error/warn 淡色底加左缘色条（DevTools 那个路数），其余素底只留 hover */
const ROW_TONE: Record<LogLevel, string> = {
  error: 'bg-destructive/[0.08] shadow-[inset_2px_0_0_var(--destructive)] hover:bg-destructive/[0.14]',
  warn: 'bg-amber-400/[0.07] shadow-[inset_2px_0_0_oklch(0.795_0.184_86.9)] hover:bg-amber-400/[0.12]',
  info: 'hover:bg-accent',
  debug: 'hover:bg-accent',
}

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

/** 页面的公共面。同样按形状收——正本钉在内核的词汇表包上。实时那一路走 on，历史段走本件的命令 */
declare global {
  interface Window {
    gwb: {
      command<T = unknown>(command: string, args?: unknown): Promise<T>
      on(cb: (payload: unknown) => void): () => void
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
    // 两段交叠的部分靠 seq 去重挡住。事件口上什么件的事件都有，只认带自己记号的
    const off = window.gwb.on((payload) => {
      if (payload === null || typeof payload !== 'object') return
      const p = payload as { t?: unknown; line?: unknown }
      if (p.t === EVENT) take([p.line])
    })
    args.host.call(BACKLOG_COMMAND).then(
      (res) => {
        const r = res as { ok?: boolean; data?: unknown; error?: string }
        if (r.ok === true) take(r.data)
        else if (alive) setFailed(`历史段取不到：${r.error ?? '没说原因'}`)
      },
      (err: unknown) => {
        if (alive) setFailed(`历史段取不到：${String(err)}`)
      },
    )
    return () => {
      alive = false
      off()
    }
  }, [])

  useEffect(() => {
    let alive = true
    args.host.call(WHERE_COMMAND).then(
      (res) => {
        const data = (res as { data?: { home?: string; logFile?: string } }).data
        if (alive && data !== undefined) setWhere({ home: data.home ?? '', logDir: data.logFile ?? '' })
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

  const clearFilter = (): void => {
    setFilter({ level: 'debug', sources: ALL_SOURCES, key: '', search: '' })
  }

  // 级别分段：选中挡实心，更严重的那几挡半亮——把「显示这一级及以上」画出来
  const segTone = (l: LogLevel): string => {
    if (filter.level === l) return 'bg-primary text-primary-foreground font-medium'
    return LEVELS.indexOf(l) < LEVELS.indexOf(filter.level)
      ? 'bg-accent text-muted-foreground'
      : 'text-muted-foreground hover:text-foreground'
  }

  const filtering =
    filter.level !== 'debug' || filter.sources.size !== ALL_SOURCES.size || filter.key !== '' || filter.search !== ''

  return (
    // 门户组件（Select 的弹层）挂到这一格自己的容器下，不挂 body——见 ./portal
    <PortalContainer value={container}>
    {/* relative 是吸附浮胶囊的定位参照：它必须挂在这层（窗格根），放进滚动容器的话
        absolute+bottom 相对的是滚动内容，内容一长胶囊就漂出视口 */}
    <div className="relative flex h-full flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-card px-2.5 py-1.5">
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              title={`显示 ${LEVEL_TEXT[l]} 及以上`}
              onClick={() => setFilter((f) => ({ ...f, level: l }))}
              className={`rounded-md px-2.5 py-0.5 text-[11.5px] leading-5 ${segTone(l)}`}
            >
              {LEVEL_TEXT[l]}
            </button>
          ))}
        </div>

        <div className="ml-1.5 flex items-center gap-1 border-l border-border py-0.5 pl-2.5">
          {(['plugin', 'kernel', 'renderer'] as LogSource[]).map((s) => {
            const on = filter.sources.has(s)
            return (
              <button
                key={s}
                type="button"
                title={`${SOURCE_LABEL[s]}这一路`}
                onClick={() => toggleSource(s)}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] leading-5 ${
                  on
                    ? 'bg-secondary text-secondary-foreground hover:bg-accent'
                    : 'text-muted-foreground opacity-55 hover:bg-accent hover:opacity-80'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: SOURCE_DOT[s] }} />
                {SOURCE_LABEL[s]} <span className="text-[10.5px] tabular-nums opacity-60">{counts[s]}</span>
              </button>
            )
          })}
        </div>

        <div className="ml-1.5 flex min-w-0 flex-1 items-center gap-1.5 border-l border-border py-0.5 pl-2.5">
          <Select
            value={filter.key === '' ? ALL_KEY : filter.key}
            onValueChange={(v) => setFilter((f) => ({ ...f, key: v === ALL_KEY ? '' : v }))}
          >
            <SelectTrigger size="sm" className="w-40 shrink-0">
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

          <div className="flex h-8 min-w-32 flex-1 items-center gap-1.5 rounded-md border border-input px-2 focus-within:border-ring">
            <Search size={12} className="shrink-0 opacity-50" aria-hidden />
            <input
              type="text"
              placeholder="搜索 name 或消息"
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              value={filter.search}
              onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            />
          </div>

          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 text-muted-foreground"
            title="只清这一份视图，不动内核的缓冲，也不动日志文件。清完不会自己回来，重开这一格才会"
            onClick={() => setEntries([])}
          >
            清屏
          </Button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto overflow-x-hidden" onScroll={() => {
        const el = listRef.current
        if (el !== null) setStick(el.scrollHeight - el.scrollTop - el.clientHeight < STICK_SLACK)
      }}>
        {shown.map((e) => (
          <div
            key={e.seq}
            className={`group grid grid-cols-[84px_16px_38px_minmax(72px,118px)_1fr] items-baseline gap-x-2.5 px-2.5 py-px font-mono text-[11.5px] leading-[1.5] ${ROW_TONE[e.level]}`}
          >
            <span className="tabular-nums text-muted-foreground opacity-75">{clockOf(e.ts)}</span>
            <span className={`text-center font-semibold ${LEVEL_TONE[e.level]}`}>{LEVEL_MARK[e.level]}</span>
            <span className="flex items-center gap-1">
              <span className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: SOURCE_DOT[e.source] }} />
              <span className="text-muted-foreground opacity-85">{SOURCE_LABEL[e.source]}</span>
            </span>
            <span className="truncate text-foreground/70 group-hover:text-foreground/90" title={e.name}>{e.name}</span>
            <span className="whitespace-pre-wrap break-all">{e.msg}</span>
          </div>
        ))}

        {shown.length === 0 && (
          <div className="flex flex-col items-center gap-2.5 py-14 text-sm text-muted-foreground">
            <ScrollText size={26} className="opacity-25" aria-hidden />
            {/* 空态得分得清「一条都没有」和「被筛掉了」——后者带一颗清筛选 */}
            {entries.length === 0 ? (
              (failed === '' ? '还没有日志。' : failed)
            ) : (
              <>
                <span>{entries.length} 条都被筛掉了。</span>
                <Button size="sm" variant="secondary" onClick={clearFilter}>
                  清筛选
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {!stick && (
        <button
          type="button"
          onClick={() => setStick(true)}
          className="absolute bottom-9 right-3.5 z-10 rounded-full border border-border bg-popover px-3 py-1 text-[11.5px] text-popover-foreground shadow-lg hover:bg-accent"
        >
          已暂停吸附 · 回到底部
        </button>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
        <span>
          {filtering ? `${shown.length} / ${entries.length} 条` : `${entries.length} 条`}
          {entries.length >= CAP ? `（挂满 ${CAP}，更早的去日志文件翻）` : ''}
        </span>
        {where !== null && (
          <span className="truncate font-mono text-[10.5px] opacity-85" title={`home：${where.home}`}>
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

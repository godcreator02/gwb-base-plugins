import { useMemo, useState, type ReactElement } from 'react'
import { cn } from 'cn'
import { BookOpen, ChevronRight, Copy, FileText, Search } from 'lucide-react'
import { SKILL_BODY, SKILLS, type SkillRow } from './fixtures'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * skill 那一格：此刻挂着的说明书，一份一条。
 *
 * 两条纪律直接决定了这一格长什么样：
 *
 * - **挂载是主动的**——表里每一条都对应一个此刻真挂着的件，不会出现「skill 在、
 *   它讲的命令不在」。所以列表不需要「失效」那种状态，件走了条目自己就没了
 * - **description 是给 agent 读的，不是简介**——agent 靠它决定要不要读正文。
 *   所以列表里**整条显示、不截断**，哪怕它有三行
 *
 * 正文每次现读盘（`skill.read`）：改了 SKILL.md 立刻生效，不必重挂件。这一格因此
 * 不缓存正文，每次展开都重新去调。
 */

function SkillCard({
  row,
  open,
  onToggle,
}: {
  row: SkillRow
  open: boolean
  onToggle: () => void
}): ReactElement {
  const [file, setFile] = useState(row.files[0] ?? 'SKILL.md')
  const [copied, setCopied] = useState(false)

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left outline-none hover:bg-accent/40"
        onClick={onToggle}
      >
        <ChevronRight
          className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-sm font-medium">{row.name}</code>
            {/* 挂它的件：重名时后来者挂不上，所以「谁挂的」是这张表里唯一能分辨来路的东西 */}
            <Badge variant="outline" className="px-1.5 py-0 font-mono text-[10px]">
              {row.plugin.replace('@godcreator02/', '')}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {row.files.length} 个文件
            </span>
          </div>
          {/* 不截断：agent 就是靠这段决定要不要读正文的 */}
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{row.description}</p>
        </div>
      </button>

      {open && (
        <div className="border-t border-border bg-muted/30">
          <div className="flex flex-wrap items-center gap-1 px-3 py-2">
            {row.files.map((f) => (
              <Button
                key={f}
                size="xs"
                variant={file === f ? 'secondary' : 'ghost'}
                className="font-mono"
                onClick={() => setFile(f)}
              >
                <FileText />
                {f}
              </Button>
            ))}
            <div className="flex-1" />
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(SKILL_BODY).catch(() => undefined)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              <Copy />
              {copied ? '已复制' : '复制正文'}
            </Button>
          </div>
          {/*
            正文每次现读盘。demo 里三份 skill 共用同一段假正文——真界面这儿是
            `skill.read({ name, file })` 的返回，展开一次调一次
          */}
          <pre className="max-h-80 overflow-auto border-t border-border px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {SKILL_BODY}
          </pre>
        </div>
      )}
    </div>
  )
}

export function SkillsPane(): ReactElement {
  const [search, setSearch] = useState('')
  const [openName, setOpenName] = useState<string | null>('gwb-pane')

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q === '') return SKILLS
    return SKILLS.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.plugin.toLowerCase().includes(q),
    )
  }, [search])

  const plugins = useMemo(() => new Set(SKILLS.map((s) => s.plugin)).size, [])

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="搜名字、说明、挂它的件"
            className="h-8 pl-7"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {shown.map((s) => (
          <SkillCard
            key={s.name}
            row={s}
            open={openName === s.name}
            onToggle={() => setOpenName((prev) => (prev === s.name ? null : s.name))}
          />
        ))}

        {shown.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <BookOpen className="size-7 text-muted-foreground" />
            {SKILLS.length === 0 ? (
              <>
                <p className="text-sm text-muted-foreground">还没有件挂上 skill。</p>
                {/* 空态要说清这不是「加载失败」：挂载是主动的,没件挂就是真没有 */}
                <p className="max-w-xs text-xs text-muted-foreground">
                  挂载是主动的——件在自己的 apply 里调 <code className="font-mono">ctx.gwbSkills.register(目录)</code>，
                  这张表才有它。不扫 node_modules。
                </p>
              </>
            ) : (
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                {SKILLS.length} 份都被筛掉了。
                <Button size="sm" variant="outline" onClick={() => setSearch('')}>
                  清筛选
                </Button>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-1 text-xs text-muted-foreground">
        <span>
          {shown.length === SKILLS.length ? `${SKILLS.length} 份` : `${shown.length} / ${SKILLS.length} 份`}
          {` · 来自 ${plugins} 个件`}
        </span>
        <span className="font-mono">skill.list · skill.read</span>
      </div>
    </div>
  )
}

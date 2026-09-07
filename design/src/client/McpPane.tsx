import { useState, type ReactElement } from 'react'
import { cn } from 'cn'
import { Check, Copy, Eye, EyeOff, ShieldAlert, TriangleAlert, Wrench } from 'lucide-react'
import { COMMAND_COUNT, MCP_INFO, MCP_TOOLS } from './fixtures'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * MCP 那一格：把连接串交出去，外加这道口此刻开着什么。
 *
 * 这一格的存在理由写在 mcp 件的头注里——「这一版没有界面，日志是 token 唯一的示人
 * 出口」。让人去日志里翻一串 32 位十六进制再手抄进配置文件，是这一格要消灭的事。
 *
 * 所以主角是**复制**，不是展示：三种目标格式各一颗按钮，贴过去就能用。
 */

/** 复制。**带兜底**：`navigator.clipboard` 要安全上下文，file:// 打开的设计图里它是 undefined */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    /* 落到下面那条老路 */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.append(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
}

/** 一颗复制按钮：点完变对勾，1.5 秒回去 */
function CopyButton({
  text,
  label,
  size = 'sm',
  variant = 'outline',
}: {
  text: string
  label?: string
  size?: 'sm' | 'icon-sm'
  variant?: 'outline' | 'ghost' | 'default'
}): ReactElement {
  const [done, setDone] = useState(false)
  return (
    <Button
      size={size}
      variant={variant}
      title={label ?? '复制'}
      onClick={() => {
        void copyText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }}
    >
      {done ? <Check className="text-emerald-600 dark:text-emerald-400" /> : <Copy />}
      {label !== undefined && (size === 'sm' ? <span>{done ? '已复制' : label}</span> : null)}
    </Button>
  )
}

type Shape = 'cli' | 'json' | 'raw'

const SHAPE_LABEL: Record<Shape, string> = { cli: 'Claude Code', json: 'JSON 配置', raw: '端点与令牌' }

const SHAPE_HINT: Record<Shape, string> = {
  cli: '在装了 Claude Code 的终端里跑一遍',
  json: 'Claude Desktop、Cursor 这类读配置文件的，贴进它的 mcpServers',
  raw: '自己拼请求头的时候用。Authorization: Bearer <令牌>',
}

/** 三种目标格式各自的正文。`streamableHTTP` 的标准写法，无状态那一版 */
function shapeText(shape: Shape, url: string, token: string): string {
  if (shape === 'cli') {
    return `claude mcp add --transport http gwb ${url} --header "Authorization: Bearer ${token}"`
  }
  if (shape === 'json') {
    return JSON.stringify(
      { mcpServers: { gwb: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } },
      null,
      2,
    )
  }
  return `${url}\nAuthorization: Bearer ${token}`
}

export function McpPane(): ReactElement {
  const [shape, setShape] = useState<Shape>('cli')
  const [bare, setBare] = useState(false)
  const info = MCP_INFO

  // 遮起来的时候连要复制的那段文本一起遮——不然从「复制预览」里照样读得出来
  const shownToken = bare ? info.token : '•'.repeat(info.token.length)
  const text = shapeText(shape, info.url, info.token)
  const preview = shapeText(shape, info.url, shownToken)

  if (!info.ok) {
    // 令牌拿不到时这道口回 503。**这里要把真原因说出来**——看这一格的人本来就在本机，
    // 而「令牌不可用」五个字自己查不出盘为什么写不进去
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground">
        <TriangleAlert className="size-8 text-destructive" />
        <p className="text-sm">MCP 这道口暂时开不了：令牌读写失败</p>
        <p className="max-w-md font-mono text-xs break-all text-muted-foreground">{info.error}</p>
        <p className="text-xs text-muted-foreground">下一次请求会再试一遍。这条口回 503，不是永久钉死</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm">
          <span className="size-2 rounded-full bg-emerald-500" />
          就绪
        </span>
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{info.url}</code>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          无状态 · 每请求一对
        </Badge>
      </div>

      {/* 首选端口被占是多 home 同时开的常态，不是错——但真实端口跟文档里那个不一样，得说 */}
      {info.port !== info.wantPort && (
        <div className="border-b border-border bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          首选端口 {info.wantPort} 被占（另一个 home？），这台开在 {info.port}。下面那几段已经是真实端口
        </div>
      )}

      <Tabs defaultValue="connect" className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList className="mx-3 mt-2 self-start">
          <TabsTrigger value="connect">连接</TabsTrigger>
          <TabsTrigger value="tools">
            工具 <Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px]">{MCP_TOOLS.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connect" className="min-h-0 flex-1 overflow-auto px-3 pt-3 pb-4">
          <div className="flex items-center gap-1">
            {(['cli', 'json', 'raw'] as Shape[]).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={shape === s ? 'secondary' : 'ghost'}
                onClick={() => setShape(s)}
              >
                {SHAPE_LABEL[s]}
              </Button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{SHAPE_HINT[shape]}</p>

          <div className="mt-2 overflow-hidden rounded-md border border-border">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-2 py-1">
              <div className="flex items-center gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title={bare ? '把令牌遮起来' : '显示令牌'}
                  onClick={() => setBare((v) => !v)}
                >
                  {bare ? <EyeOff /> : <Eye />}
                </Button>
                <span className="text-xs text-muted-foreground">{bare ? '令牌明文显示中' : '令牌已遮起'}</span>
              </div>
              {/* 复制的是真串,不是屏幕上那段带圆点的 */}
              <CopyButton text={text} label="复制" />
            </div>
            {/*
              **折行不横滚**：窗格窄，横向滚动条一出来,那条命令就得拖着看才知道全貌,
              而这一块的用途本来就是「看一眼再复制」。JSON 那份自己带换行,不受影响
            */}
            <pre className="p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">{preview}</pre>
          </div>

          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              这串令牌等于这台工作台的全部命令面，<strong className="font-semibold">仅本机使用、勿外传</strong>。
              这道口只绑 127.0.0.1，但令牌漏出去，同一台机器上任何一个进程都调得动。
            </span>
          </div>

          <div className="mt-3 space-y-px overflow-hidden rounded-md border border-border">
            <div className="flex items-center gap-2 bg-muted/30 px-3 py-2">
              <span className="w-10 shrink-0 text-xs text-muted-foreground">端点</span>
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{info.url}</code>
              <CopyButton text={info.url} size="icon-sm" variant="ghost" label="复制端点" />
            </div>
            <div className="flex items-center gap-2 bg-muted/30 px-3 py-2">
              <span className="w-10 shrink-0 text-xs text-muted-foreground">令牌</span>
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{shownToken}</code>
              <CopyButton text={info.token} size="icon-sm" variant="ghost" label="复制令牌" />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="tools" className="min-h-0 flex-1 overflow-auto px-3 pt-3 pb-4">
          {/*
            工具面只有两件不是偷懒：命令注册表随装了哪些件而变，没有一张固定清单，
            所以给的是「看清单」加「按名字调」，不是逐条门牌。这句得让人看见,
            不然「就两个工具」看着像没做完
          */}
          <p className="mb-3 text-xs text-muted-foreground">
            工具面固定这两件——命令随装了哪些件而变，没有固定清单，所以开出去的是「看清单」加「按名字调」。
            此刻命令面上有 <span className="font-medium text-foreground">{COMMAND_COUNT}</span> 条命令，
            外部 agent 经这两件都够得着。
          </p>

          <div className="space-y-2">
            {MCP_TOOLS.map((t) => (
              <div key={t.name} className="rounded-md border border-border p-3">
                <div className="flex items-center gap-2">
                  <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
                  <code className="font-mono text-sm font-medium">{t.name}</code>
                  <CopyButton text={t.name} size="icon-sm" variant="ghost" label="复制工具名" />
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t.description}</p>
                {t.params !== undefined && (
                  <div className="mt-2 space-y-1 border-t border-border pt-2">
                    {t.params.map((p) => (
                      <div key={p.name} className="flex items-baseline gap-2 text-xs">
                        <code className={cn('font-mono', p.required && 'font-medium')}>{p.name}</code>
                        <span className="text-muted-foreground">{p.type}</span>
                        {p.required && (
                          <Badge variant="outline" className="px-1 py-0 text-[10px]">
                            必填
                          </Badge>
                        )}
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.description}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            这一版是<strong className="font-semibold text-foreground">无状态</strong>的：每请求现造一对
            server + transport，随响应关闭。代价是发不出
            list_changed 那类通知——正连着的 agent 要等下一次重连才知道工具面变了。
          </p>
        </TabsContent>
      </Tabs>
    </div>
  )
}

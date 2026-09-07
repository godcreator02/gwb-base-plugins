import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  acceptPackages,
  asResult,
  summarize,
  toRows,
  type EntryRow,
  type PackageRow,
} from './rows'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * 浏览器半：已装件那一格。
 *
 * **两层：包 → 条目。** 上面一层是 home 里装了什么包，下面一层是 `cordis.yml` 里引它的
 * 那几条条目。所有操作都在条目那一层——**包这一层一个按钮都没有**：这个件根本没有
 * `uninstall`，要拿掉一个包用户自己去 home 里 `pnpm remove`。
 *
 * **这一格也不管「装」**：装是市场那一格的事，这儿只管已有的。
 *
 * 没有事件推送，所以每次操作完重新 `plugins.list` 一次。
 */

const PANE_ID = 'installed'

/** 外壳调 `mountPane` 时给的那几样。按形状收，只收用得着的两格（正本在 shell 件的 client/types.ts） */
interface PaneArgs {
  host: { call: (command: string, args?: unknown) => Promise<unknown> }
  pane: { id: string; instance: string }
}

const LIST = 'plugins.list'
const ENABLE = 'plugins.enable'
const DISABLE = 'plugins.disable'
const SET_LABEL = 'plugins.set-label'
const REMOVE_ENTRY = 'plugins.remove-entry'

/** 状态那颗点。挂上了是实心，别的都是空心——形状与颜色两条线各说一件事 */
const MARK: Record<EntryRow['state'], string> = {
  active: '●',
  stalled: '○',
  disabled: '○',
  'disabled-running': '●',
}

function PluginsPane({ args }: { args: PaneArgs }): ReactElement {
  /** null 是「还没取到」，跟「取到了但一个包都没有」不是一回事 */
  const [rows, setRows] = useState<PackageRow[] | null>(null)
  /** 取表本身没成时的那句话。跟操作的回执分开——它说的是整格都没有内容 */
  const [listError, setListError] = useState('')
  /** 上一次操作的回执。**不吞 error**，尤其 set-label 在没装数据件时会回一句话 */
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  /** 就地改名：正在编的那条与输入框里的字 */
  const [editing, setEditing] = useState<{ entryId: string; value: string } | null>(null)
  /** 删条目的第二下确认 */
  const [confirming, setConfirming] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    const result = asResult(await args.host.call(LIST))
    if (result.ok) {
      setRows(toRows(acceptPackages(result.data)))
      setListError('')
    } else {
      setListError(result.error ?? '')
    }
  }, [args.host])

  useEffect(() => {
    let alive = true
    void args.host.call(LIST).then(
      (raw) => {
        if (!alive) return
        const result = asResult(raw)
        if (result.ok) setRows(toRows(acceptPackages(result.data)))
        else setListError(result.error ?? '')
      },
      (err: unknown) => {
        if (alive) setListError(`取不到表：${String(err)}`)
      },
    )
    return () => {
      alive = false
    }
  }, [args.host])

  /**
   * 跑一条命令，然后**一定重新取一次表**——没有事件推送，不重取的话界面会停在旧样子上，
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

  const saveLabel = async (): Promise<void> => {
    if (editing === null) return
    const { entryId, value } = editing
    setEditing(null)
    // **空串是合法的，意思是抹掉**——不 trim 成 undefined、也不当成「没改」
    await run(SET_LABEL, { entryId, label: value }, value === '' ? '显示名抹掉了' : `显示名改成了「${value}」`)
  }

  const summary = useMemo(() => summarize(rows ?? []), [rows])

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex items-center gap-3 border-b border-border px-3 py-2">
        <span className="text-sm font-medium">已装的件</span>
        <span className="text-xs text-muted-foreground">
          {rows === null
            ? '取表中…'
            : `${summary.packages} 个包 · ${summary.entries} 条条目${summary.attention === 0 ? '' : ` · ${summary.attention} 条没挂上`}`}
        </span>
        <span className="flex-1" />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>
          刷新
        </Button>
      </div>

      {notice !== null && (
        <div
          className={`flex items-start gap-2 border-b border-border px-3 py-2 text-xs ${
            notice.ok ? 'text-muted-foreground' : 'text-destructive'
          }`}
        >
          <span className="flex-1 whitespace-pre-wrap break-all">{notice.text}</span>
          <Button size="xs" variant="ghost" onClick={() => setNotice(null)}>
            知道了
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {listError !== '' && <p className="p-6 text-sm text-destructive whitespace-pre-wrap">{listError}</p>}

        {listError === '' && rows !== null && rows.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">home 里一个包都没装。</p>
        )}

        {rows?.map((row) => (
          <div key={row.pkg} className="border-b border-border px-3 py-2">
            {/* 包这一层：只有名字、版本范围和「在不在 home 里」，**没有任何操作** */}
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-sm">{row.title}</span>
              {row.spec !== undefined && (
                <span className="font-mono text-xs text-muted-foreground">{row.spec}</span>
              )}
              {!row.installed && (
                <Badge
                  variant="destructive"
                  title="cordis.yml 里有引它的条目，可 home 的 dependencies 里没有这个包——多半是被 pnpm remove 掉了，或者 yml 是手改的"
                >
                  不在 home 里
                </Badge>
              )}
              {row.note !== undefined && (
                <span className="text-xs text-muted-foreground" title={row.noteHint}>
                  {row.note}
                </span>
              )}
            </div>

            {row.entries.map((entry) => (
              <div key={entry.entryId} className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-4 text-xs">
                {/* id 始终看得见：它是身份，日志和 yml 里出现的是它 */}
                <span className="font-mono">{entry.id}</span>
                {entry.label !== undefined && <span className="text-muted-foreground">「{entry.label}」</span>}

                <span
                  className={entry.attention ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}
                  title={entry.hint}
                >
                  {MARK[entry.state]} {entry.text}
                </span>

                <span className="flex-1" />

                {editing?.entryId === entry.entryId ? (
                  <>
                    <Input
                      autoFocus
                      className="h-6 w-48 text-xs"
                      placeholder="空着保存就是抹掉显示名"
                      value={editing.value}
                      onChange={(e) => setEditing({ entryId: entry.entryId, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveLabel()
                        if (e.key === 'Escape') setEditing(null)
                      }}
                    />
                    <Button size="xs" variant="default" disabled={busy} onClick={() => void saveLabel()}>
                      保存
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>
                      取消
                    </Button>
                  </>
                ) : confirming === entry.entryId ? (
                  <>
                    <span className="text-destructive">删掉这条条目？包会留在 home 里。</span>
                    <Button
                      size="xs"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => {
                        setConfirming('')
                        void run(REMOVE_ENTRY, { entryId: entry.entryId }, `条目 ${entry.id} 删了，包没动`)
                      }}
                    >
                      确认删条目
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setConfirming('')}>
                      取消
                    </Button>
                  </>
                ) : (
                  <>
                    {/* 看的是 disabled 不是 active：没挂上的条目照样可以「停用」 */}
                    {entry.disabled ? (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy}
                        title="把 cordis.yml 里的 disabled 抹掉，当场挂上"
                        onClick={() => void run(ENABLE, { entryId: entry.entryId }, `条目 ${entry.id} 启用了`)}
                      >
                        启用
                      </Button>
                    ) : (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy}
                        title="往 cordis.yml 里写 disabled: true，当场卸下"
                        onClick={() => void run(DISABLE, { entryId: entry.entryId }, `条目 ${entry.id} 停用了`)}
                      >
                        停用
                      </Button>
                    )}
                    <Button
                      size="xs"
                      variant="ghost"
                      title="给这条条目起个看得懂的名字。id 改不了——它是身份"
                      onClick={() => {
                        setConfirming('')
                        setEditing({ entryId: entry.entryId, value: entry.label ?? '' })
                      }}
                    >
                      改名
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-destructive"
                      title="只从 cordis.yml 里删掉这一条条目。**包不删**，还留在 home 里，这张表上会显示成「没有条目」；要拿掉包自己去 home 里 pnpm remove"
                      onClick={() => {
                        setEditing(null)
                        setConfirming(entry.entryId)
                      }}
                    >
                      删条目
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function boot(args: PaneArgs, container: HTMLElement): Root {
  const root = createRoot(container)
  // 认不出的 paneId 报错、不回落——「注册了 x 却画出 installed」是那种没有任何现象的错
  if (args.pane.id === PANE_ID) root.render(<PluginsPane args={args} />)
  else root.render(<p className="p-3 text-sm text-destructive">本件没有叫 {args.pane.id} 的窗格</p>)
  return root
}

/** 窗格件那半的入口。导出名是 `mountPane`——外壳占整页那个根，窗格占井里一格 */
export function mountPane(args: PaneArgs, container: HTMLElement): { dispose(): void } {
  const root = boot(args, container)
  return {
    dispose() {
      root.unmount()
      container.textContent = ''
    },
  }
}

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CATALOG } from '../catalog'
import {
  acceptInstalled,
  asResult,
  checkManual,
  installedIndex,
  isMissingPlugins,
  NO_INDEX,
  summarize,
  toRows,
  type InstalledIndex,
} from './rows'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * 浏览器半：市场那一格。
 *
 * **数据只有两个来源，都不走网络**：件自带的清单（`../catalog.ts`，决定摆出哪些）与
 * `plugins.list`（决定哪些已经装了）。第一版**不查 registry**——判据见 `../catalog.ts`。
 *
 * **装的动作不归这个件**：调的是 `gwb-plugins` 的两条命令。命令是全局的，跨件调没问题；
 * 但那个件没装时这两条都不在，那时这一格说一句人话（见 `isMissingPlugins`），
 * 而不是把一串错误摆在脸上。
 *
 * **已装的不给「再装一份」按钮**：多数件是服务提供方，第二条条目会抛
 * `service ... has been registered` 根本挂不上。真要第二条走 `plugins.add-entry`。
 */

const PANE_ID = 'market'

/** 别的件的两条命令。市场自己一条命令都没注册 */
const LIST = 'plugins.list'
const INSTALL = 'plugins.install'

/** 外壳调 `mountPane` 时给的那几样。按形状收，只收用得着的两格（正本在 shell 件的 client/types.ts） */
interface PaneArgs {
  host: { call: (command: string, args?: unknown) => Promise<unknown> }
  pane: { id: string; instance: string }
}

function MarketPane({ args }: { args: PaneArgs }): ReactElement {
  /** null 是「还没取到已装的表」。那时装没装一概不显示——空表不等于「一个都没装」 */
  const [index, setIndex] = useState<InstalledIndex | null>(null)
  /** 取表没成时的原话。**一个字都不吞**，只是缺件那种退到次要位置 */
  const [listError, setListError] = useState('')
  /** 这句错话的意思是「插件管理件不在」 */
  const [missing, setMissing] = useState(false)
  const [query, setQuery] = useState('')
  /** 「直接输包名装」那个框 */
  const [manual, setManual] = useState('')
  const [manualError, setManualError] = useState('')
  /** 正在装的那个包名。空串是没在装——pnpm 要几秒到几十秒，这段时间整格禁用 */
  const [busy, setBusy] = useState('')
  /** 装失败的原话，按包名放。**就地显示全文**：pnpm 输出的尾巴就在这里头 */
  const [failed, setFailed] = useState<Record<string, string>>({})
  /** 刚装成的那句话 */
  const [done, setDone] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = asResult(await args.host.call(LIST))
      if (result.ok) {
        setIndex(installedIndex(acceptInstalled(result.data)))
        setListError('')
        setMissing(false)
        return
      }
      const error = result.error ?? ''
      setIndex(null)
      setListError(error)
      setMissing(isMissingPlugins(error))
    } catch (err: unknown) {
      setIndex(null)
      setListError(`取不到已装的表：${String(err)}`)
      setMissing(false)
    }
  }, [args.host])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * 装一个包。**装完一定重新取一次 `plugins.list`**——没有事件推送，不重取的话
   * 这一行会停在「装」上，而那正是「点了没反应」这种最难查的现象。
   */
  const install = async (pkg: string): Promise<void> => {
    setBusy(pkg)
    setDone('')
    setFailed((prev) => {
      const next = { ...prev }
      delete next[pkg]
      return next
    })
    try {
      const result = asResult(await args.host.call(INSTALL, { pkg }))
      if (result.ok) setDone(`${pkg} 装上了，条目也加进 cordis.yml 了。挂上没有去插件那一格看。`)
      // error 里带着 pnpm 输出的尾巴，一个字都不许吞
      else setFailed((prev) => ({ ...prev, [pkg]: result.error ?? '' }))
    } catch (err: unknown) {
      setFailed((prev) => ({ ...prev, [pkg]: String(err) }))
    }
    await refresh()
    setBusy('')
  }

  const submitManual = (): void => {
    const check = checkManual(manual, index ?? NO_INDEX)
    if (!check.ok) {
      setManualError(check.error)
      return
    }
    setManualError('')
    setManual('')
    void install(check.pkg)
  }

  /** 表还没取到（或取不到）时按只读摆：清单照样看得见，装没装一概不说 */
  const readOnly = index === null
  const rows = useMemo(() => toRows(CATALOG, index ?? NO_INDEX, query), [index, query])
  const summary = useMemo(() => summarize(CATALOG, index ?? NO_INDEX, rows), [index, rows])
  const working = busy !== ''

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex items-center gap-3 border-b border-border px-3 py-2">
        <span className="text-sm font-medium">市场</span>
        <span className="text-xs text-muted-foreground">
          {readOnly
            ? `清单 ${String(summary.total)} 个件`
            : `${String(summary.total)} 个件 · 已装 ${String(summary.installed)}${
                query.trim() === '' ? '' : ` · 筛出 ${String(summary.shown)}`
              }`}
        </span>
        <span className="flex-1" />
        <Button size="sm" variant="outline" disabled={working} onClick={() => void refresh()}>
          刷新
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Input
          className="h-8 min-w-40 flex-1 text-xs"
          placeholder="搜索（只筛这份清单，不联网）"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* 兜底那条：清单外的、第三方的件走这儿。同样调 plugins.install */}
        <Input
          className="h-8 w-64 font-mono text-xs"
          placeholder="直接装包名，如 @scope/name"
          value={manual}
          disabled={readOnly || working}
          onChange={(e) => {
            setManual(e.target.value)
            setManualError('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitManual()
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={readOnly || working}
          title="清单外的件走这条。装的一律是最新版"
          onClick={submitManual}
        >
          装这个
        </Button>
      </div>

      {manualError !== '' && (
        <div className="flex items-start gap-2 border-b border-border px-3 py-2 text-xs text-destructive">
          <span className="flex-1 whitespace-pre-wrap break-all">{manualError}</span>
          <Button size="xs" variant="ghost" onClick={() => setManualError('')}>
            知道了
          </Button>
        </div>
      )}

      {done !== '' && (
        <div className="flex items-start gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
          <span className="flex-1 whitespace-pre-wrap break-all">{done}</span>
          <Button size="xs" variant="ghost" onClick={() => setDone('')}>
            知道了
          </Button>
        </div>
      )}

      {/* 缺件那一档说一句人话，原话退到下面一行小字——不吞，只是不占主位 */}
      {missing && (
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm text-destructive">没装插件管理件（@godcreator02/gwb-plugins），装不了东西。</p>
          <p className="mt-1 text-xs text-muted-foreground">
            市场只摆清单，装的动作归它。它自己得先从命令行进 home：在 home 目录下
            <code className="mx-1 font-mono">pnpm add @godcreator02/gwb-plugins</code>
            ，再往 cordis.yml 里加一条条目。装好之后回这儿点「刷新」。
          </p>
          <p className="mt-1 font-mono text-xs break-all text-muted-foreground opacity-70">{listError}</p>
        </div>
      )}

      {!missing && listError !== '' && (
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm text-destructive">取不到已装的表，下面这份清单只能看，装不了。</p>
          <p className="mt-1 whitespace-pre-wrap break-all text-xs text-destructive">{listError}</p>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {rows.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">
            清单里没有匹配「{query.trim()}」的件。清单是件自带的一份白名单，只有 {String(summary.total)} 条；
            要装清单外的，用上面那个「直接装包名」。
          </p>
        )}

        {rows.map((row) => (
          <div key={row.pkg} className="border-b border-border px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium">{row.title}</span>
              <span className="font-mono text-xs text-muted-foreground break-all">{row.pkg}</span>
              <span className="flex-1" />

              {readOnly ? null : row.installed ? (
                // **已装的灰掉、写「已装」，不给「再装一份」按钮**：多数件是服务提供方，
                // 第二条条目会抛 service ... has been registered 根本挂不上
                <span className="flex items-baseline gap-2">
                  {row.spec !== undefined && <span className="font-mono text-xs text-muted-foreground">{row.spec}</span>}
                  <Badge
                    variant="outline"
                    className="opacity-60"
                    title="这个包在 home 里了。要给它多挂一条条目，去插件那一格走 plugins.add-entry"
                  >
                    已装
                  </Badge>
                </span>
              ) : (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={working}
                  title="pnpm add 进 home，再自动加一条 cordis.yml 条目。装的是最新版"
                  onClick={() => void install(row.pkg)}
                >
                  {busy === row.pkg ? '装着…' : '装'}
                </Button>
              )}
            </div>

            <p className="mt-0.5 text-xs text-muted-foreground">{row.why}</p>

            {/* 失败就地显示**全文**：pnpm 输出的尾巴就在这里头，截一半等于没有 */}
            {failed[row.pkg] !== undefined && (
              <pre className="mt-1 rounded-md bg-destructive/10 p-2 text-xs whitespace-pre-wrap break-all text-destructive">
                {failed[row.pkg]}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function boot(args: PaneArgs, container: HTMLElement): Root {
  const root = createRoot(container)
  // 认不出的 paneId 报错、不回落——「注册了 x 却画出 market」是那种没有任何现象的错
  if (args.pane.id === PANE_ID) root.render(<MarketPane args={args} />)
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

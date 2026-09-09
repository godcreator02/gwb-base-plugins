import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { RotateCw, Search } from 'lucide-react'
import { asResult } from './rows'
import { acceptPackages, NO_INDEX, summarize, toRows, type InstalledIndex, type SearchRow } from './market-rows'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * 「可装」那段：registry 上这条线有什么，就摆什么。原先是一份手工白名单（更早是市场件），
 * 2026-09-08 白名单退场——**检索走 npm registry 标准协议**，node 半的 `plugins.search`
 * 一把抓回 `@godcreator02/gwb-*` 全量，搜索框只在本地筛。
 *
 * **registry 在哪儿，这段不知道也不想知道**：基址由 node 半从 pnpm 配置解析——装从哪条
 * 源来，搜就到哪去。
 *
 * **装的动作照旧走本件的服务**：`plugins.install`。已装的不给「再装一份」按钮：多数件
 * 是服务提供方，第二条条目会抛 `service ... has been registered` 根本挂不上。真要第二条
 * 走「已装」那段（`plugins.add-entry`）。直接装包名的框在父格头部，这儿不重复。
 */

const SEARCH = 'plugins.search'
const INSTALL = 'plugins.install'

/** 父格给的那几样。host 按形状收（正本在 shell 件的 client/types.ts） */
export interface MarketTabProps {
  host: { call: (command: string, args?: unknown) => Promise<unknown> }
  /** 已装的包 → 版本范围。null 是「表还没取到」，那时装没装一概不显示 */
  installed: InstalledIndex | null
  /** 父格在忙着别的操作时整段禁用 */
  busy: boolean
  /** 装成了一个之后喊父格重取表——没有事件推送，不重取的话「已装」那段会停在旧样子上 */
  onChanged: () => Promise<void> | void
}

export function MarketTab({ host, installed, busy, onChanged }: MarketTabProps): ReactElement {
  const [query, setQuery] = useState('')
  /** null 是「还没查到」。跟「查到了、源上一个都没有」（空数组）分得开 */
  const [rows, setRows] = useState<SearchRow[] | null>(null)
  /** 查询本身没成的那句话。跟「装失败」（按包名放在行上）分开 */
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(false)
  /** 正在装的那个包名。空串是没在装——pnpm 要几秒到几十秒，这段时间整段禁用 */
  const [busyPkg, setBusyPkg] = useState('')
  /** 装失败的原话，按包名放。**就地显示全文**：pnpm 输出的尾巴就在这里头 */
  const [failed, setFailed] = useState<Record<string, string>>({})
  /** 刚装成的那句话 */
  const [done, setDone] = useState('')

  /**
   * 查一遍 registry。命令的信封里还套着一层回执（search 自己的 ok/error），同样不吞。
   * **查完不本地筛**——筛由 query 的派生做，这儿只管把全量摆上。
   */
  const searchNow = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const result = asResult(await host.call(SEARCH))
      if (!result.ok) {
        setRows(null)
        setLoadError(result.error ?? '')
        return
      }
      const receipt = typeof result.data === 'object' && result.data !== null ? result.data : {}
      const innerOk = (receipt as Record<string, unknown>)['ok'] === true
      if (!innerOk) {
        setRows(null)
        setLoadError(
          typeof (receipt as Record<string, unknown>)['error'] === 'string'
            ? String((receipt as Record<string, unknown>)['error'])
            : '检索没成，也没说是为什么',
        )
        return
      }
      setRows(acceptPackages((receipt as Record<string, unknown>)['packages']))
      setLoadError('')
    } catch (err: unknown) {
      setRows(null)
      setLoadError(String(err))
    } finally {
      setLoading(false)
    }
  }, [host])

  useEffect(() => {
    void searchNow()
  }, [searchNow])

  /**
   * 装一个包。**装完一定喊父格重取**——没有事件推送，不重取的话这一行会停在「装」上，
   * 而那正是「点了没反应」这种最难查的现象。
   */
  const install = async (pkg: string): Promise<void> => {
    setBusyPkg(pkg)
    setDone('')
    setFailed((prev) => {
      const next = { ...prev }
      delete next[pkg]
      return next
    })
    try {
      const result = asResult(await host.call(INSTALL, { pkg }))
      if (result.ok) {
        setDone(`${pkg} 装上了，条目也加进 cordis.yml 了。挂上没有去「已装」那段看。`)
        await onChanged()
      }
      // error 里带着 pnpm 输出的尾巴，一个字都不许吞
      else setFailed((prev) => ({ ...prev, [pkg]: result.error ?? '' }))
    } catch (err: unknown) {
      setFailed((prev) => ({ ...prev, [pkg]: String(err) }))
    }
    setBusyPkg('')
  }

  /** 表还没取到时按只读摆：装没装一概不说 */
  const readOnly = installed === null
  const index = installed ?? NO_INDEX
  const shown = useMemo(() => toRows(rows ?? [], index, query), [rows, index, query])
  const summary = useMemo(() => summarize(rows ?? [], index, shown), [rows, index, shown])
  const working = busyPkg !== '' || busy

  return (
    <div className="plugins:flex plugins:h-full plugins:flex-col">
      <div className="plugins:flex plugins:flex-wrap plugins:items-center plugins:gap-2 plugins:border-b plugins:border-border plugins:px-3 plugins:py-2">
        <div className="plugins:relative plugins:min-w-40 plugins:flex-1">
          <Search className="plugins:pointer-events-none plugins:absolute plugins:top-1/2 plugins:left-2 plugins:size-3.5 plugins:-translate-y-1/2 plugins:text-muted-foreground" />
          <Input
            type="search"
            className="plugins:h-8 plugins:pl-7"
            placeholder="筛这条线，如 log、theme"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="plugins:shrink-0 plugins:text-xs plugins:text-muted-foreground">
          {rows === null
            ? '查 registry…'
            : `${String(summary.total)} 个 gwb 件 · 已装 ${String(summary.installed)}${
                query.trim() === '' ? '' : ` · 筛出 ${String(summary.shown)}`
              }`}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          title="重新查一遍 registry"
          disabled={loading || working}
          onClick={() => void searchNow()}
        >
          <RotateCw />
        </Button>
      </div>

      {done !== '' && (
        <div className="plugins:flex plugins:items-start plugins:gap-2 plugins:border-b plugins:border-border plugins:px-3 plugins:py-2 plugins:text-xs plugins:text-muted-foreground">
          <span className="plugins:flex-1 plugins:whitespace-pre-wrap plugins:break-all">{done}</span>
          <Button size="xs" variant="ghost" onClick={() => setDone('')}>
            知道了
          </Button>
        </div>
      )}

      {loadError !== '' && (
        <div className="plugins:border-b plugins:border-border plugins:px-3 plugins:py-2">
          <p className="plugins:text-sm plugins:text-destructive">查不到 registry，下面空着不是没有件。</p>
          <p className="plugins:mt-1 plugins:whitespace-pre-wrap plugins:break-all plugins:text-xs plugins:text-destructive">{loadError}</p>
        </div>
      )}

      <div className="plugins:flex-1 plugins:overflow-auto">
        {rows !== null && shown.length === 0 && (
          <p className="plugins:p-6 plugins:text-sm plugins:text-muted-foreground">
            {query.trim() === ''
              ? 'registry 上这条线一个 gwb 件都没有。'
              : `这条线上没有匹配「${query.trim()}」的（共 ${String(summary.total)} 个）。清单外的包名，直接用上面那个「直接装包名」。`}
          </p>
        )}

        {shown.map((row) => (
          <div key={row.pkg} className="plugins:border-b plugins:border-border plugins:px-3 plugins:py-2">
            <div className="plugins:flex plugins:items-baseline plugins:gap-2">
              <span className="plugins:font-mono plugins:text-sm plugins:break-all">{row.pkg}</span>
              {row.version !== undefined && (
                <span className="plugins:shrink-0 plugins:font-mono plugins:text-xs plugins:text-muted-foreground" title="registry 上的最新版">
                  {row.version}
                </span>
              )}
              <span className="plugins:flex-1" />

              {readOnly ? null : row.installed ? (
                // **已装的灰掉、写「已装」，不给「再装一份」按钮**：多数件是服务提供方，
                // 第二条条目会抛 service ... has been registered 根本挂不上
                <span className="plugins:flex plugins:items-baseline plugins:gap-2">
                  {row.spec !== undefined && <span className="plugins:font-mono plugins:text-xs plugins:text-muted-foreground">{row.spec}</span>}
                  <Badge
                    variant="outline"
                    className="plugins:opacity-60"
                    title="这个包在 home 里了。要给它多挂一条条目，去「已装」那段走 plugins.add-entry"
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
                  {busyPkg === row.pkg ? '装着…' : '装'}
                </Button>
              )}
            </div>

            {row.description !== undefined && (
              <p className="plugins:mt-0.5 plugins:text-xs plugins:text-muted-foreground">{row.description}</p>
            )}

            {/* 失败就地显示**全文**：pnpm 输出的尾巴就在这里头，截一半等于没有 */}
            {failed[row.pkg] !== undefined && (
              <pre className="plugins:mt-1 plugins:rounded-md plugins:bg-destructive/10 plugins:p-2 plugins:text-xs plugins:whitespace-pre-wrap plugins:break-all plugins:text-destructive">
                {failed[row.pkg]}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

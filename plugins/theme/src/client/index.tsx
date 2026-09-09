import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { buildStartupCss } from '../startup-css.js'

/**
 * 浏览器半——「外观」那一格。两个字体输入框加一块 CSS 文本域：
 * **输入即预览**（直接改页面上那张启动样式表，外壳 boot 时建的那张）、保存才落盘
 * （`theme.save`），重启后由外壳 boot 恢复。**关格即弃**：预览过没存的，dispose 时
 * 退回已保存的样子——不然「页面上这个样子重启就没了」这件事没人提醒。
 *
 * **这个文件里每一个类名都带 `theme:` 前缀**（0.2 起换成 Tailwind 前缀围栏，见
 * `src/client/styles.css`）。本件那张表里的规则也只认这种类名：规则全页有效，但只可能
 * 匹配到本件画出来的元素——围栏来自名字唯一，不是 DOM 祖先关系。漏加前缀的类
 * **静默不出规则**（一个字节都不编，构建照样绿），所以配了 `tests/prefix.test.ts` 钉住。
 *
 * **表不归这儿管**：外壳的 PluginPane 在 import 这个束之前就把 style.css 注好了，令牌表
 * 更是页面级的一份，也由外壳注。容器上那个 `data-gwb-plugin` 仍然挂着，但对这个件
 * **只是身份标记**——它不再承担围栏，围栏已经在类名里。
 *
 * 注意跟本件那条业务线分开：用户填的自定义 CSS 走 `theme.startupCss` 注成页面级那张
 * `#gwb-theme-style`，改的是全页；这份编译产物只是本件这一格自己的工具类表。
 */

const VALUES_COMMAND = 'theme.values'
const SAVE_COMMAND = 'theme.save'

/** 页面上那张启动样式表的 id。跟外壳 client 里那份对得上——两边各存一份字符串，没互相 import */
const STYLE_ID = 'gwb-theme-style'

/** 外壳调 mountPane 时给的那几样。按形状收，只牵用得着的 host */
interface PaneArgs {
  host: { call: (command: string, args?: unknown) => Promise<unknown> }
}

interface ValuesReply {
  'font-sans'?: unknown
  'font-mono'?: unknown
  'custom-css'?: unknown
}

/** 把一段 css 放到页面上那张表里。表不存在就建——id 幂等，注多少遍也只有一张 */
function applyToPage(css: string): void {
  let el = document.getElementById(STYLE_ID)
  if (el === null) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = css
}

const FIELD =
  'theme:w-full theme:rounded-md theme:border theme:border-input theme:bg-transparent theme:px-2 theme:py-1 theme:text-sm theme:outline-none theme:focus-visible:border-ring'

function Appearance({ host }: { host: PaneArgs['host'] }): ReactElement {
  const [fontSans, setFontSans] = useState('')
  const [fontMono, setFontMono] = useState('')
  const [customCss, setCustomCss] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [notice, setNotice] = useState('')
  /** 已保存状态对应的整段 css。null = 还没取到（或没取到过）——那时预览和退回都不动手 */
  const savedRef = useRef<string | null>(null)

  // 开格取一次现值。取到之前不动页面上那张表——预览逻辑会把它清空，那就把 boot 注好的
  // 样式闪没了；「还没装上自己」的时候手别伸那么长
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const reply = (await host.call(VALUES_COMMAND)) as { ok?: boolean; data?: unknown; error?: string }
        if (!alive) return
        if (reply.ok !== true || typeof reply.data !== 'object' || reply.data === null) {
          setNotice(`取现值没取到：${reply.error ?? JSON.stringify(reply)}`)
          return
        }
        const v = reply.data as ValuesReply
        const next = {
          fontSans: typeof v['font-sans'] === 'string' ? v['font-sans'] : '',
          fontMono: typeof v['font-mono'] === 'string' ? v['font-mono'] : '',
          customCss: typeof v['custom-css'] === 'string' ? v['custom-css'] : '',
        }
        setFontSans(next.fontSans)
        setFontMono(next.fontMono)
        setCustomCss(next.customCss)
        const css = buildStartupCss(next)
        savedRef.current = css
        applyToPage(css)
        setLoaded(true)
      } catch (err) {
        if (alive) setNotice(`取现值调不通：${String(err)}`)
      }
    })()
    return () => {
      alive = false
    }
  }, [host])

  // 任何一格变了就现场预览。loaded 之前不动手，理由见上
  const preview = buildStartupCss({ fontSans, fontMono, customCss })
  useEffect(() => {
    if (loaded) applyToPage(preview)
  }, [preview, loaded])

  // 关格退回已保存的样子。「预览≠已存」这条界线靠它守住
  useEffect(
    () => () => {
      if (savedRef.current !== null) applyToPage(savedRef.current)
    },
    [],
  )

  const save = async (): Promise<void> => {
    setNotice('存着…')
    try {
      const reply = (await host.call(SAVE_COMMAND, {
        'font-sans': fontSans,
        'font-mono': fontMono,
        'custom-css': customCss,
      })) as { ok?: boolean; error?: string }
      if (reply.ok !== true) {
        setNotice(`没存上：${reply.error ?? JSON.stringify(reply)}`)
        return
      }
      savedRef.current = buildStartupCss({ fontSans, fontMono, customCss })
      setNotice('存好了——重启也照这个来')
    } catch (err) {
      setNotice(`没存上：${String(err)}`)
    }
  }

  return (
    <div className="theme:flex theme:h-full theme:flex-col theme:gap-3 theme:overflow-auto theme:p-4 theme:text-sm">
      <p className="theme:m-0 theme:text-muted-foreground">
        改完当场生效，要重启后也照旧就点保存。字体填 font-family 的值（如{' '}
        <code className="theme:font-mono">Consolas, monospace</code>），留空用默认系统栈。
      </p>
      <label className="theme:flex theme:flex-col theme:gap-1">
        <span className="theme:text-muted-foreground">正文字体</span>
        <input
          className={FIELD}
          value={fontSans}
          onChange={(e) => setFontSans(e.target.value)}
          placeholder="留空 = 默认"
        />
      </label>
      <label className="theme:flex theme:flex-col theme:gap-1">
        <span className="theme:text-muted-foreground">等宽字体</span>
        <input
          className={FIELD}
          value={fontMono}
          onChange={(e) => setFontMono(e.target.value)}
          placeholder="留空 = 默认"
        />
      </label>
      <label className="theme:flex theme:min-h-40 theme:flex-1 theme:flex-col theme:gap-1">
        <span className="theme:text-muted-foreground">自定义样式表（整段 CSS，写在令牌之上）</span>
        <textarea
          className={`${FIELD} theme:min-h-40 theme:flex-1 theme:resize-none theme:font-mono`}
          value={customCss}
          onChange={(e) => setCustomCss(e.target.value)}
          spellCheck={false}
          placeholder={':root {\n  --background: oklch(0.25 0.01 286);\n}'}
        />
      </label>
      <div className="theme:flex theme:items-center theme:gap-3">
        <button
          type="button"
          className="theme:rounded-md theme:border theme:border-input theme:bg-primary theme:px-3 theme:py-1 theme:text-primary-foreground"
          onClick={() => void save()}
        >
          保存
        </button>
        {notice === '' ? undefined : <span className="theme:text-muted-foreground">{notice}</span>}
      </div>
    </div>
  )
}

/** 外壳调的入口。回一个 `{ dispose }`，契约跟别的窗格件一致 */
export function mountPane(args: PaneArgs, container: HTMLElement): { dispose(): void } {
  const reactRoot: Root = createRoot(container)
  reactRoot.render(<Appearance host={args.host} />)
  return {
    dispose() {
      // 退回已保存的样子这件事挂在组件自己的 unmount 清理里，这儿只拆树
      reactRoot.unmount()
    },
  }
}

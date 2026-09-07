import { useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from './components/ui/button'

/**
 * 浏览器半。验的就是四样：裸名 import 经页面 importmap 解析得到、
 * 两张表都经 gwb:// 拿得到、scope 生效、亮暗切换当场变色而不重新构建任何东西。
 */

const SELF = '@godcreator02/gwb-hello'
const TOKENS = '@godcreator02/gwb-tokens'

/** 取货地址的约定：`gwb://asset/plugins/<包名>/<exports 子路径>` */
function assetUrl(pkg: string, sub: string): string {
  return `gwb://asset/plugins/${pkg}/${sub}`
}

/**
 * 注一张表并**等它真到位**。只 append 是不够的：`<link>` 是异步取的，
 * 第一帧 DOM 完全可能落在表到位之前——那一瞬间是一堆没有样式的裸元素。
 */
function loadStyle(href: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.onload = () => resolve()
    link.onerror = () => reject(new Error(`样式表取不到：${href}`))
    document.head.appendChild(link)
  })
}

function App(): ReactElement {
  const [dark, setDark] = useState(false)
  const toggle = (): void => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
  }

  return (
    <div className="min-h-screen space-y-6 p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">gwb 验收件</h1>
        <p className="text-sm text-muted-foreground">
          这一页的类名全由本件自己那张表提供，颜色取自共享的那份令牌。
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button>默认</Button>
        <Button variant="secondary">次要</Button>
        <Button variant="destructive">危险</Button>
        <Button variant="outline">描边</Button>
        <Button variant="ghost">幽灵</Button>
        <Button variant="link">链接</Button>
      </div>

      <div className="rounded-lg border bg-card p-4 text-card-foreground">
        <p className="text-sm">这块是 bg-card——它跟页面底色差一档，换主题时两个一起变。</p>
      </div>

      <Button variant="outline" onClick={toggle}>
        切到{dark ? '亮色' : '暗色'}
      </Button>
    </div>
  )
}

async function boot(root: HTMLElement): Promise<void> {
  // 令牌表先注：件表里全是 var() 引用，值在那张表上。两张都等到位再渲染
  await loadStyle(assetUrl(TOKENS, 'theme.css'))
  await loadStyle(assetUrl(SELF, 'style.css'))
  // 件的表整张 scope 在这个属性之下——容器上不挂它，一个类名都不生效
  root.setAttribute('data-gwb-plugin', SELF)
  createRoot(root).render(<App />)
}

export function mountShell(_args: unknown, root: HTMLElement): void {
  void boot(root).catch((err: unknown) => {
    root.textContent = `验收件起不来：${String(err)}`
  })
}

import type { GwbContext } from '@godcreator02/gwb-plugin-api'
// 只为激活那几个件的 `declare module 'cordis'`——它们给 ctx 加上各自那个名字
import type {} from '@godcreator02/gwb-commands'
import type {} from '@godcreator02/gwb-settings'
import type {} from '@godcreator02/gwb-shell'
import { buildStartupCss } from './startup-css.js'

/**
 * 外观件：正文字体、等宽字体、自定义样式表。
 *
 * 存走 gwb-settings（home 级三项），读写经自己的两条命令（`theme.values` / `theme.save`
 * ——都绑本件身份，不走「按位置」那条路），启动样式经 `theme.startupCss` 交给外壳：
 * 外壳 boot 在首帧前调它，把整段 css 注进 head，**重启后开机即生效**。
 *
 * **没外壳也能活**——启动样式不靠窗格，没装外壳的 home 里本件照常挂、样式照常全局生效；
 * 「外观」那一格是嵌套注入的，没外壳就只是个后台件。
 */

export const name = 'gwb-theme'

/** 本件的三条命令。注册与调用两处同吃这几个常量 */
export const VALUES_COMMAND = 'theme.values'
export const SAVE_COMMAND = 'theme.save'
export const STARTUP_COMMAND = 'theme.startupCss'

/** 三项设置的 key。kebab-case，gwb-settings 的规矩 */
export const FONT_SANS_KEY = 'font-sans'
export const FONT_MONO_KEY = 'font-mono'
export const CUSTOM_CSS_KEY = 'custom-css'

/** 缺哪个都不挂：没有设置存不了，没有命令总线出不了进程——inject 是等待机制，不是建议 */
export const inject = ['gwbSettings', 'gwbCommands']

/** 浏览器半与样式表的地址，注册窗格时报给外壳。dist/ 下三个文件是邻居，从本模块算 */
const CLIENT_URL = new URL('./client.js', import.meta.url).href
const STYLE_URL = new URL('./style.css', import.meta.url).href

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 本件三样的现值，camel 形——给 buildStartupCss 吃 */
interface Values {
  fontSans: string
  fontMono: string
  customCss: string
}

/** 读本件三样的现值。get 绑本件身份，不用报位置 */
function readValues(ctx: GwbContext): Values {
  const settings = ctx.gwbSettings
  const pick = (key: string): string => {
    const value = settings.get(key)
    return typeof value === 'string' ? value : ''
  }
  return {
    fontSans: pick(FONT_SANS_KEY),
    fontMono: pick(FONT_MONO_KEY),
    customCss: pick(CUSTOM_CSS_KEY),
  }
}

/** 过桥的形状：kebab 形，跟设置项的 key 一字不差，客户端按这个收 */
function toWire(v: Values): { 'font-sans': string; 'font-mono': string; 'custom-css': string } {
  return { [FONT_SANS_KEY]: v.fontSans, [FONT_MONO_KEY]: v.fontMono, [CUSTOM_CSS_KEY]: v.customCss }
}

export function apply(ctx: GwbContext): void {
  const log = ctx.logger(name)
  const settings = ctx.gwbSettings
  const cli = ctx.gwbCommands
  // inject 保证了它在，这句只是把类型收窄（cordis 给的服务类型带 undefined）
  if (cli === undefined) return
  // 三项都是 home 级：外观跟着这个 home 走。default 空串 = 「没设」，启动样式里就不出现
  settings.define({
    key: FONT_SANS_KEY,
    title: '正文字体',
    type: 'string',
    default: '',
    description: 'font-family 的值，如 Consolas, monospace。空 = 用令牌默认的系统栈',
  })
  settings.define({
    key: FONT_MONO_KEY,
    title: '等宽字体',
    type: 'string',
    default: '',
    description: 'font-family 的值。代码、日志那类地方用的那份',
  })
  settings.define({
    key: CUSTOM_CSS_KEY,
    title: '自定义样式表',
    type: 'string',
    default: '',
    description: '整段 CSS 原样生效，写在令牌之上——写 :root { --background: … } 就能换全套配色',
  })

  ctx.effect(() =>
    cli.register(
      { name: STARTUP_COMMAND, description: '启动样式表（字体覆盖 + 自定义 CSS），外壳 boot 时取。无参数', plugin: name },
      () => buildStartupCss(readValues(ctx)),
    ),
  )
  ctx.effect(() =>
    cli.register(
      { name: VALUES_COMMAND, description: '本件三样设置的现值。无参数', plugin: name },
      () => toWire(readValues(ctx)),
    ),
  )
  ctx.effect(() =>
    cli.register(
      { name: SAVE_COMMAND, description: '一次写齐三样。参数 { "font-sans", "font-mono", "custom-css" }（都是字符串，空串 = 抹回默认）', plugin: name },
      async (args) => {
        const raw = (args ?? {}) as Record<string, unknown>
        // 逐项走 set：它自带「先 define 过才许写」的守卫与原子落盘
        await settings.set(FONT_SANS_KEY, asText(raw[FONT_SANS_KEY]))
        await settings.set(FONT_MONO_KEY, asText(raw[FONT_MONO_KEY]))
        await settings.set(CUSTOM_CSS_KEY, asText(raw[CUSTOM_CSS_KEY]))
        return { ok: true }
      },
    ),
  )

  // 外壳在才报窗格。嵌套注入：cordis 的 inject 全是硬依赖，「可选」靠的就是这句开出来的
  // 子 fiber——缺服务时它自己永远 PENDING，而本件照常挂上
  ctx.inject(['gwbShell'], (scoped) => {
    scoped.gwbShell.registerPane({
      id: 'appearance',
      title: '外观',
      icon: 'palette',
      client: CLIENT_URL,
      style: STYLE_URL,
    })
    scoped.gwbShell.describeSelf({ title: '外观', icon: 'palette' })
  })

  log.info(`外观就绪：三项设置 + 三条命令（启动样式走 ${STARTUP_COMMAND}）`)
}

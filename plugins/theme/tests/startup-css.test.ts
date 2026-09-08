import { describe, expect, it } from 'vitest'
import { buildStartupCss } from '../src/startup-css.js'

/**
 * 纯逻辑单测：不碰 ctx 也不碰 DOM。node 半的启动样式与浏览器半的实时预览吃的是
 * 同一个函数，这里的断言同时钉住两头的形状。
 */
describe('buildStartupCss', () => {
  it('三样全空 = 空串——外壳对空串跳过，页面上不留多余的 style', () => {
    expect(buildStartupCss({})).toBe('')
    expect(buildStartupCss({ fontSans: '', fontMono: '  ', customCss: '\n' })).toBe('')
  })

  it('字体覆盖落进 :root，用的就是 gwb-tokens 里那两个令牌名', () => {
    const css = buildStartupCss({ fontSans: 'Consolas, monospace' })
    expect(css).toBe(':root {\n  --gwb-font-sans: Consolas, monospace;\n}\n')
  })

  it('两样字体都在时排进同一个块', () => {
    const css = buildStartupCss({ fontSans: 'A', fontMono: 'B' })
    expect(css).toBe(':root {\n  --gwb-font-sans: A;\n  --gwb-font-mono: B;\n}\n')
  })

  it('自定义 CSS 原样透传，排在字体覆盖之后——同特异性下靠文档序取胜', () => {
    const css = buildStartupCss({ fontMono: 'B', customCss: 'body { color: red }' })
    expect(css).toBe(':root {\n  --gwb-font-mono: B;\n}\n\nbody { color: red }')
  })

  it('非字符串按「没设」算——盘上什么时候混进别的类型都不炸', () => {
    expect(buildStartupCss({ fontSans: 42, customCss: undefined })).toBe('')
  })
})

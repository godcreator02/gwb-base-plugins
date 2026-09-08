/**
 * 把三样设置值拼成一张启动样式表。**纯函数**——不碰 ctx 也不碰 DOM。
 *
 * node 半拿它伺候 `theme.startupCss`，浏览器半拿它做编辑格的实时预览：两处吃的必须是
 * 同一条逻辑，不然「存进去的」和「页面上看的」会分成两套真相。
 */

/** 主题件的三样设置。都可有可无；空串与纯空白按「没设」算 */
export interface ThemeValues {
  fontSans?: unknown
  fontMono?: unknown
  customCss?: unknown
}

/** 字体覆盖的落点。变量名跟 gwb-tokens 里那份一一对应——令牌在那边改名，这边得跟 */
const FONT_VARS: ReadonlyArray<readonly [keyof ThemeValues, string]> = [
  ['fontSans', '--gwb-font-sans'],
  ['fontMono', '--gwb-font-mono'],
]

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function buildStartupCss(values: ThemeValues): string {
  const overrides = FONT_VARS
    .map(([key, varName]) => {
      const text = asText(values[key])
      return text === '' ? undefined : `${varName}: ${text};`
    })
    .filter((line): line is string => line !== undefined)
  const root = overrides.length === 0 ? '' : `:root {\n  ${overrides.join('\n  ')}\n}\n`
  const custom = asText(values.customCss)
  return [root, custom].filter((part) => part !== '').join('\n')
}

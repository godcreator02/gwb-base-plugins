// 见 react.ts 头注：显式具名导出（automatic JSX 运行时三件套）。
import RT from 'react/jsx-runtime'

const R = RT as unknown as Record<string, unknown>

export const jsx = R.jsx
export const jsxs = R.jsxs
export const Fragment = R.Fragment

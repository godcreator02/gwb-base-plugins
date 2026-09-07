// 见 react.ts 头注：显式具名导出。
import ReactDOM from 'react-dom'

const R = ReactDOM as unknown as Record<string, unknown>

export default ReactDOM

export const createPortal = R.createPortal
export const flushSync = R.flushSync
export const preload = R.preload
export const version = R.version

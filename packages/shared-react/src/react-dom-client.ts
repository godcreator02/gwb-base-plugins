// 见 react.ts 头注：显式具名导出。
import Client from 'react-dom/client'

const R = Client as unknown as Record<string, unknown>

export const createRoot = R.createRoot
export const hydrateRoot = R.hydrateRoot

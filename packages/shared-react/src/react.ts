// CJS→ESM 包装：显式列具名导出。esbuild 顺不出 React 那条 CJS 转发链上的具名成员，
// 直接打只会得到一个 default。名单对齐 @types/react 19 的稳定面，加 API 就来补一行。
import React from 'react'

// 取成 Record 是因为 act / cache 这些不在 default 的类型面上；类型不从这个包来——
// 消费方写的是裸名 `import { useState } from 'react'`，类型走它自己装的 @types/react
const R = React as unknown as Record<string, unknown>

export default React

export const Children = R.Children
export const Component = R.Component
export const Fragment = R.Fragment
export const Profiler = R.Profiler
export const PureComponent = R.PureComponent
export const StrictMode = R.StrictMode
export const Suspense = R.Suspense
export const cloneElement = R.cloneElement
export const createContext = R.createContext
export const createElement = R.createElement
export const createRef = R.createRef
export const forwardRef = R.forwardRef
export const isValidElement = R.isValidElement
export const lazy = R.lazy
export const memo = R.memo
export const startTransition = R.startTransition
export const use = R.use
export const useActionState = R.useActionState
export const useCallback = R.useCallback
export const useContext = R.useContext
export const useDebugValue = R.useDebugValue
export const useDeferredValue = R.useDeferredValue
export const useEffect = R.useEffect
export const useId = R.useId
export const useImperativeHandle = R.useImperativeHandle
export const useInsertionEffect = R.useInsertionEffect
export const useLayoutEffect = R.useLayoutEffect
export const useMemo = R.useMemo
export const useOptimistic = R.useOptimistic
export const useReducer = R.useReducer
export const useRef = R.useRef
export const useState = R.useState
export const useSyncExternalStore = R.useSyncExternalStore
export const useTransition = R.useTransition
export const version = R.version
export const act = R.act
export const cache = R.cache

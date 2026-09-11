/**
 * 动态 import 回来的件 client 模块是 `any`，这里把它按窗格契约收窄成三步：
 * 取 `mountPane` 导出、取它回的句柄上的 `dispose`，以及那支可选的 `retarget`。
 *
 * 契约写的是 `mountPane(args, container): { dispose(): void; retarget?(params): void }`——回的是**对象**，不是
 * 函数。把句柄当函数调会抛 TypeError，而卸载路径上的异常通常被 catch 吞掉，于是
 * 「清理一次都没跑过」这件事没有任何现象：React 根不卸、轮询定时器不停，开关几次
 * 窗格后台就攒下几条定时器。所以 `dispose` 必须按契约从句柄上取，取不到就是契约不符，
 * 要说出来。
 *
 * **导出名是 `mountPane` 不是 `mount`**：外壳那半叫 `bootShell`，两个角色各用各的动词，
 * 单看导出名就知道自己是哪种件。判据见内核仓文档站的「写一个件」。
 *
 * 这个文件零 import、不碰 DOM，测试在 node 里直接跑。
 */

/** 只按「能不能调」看待 mountPane：参数由调用方按契约给，返回值再经 pickDispose 收窄 */
export type MountLike = (...args: unknown[]) => unknown

/** 模块上按契约取 `mountPane` 导出；缺了或不是函数回 undefined */
export function pickMountPane(mod: unknown): MountLike | undefined {
  if (mod === null || (typeof mod !== 'object' && typeof mod !== 'function')) return undefined
  const mount = (mod as { mountPane?: unknown }).mountPane
  return typeof mount === 'function' ? (mount as MountLike) : undefined
}

/**
 * mountPane 回的句柄 → 可调的 dispose。
 *
 * **只认对象**：契约写的就是对象，别的形态一律 undefined，由调用方按契约不符报
 * （describeHandle 说清它回的是什么）。`this` 绑回句柄本身：写成方法的
 * `dispose() { this.root.unmount() }` 才拿得到自己的字段。
 */
export function pickDispose(handle: unknown): (() => void) | undefined {
  if (handle === null || typeof handle !== 'object') return undefined
  const dispose = (handle as { dispose?: unknown }).dispose
  if (typeof dispose !== 'function') return undefined
  return () => {
    ;(dispose as (this: unknown) => void).call(handle)
  }
}

/**
 * 句柄上那支**可选的** `retarget`：外壳换了这一格的 params 之后调它（**软换**），
 * 件自己决定怎么换内容、保住哪些状态。
 *
 * **按形状挑，不按类型收**（同 `pickMountPane` / `pickDispose`）：件那半在别的仓、
 * 过的是动态 import，这边手上只有 `unknown`。
 *
 * **挑不到不是错**：没给这一支的件，外壳走硬换（拆了重挂）——所以这儿回 undefined 是
 * 一条正常路径，不出声、不报契约不符。
 */
export function pickRetarget(handle: unknown): ((params: Record<string, unknown>) => void) | undefined {
  if (handle === null || typeof handle !== 'object') return undefined
  const retarget = (handle as { retarget?: unknown }).retarget
  if (typeof retarget !== 'function') return undefined
  return (params) => {
    ;(retarget as (this: unknown, params: Record<string, unknown>) => void).call(handle, params)
  }
}

/** 契约不符时给人看的一句：说清它回的是什么 */
export function describeHandle(handle: unknown): string {
  if (handle === null) return 'null'
  if (handle === undefined) return 'undefined'
  // mountPane 写成了 async：句柄是 Promise，上面当然没有 dispose。按「对象（键：无）」报
  // 人看不出是 thenable，这一种要点名——契约里 mountPane 是同步的
  if (
    (typeof handle === 'object' || typeof handle === 'function') &&
    typeof (handle as { then?: unknown }).then === 'function'
  ) {
    return '一个 Promise（mountPane 写成了 async？契约里它是同步的，句柄得当场回）'
  }
  if (typeof handle === 'function') return '一个函数（契约要的是 { dispose() } 对象）'
  if (typeof handle === 'object') return `一个对象（键：${Object.keys(handle).join(', ') || '无'}）`
  return typeof handle
}

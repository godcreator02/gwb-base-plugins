/**
 * 格间小总线的壳侧实现：一条条目一个桶，同一条条目的几格共用它。
 *
 * **不用 `window` 上的 CustomEvent**：那是一整页共享的命名空间，两个插件挑了同一个
 * 事件名就串台，而症状是「我的格收到了别人的事件」——从哪儿都看不出来。分桶之后
 * 命名空间是每条条目自己的，插件爱叫什么叫什么。
 *
 * **也不用 `EventTarget`**：它把听众抛出的异常丢给全局错误处理（页面上就是一条
 * 来路不明的红字），而这里要的是「一个插件写坏了不能把兄弟格一起带走」——异常按
 * 听众隔离、原地记一条带条目 id 的 console.error。
 *
 * 桶按引用计数活着：最后一格卸载就整个拆掉。留着空桶不是省事，是把上一轮的听众
 * 拖进下一轮——同一条条目关掉再开，会收到自己上辈子挂的回调。
 *
 * 零 DOM、零 react，测试在 node 里直接跑。
 */

/**
 * 一格拿到的总线句柄：给窗格的那两条，外加外壳自己用的 release。
 *
 * **按形状收，不 extends 别处的类型**（同 liveness 的 `EntryLike`、panels 的 `PanelLike`）：
 * 这几个模块要能在 node 里直接跑测试，牵进浏览器半的类型链就跑不动了。符合不符合契约，
 * 由真正接线那一处的标注钉着。
 */
export interface PaneBusHandle {
  /**
   * 往桶里发一条。**`release` 之后再发是静默的**（桶已经从注册表上摘了，这个句柄
   * 手里那份没有听众）——外壳的清理顺序是「先让件 dispose、再 release」，所以件在
   * 自己的 dispose 里喊一嗓子是有效的；无声的只有件把句柄泄漏到卸载之后的那种。
   */
  emit(type: string, detail?: unknown): void
  /** 挂一个听众，回注销函数（摘两遍不炸） */
  on(type: string, listener: (detail: unknown) => void): () => void
  /** 这一格不要了（幂等）：自己挂的听众逐条摘掉，桶上最后一格松手时整个拆掉 */
  release(): void
}

export interface BusRegistry {
  acquire(scope: string): PaneBusHandle
  /**
   * 此刻有哪些桶、各自几格占着、挂了哪些事件名。**只给验收用**（调试面
   * `__gwbDebug.buses()`）：格间总线断了的症状是「另一格不动」，而那跟插件自己没
   * 发、发错了名字、两格根本不在一个桶里三种成因分不开——不摆出桶的状态就只能猜。
   */
  inspect(): { scope: string; refs: number; types: string[] }[]
}

interface Bucket {
  listeners: Map<string, Set<(detail: unknown) => void>>
  refs: number
}

export function createBusRegistry(): BusRegistry {
  const buckets = new Map<string, Bucket>()

  return {
    inspect() {
      return [...buckets.entries()].map(([scope, b]) => ({
        scope,
        refs: b.refs,
        types: [...b.listeners.entries()].map(([type, set]) => `${type}×${String(set.size)}`),
      }))
    },
    acquire(scope) {
      let bucket = buckets.get(scope)
      if (bucket === undefined) {
        bucket = { listeners: new Map(), refs: 0 }
        buckets.set(scope, bucket)
      }
      const own = bucket
      own.refs += 1
      let released = false
      /**
       * 这一格自己挂了哪些听众。`release` 要照着它逐条摘——**桶不一定跟着这一格走**：
       * 同一条条目还有别的格占着时桶留着，不摘的话这一格明明关掉了，它的回调还在
       * 桶里收事件，往一棵已经拆掉的 React 树上打。
       *
       * 一格一份的年代这个洞是遮住的（最后一格松手时整个桶就没了），同一格能开两份
       * 之后才露出来。
       */
      const mine = new Set<{ type: string; fn: (detail: unknown) => void }>()

      /** 从桶里摘一条，空了连类型一起收掉 */
      const drop = (type: string, fn: (detail: unknown) => void): void => {
        const set = own.listeners.get(type)
        if (set === undefined) return
        set.delete(fn)
        if (set.size === 0) own.listeners.delete(type)
      }

      return {
        emit(type, detail) {
          // 先抄一份再发：听众里调 on/off 是常事（收到一条就摘掉自己），
          // 直接遍历活集合会漏掉或重复
          const set = own.listeners.get(type)
          if (set === undefined) return
          // **这份拷贝不是多余的**——no-useless-spread 看不出遍历期间集合会被改
          // oxlint-disable-next-line unicorn/no-useless-spread
          for (const fn of [...set]) {
            try {
              fn(detail)
            } catch (err) {
              console.error(`[shell] 条目 ${scope} 的窗格听 ${type} 时抛了：`, err)
            }
          }
        },
        on(type, listener) {
          let set = own.listeners.get(type)
          if (set === undefined) {
            set = new Set()
            own.listeners.set(type, set)
          }
          set.add(listener)
          const entry = { type, fn: listener }
          mine.add(entry)
          return () => {
            mine.delete(entry)
            drop(type, listener)
          }
        },
        release() {
          if (released) return
          released = true
          // 先摘自己挂的，再松手。顺序反过来的话桶可能已经拆了，摘了个寂寞——
          // 而桶没拆的那种情况正是这几行要治的
          for (const { type, fn } of mine) drop(type, fn)
          mine.clear()
          own.refs -= 1
          // 只拆自己这个桶：条目关掉再开的话，新桶已经换了一份，别把它连坐
          if (own.refs <= 0 && buckets.get(scope) === own) buckets.delete(scope)
        },
      }
    },
  }
}

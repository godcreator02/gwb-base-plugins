/**
 * 浏览器半用得着的几个形状。**按形状收，不牵别处的类型**（同 `bus` / `liveness` /
 * `panels` 的做法）：`bootShell` 的参数由内核的渲染层拼，那半在另一个仓里。
 */

/** 内核交出来的命令口。整条链路是：界面 → IPC → 主进程 → fd3 → 内核 dispatch → ctx.gwbCommands */
export interface HostBridge {
  call(command: string, args?: unknown): Promise<unknown>
}

/** 内核调 `bootShell` 时给的那几样 */
export interface ShellArgs {
  host: HostBridge
  /** 这个 home 的目录，眼下只用来在状态里显示 */
  home: string
  /** 条目视图。第三刀还没人用它——注册表已经隐含了「件活着」，判据见 openable 的头注 */
  entries: unknown[]
}

/** 注册表里一条过桥之后的样子。跟 node 半的 `RegisteredPane` 是同一个形状 */
export interface PaneRow {
  entryId: string
  pkg: string
  id: string
  title: string
  icon?: string
  duplicable?: boolean
}

/**
 * 外壳交给窗格件的那一层。件只操作得了**自己**那几格——`entryId` 由 `PluginPane`
 * 造这个对象时闭包绑定，件报不出别人的。
 */
export interface ShellBridge {
  /**
   * 打开本件的另一格。已经开着就聚焦它；`duplicate: true` 才再开一份，而且那一格
   * 得在注册时声明过 `duplicable`。认不出 paneId 就什么都不做。
   */
  openPane(paneId: string, options?: { duplicate?: boolean }): void
  /** 格间小总线。桶按条目分，所以同一条条目的几格（含重复实例）在同一个桶里 */
  bus: {
    emit(type: string, detail?: unknown): void
    /** 挂一个听众，回注销函数 */
    on(type: string, listener: (detail: unknown) => void): () => void
  }
}

/** 外壳调件的 `mountPane` 时给的那几样 */
export interface PaneArgs {
  host: HostBridge
  shell: ShellBridge
  pane: {
    /** 这一格是本件的哪一格（注册时给的那个 id） */
    id: string
    /** 这**一份**的唯一键（dockview 的 panel id）。开两份时两份的这个值不一样 */
    instance: string
  }
}

/**
 * 浏览器半用得着的几个形状。**按形状收，不牵别处的类型**（同 `bus` / `liveness` /
 * `panels` 的做法）：`bootShell` 的参数由内核的渲染层拼，那半在另一个仓里。
 */

/** 内核交出来的命令口。整条链路是：界面 → IPC → 主进程 → fd3 → 内核 dispatch → ctx.gwbCli */
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
}

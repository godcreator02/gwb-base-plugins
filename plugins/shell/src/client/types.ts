/**
 * 浏览器半用得着的几个形状。**按形状收，不牵别处的类型**（同 `bus` / `liveness` /
 * `panels` 的做法）：`bootShell` 的参数由内核的渲染层拼，那半在另一个仓里。
 *
 * `OpenPaneOptions` 是例外：它不过 IPC、也不跨仓，`planOpen` 与这份契约吃的是同一个
 * 形状，各存一份就是两份真相。
 */

import type { OpenPaneOptions } from '../openable.js'

/** 内核交出来的命令口。整条链路是：界面 → IPC → 主进程里的 ctx.gwbCommands */
export interface HostBridge {
  call(command: string, args?: unknown): Promise<unknown>
}

/** 入口模块（boot.ts）调 `bootShell` 时给的那几样，全从 `shell.env` 那条命令来 */
export interface ShellArgs {
  host: HostBridge
  /** 这个 home 的目录，眼下只用来在状态里显示 */
  home: string
  /** 按序加载的样式表地址：令牌表、dockview 表、本件自己的表 */
  styles: string[]
}

/** 注册表里一条过桥之后的样子。跟 node 半的 `RegisteredPane` 是同一个形状 */
export interface PaneRow {
  entryId: string
  pkg: string
  id: string
  title: string
  icon?: string
  /** 浏览器半与样式表的地址，件注册时自报。见 pane-registry 的 PaneSpec */
  client?: string
  style?: string
}

/**
 * 外壳交给窗格件的那一层。件只操作得了**自己**那几格——`entryId` 由 `PluginPane`
 * 造这个对象时闭包绑定，件报不出别人的。
 */
export interface ShellBridge {
  /**
   * 打开本件的另一格。**身份是 `options.key`**：装着这份内容的那一格已经开着就聚焦它，
   * 没开着才开新的一份（`preview: true` 时优先放进预览格）。认不出 paneId 什么都不做。
   *
   * `options.params` 是**让开出来的几份彼此不同**的那条路：它原样到那一份的
   * `mountPane` 手上（`pane.params`），并且跟着布局落盘、重启后还在。必须可 JSON
   * 序列化，保留键与代价见 `OpenPaneOptions`。
   */
  openPane(paneId: string, options?: OpenPaneOptions): void
  /**
   * 改**这一格**标签上的标题。dockview 的 `setTitle` 转了一道——原文格把标签改成
   * 当前文件名就是走这里。初始标题归 `registerPane`，这里只管运行时改。
   */
  setPaneTitle(title: string): void
  /**
   * 把**这一格**留住：它不再是预览格，下一次 preview 打开不会顶掉它。
   *
   * 件该在「人真的开始用这一格」的那一刻调它（开始编辑、改了什么），**不是挂上就调**
   * ——挂上就调等于这个件没有预览格。已经是正式格时调它是空操作，重复调不要紧。
   * 人**双击标签**是同一个动作的手势版。没有反方向：正式格变不回预览格。
   */
  keepPane(): void
  /** 格间小总线。桶按条目分，所以同一条条目的几格（含重复实例）在同一个桶里 */
  bus: {
    emit(type: string, detail?: unknown): void
    /** 挂一个听众，回注销函数 */
    on(type: string, listener: (detail: unknown) => void): () => void
  }
}

/**
 * 件的 `mountPane` 回的那个句柄。**`dispose` 是硬的，`retarget` 是可选的**：
 *
 * - 给了 `retarget`：外壳换了这一格的 params 之后调它（**软换**），件自己决定怎么换
 *   内容、保住哪些状态（滚动位置、前进后退、正在打的字）
 * - 没给：外壳**拆了重挂**（硬换）。简单的件不必为此写一行代码，代价是那一格的
 *   内部状态跟着重来一遍
 */
export interface PaneHandle {
  dispose(): void
  retarget?(params: Record<string, unknown>): void
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
    /**
     * 开这一份时件自己传的那份参数（`openPane` 的 `options.params`），**不含外壳的
     * 保留键**——件看不见 `entryId` 这类外壳内部的东西。
     *
     * **没传就没有这一项**，不是空对象。它跟着布局落盘，所以重启之后这一份拿到的
     * 还是当初那一份。
     *
     * **这是挂上那一刻的那份**。后来换了内容的话，新的那份走 `retarget(params)`
     * 到件手上（件没给 `retarget` 就是拆了重挂，那时这儿拿到的本来就是新的）。
     */
    params?: Record<string, unknown>
  }
}

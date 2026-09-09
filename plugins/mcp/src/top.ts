/**
 * 顶层工具怎么选。纯函数，从接线里抽出来于是可测。
 *
 * 桥固定只渲染两枚（`gwb_command_list` / `gwb_command_run`），外加**登记时标了 `top: true`**
 * 的那几条命令——顶层是开发时定的，桥看到 `true` 就渲染，没有运行时名单、没有批准这一步。
 * 其余命令一律经 `gwb_command_run` 按名调。
 *
 * 为什么收这么窄：客户端的顶层工具清单与 resources 列表都是**连接时的快照**，server
 * instructions 又会被截断；而逐条渲染出来的工具 schema 全是 `args: unknown`，比 command_run
 * 只多一个名字。顶层是稀缺位，只留给「连上第一件就要看」的命令（说明书那两条）。
 */

/** 挑出要渲染成顶层工具的那几条：登记时标了 `top` 的，按登记顺序 */
export function selectTop<T extends { top: boolean }>(commands: readonly T[]): T[] {
  return commands.filter((command) => command.top)
}

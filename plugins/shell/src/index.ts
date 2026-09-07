/**
 * node 半。第一刀是空的——这一刀只把那批纯逻辑搬进来，还没有任何要在宿主侧做的事。
 *
 * 第二刀这儿会长出窗格注册服务 `ctx.gwbShell`：件在自己的 `apply` 里注册窗格，
 * 而不是在包清单里静态声明。判据见内核仓 decisions。
 */
export const name = 'gwb-shell'

export function apply(): void {}

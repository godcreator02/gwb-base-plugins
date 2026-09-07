/**
 * 自检的靶子：起得来就打一行 JSON 走人。
 *
 * 它替这条路上的每一环签字——`process.execPath` 起得来、`ELECTRON_RUN_AS_NODE` 生效了、
 * 参数原样到达、stdout 收得回来。**不发出去就是一条指向空气的命令**，所以包清单的
 * `files` 里带着 `selftest`。
 */

process.stdout.write(
  JSON.stringify({
    ok: true,
    from: 'gwb-node-cli',
    argv: process.argv.slice(2),
    node: process.versions.node,
    cwd: process.cwd(),
  }) + '\n',
)

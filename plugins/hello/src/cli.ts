/**
 * 这个件的 node CLI。**它是编译产物**：`tsc` 把这份编译成 `dist/cli.js`，
 * 登记进 `ctx.gwbNodeCli` 的就是那个 js 的绝对路径——不是这份源文件。
 *
 * 消费方件要跑 node CLI，照这个形状写即可：
 * - 只用 `node:` 内置模块（产物守卫会查裸名 import，件该是自包含的）
 * - **stdout 只放 JSON**，那是数据面；要说的话往 stderr 写
 * - 退出码是给调用方看的：回执里的 `exitCode` 就是它
 *
 * 手上要单独跑一趟的话：`node <包根>/dist/cli.js --名 值`
 */

import process from 'node:process'

interface Parsed {
  flags: Set<string>
  rest: string[]
}

/** 极简参数解析：`--x` 收进 flags，其余原样留着。样板不需要一个参数库 */
function parse(argv: readonly string[]): Parsed {
  const flags = new Set<string>()
  const rest: string[] = []
  for (const arg of argv) {
    if (arg.startsWith('--')) flags.add(arg.slice(2))
    else rest.push(arg)
  }
  return { flags, rest }
}

function main(): number {
  const { flags, rest } = parse(process.argv.slice(2))

  // 故意失败那一路：验的是回执里的 exitCode 真能带回界面,而不是一失败就没声了
  if (flags.has('fail')) {
    process.stderr.write('[hello-cli] 这是故意失败的那一路,stderr 与退出码都该原样回到界面\n')
    return 1
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      from: 'gwb-hello',
      lang: 'node',
      runtime: process.versions.node,
      args: rest,
      flags: [...flags],
      cwd: process.cwd(),
      // 留着验编码:这条要是乱码,说明这条链上有人没走 UTF-8
      note: '中文没乱码就对了',
    })}\n`,
  )
  return 0
}

process.exitCode = main()

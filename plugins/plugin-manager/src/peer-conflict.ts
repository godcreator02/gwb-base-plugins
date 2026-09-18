/**
 * pnpm 报 peer 冲突时，回执怎么说人话——零 I/O 纯逻辑。真去跑 pnpm 的那半在 `pnpm.ts`。
 *
 * 严不严格不归这个件管：由 home 自己的 `pnpm-workspace.yaml`（`strictPeerDependencies: true`）
 * 决定，这个件调 pnpm 不带任何 peer 相关参数。严格的 home 里 peer 对不上，pnpm 退出码 1、报
 * `ERR_PNPM_PEER_DEP_ISSUES`；不严格的 home 里只打一句 WARN、照装。
 */

/** pnpm 严格 peer 检查没过时报的错误码 */
export const PEER_CONFLICT_CODE = 'ERR_PNPM_PEER_DEP_ISSUES'

/** 一趟 add 没成时手上有的：退出码、尾巴、冲突说明、home 碰没碰 */
export interface AddFailure {
  exitCode: number | null
  tail?: string
  peerConflict?: string
  untouched?: boolean
}

/** home 原样的那半句。预检就没过时才说得出 */
export const UNTOUCHED = '这一趟什么都没动（home 的 package.json、pnpm-lock.yaml、node_modules 原样）'

/**
 * 一趟 add 没成 → 回执里的 `error` 一句话、`tail`、`peerConflict`。`what` 是那趟的人话名字
 * （`pnpm add a@1 b@2`）。
 *
 * peer 冲突：`tail` 换成冲突说明本身（pnpm 原尾巴里那段关掉检查的 hint 不带），`error` 说清下一步。
 */
export function describeAddFailure(what: string, run: AddFailure): { error: string; tail?: string; peerConflict?: string } {
  const stay = run.untouched === true ? `。${UNTOUCHED}` : ''
  if (run.peerConflict !== undefined) {
    return {
      error:
        `${what} 被拒：peer 对不上（home 开着严格 peer 检查，${PEER_CONFLICT_CODE}）。下面 Installed 是 home 里现在那一版，Wanted 下是要别的范围的插件——` +
        `多半是有插件还没跟上上游的破坏版：先把那个下游升上来，或 plugin-manager.update-all {"only":[…]} 只升别的；` +
        `是 home 里的上游太旧，就先把上游升上来${stay}`,
      tail: run.peerConflict,
      peerConflict: run.peerConflict,
    }
  }
  const error = `${what} 没成（${run.untouched === true ? '预检，' : ''}退出码 ${String(run.exitCode)}）${stay}`
  return run.tail === undefined ? { error } : { error, tail: run.tail }
}

/**
 * 从 pnpm 的输出里认出严格 peer 检查没过，截出那段冲突说明。不是这种失败回 undefined。
 *
 * 截的是错误码那行之后、`hint:` 之前：每条 `✕ unmet peer <包>` 带 Installed 与 Wanted（谁要什么
 * 范围）。`hint:` 那段教的是关掉严格检查，不带进回执。
 */
export function peerConflictOf(output: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const lines = output.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((line) => line.includes(PEER_CONFLICT_CODE))
  if (start === -1) return undefined
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^\s*hint:/.test(line)) break
    body.push(line)
  }
  while (body.length > 0 && body[0]!.trim() === '') body.shift()
  while (body.length > 0 && body[body.length - 1]!.trim() === '') body.pop()
  return body.length === 0 ? lines[start]!.trim() : body.join('\n')
}

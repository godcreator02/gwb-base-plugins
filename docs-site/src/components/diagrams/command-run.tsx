'use client'

/**
 * 一条命令的执行：左边三类调用方，中间命令总线（run 与命令表），右边登记方给的处理函数，下面四种结果各变成什么回执。
 * 最后一步把连线反过来，表示回执原路返回。
 */

import { Arrow, Box, Frame, StepCaption } from './parts'
import { StepControls, useSteps } from './steps'

type Part = 'page' | 'agent' | 'plugin' | 'kernel' | 'mcp' | 'run' | 'table' | 'handler' | 'passThrough' | 'wrapped' | 'thrown' | 'missing'

const STEPS: { title: string; detail: string; lit: Part[]; returning?: boolean }[] = [
  { title: '全貌', detail: '页面、agent、别的插件调的是同一个 gwbCommands.run，查的是同一张命令表；命令总线只把来源 via 转交给处理函数，不按它限制能调什么。', lit: [] },
  {
    title: '第 1 步：调用进来',
    detail: '页面调 window.gwb.command，内核收下后交给 run 并带上 { via: "ui" }；agent 调 MCP 入口的 run 工具，MCP 入口带上 { via: "mcp" }；别的插件直接调 ctx.gwbCommands.run，不带来源。',
    lit: ['page', 'agent', 'plugin', 'kernel', 'mcp', 'run'],
  },
  { title: '第 2 步：按命令名查表', detail: '命令表只在内存里。找不到这条命令，直接回 { ok: false, error: \'没有这条命令：<命令名>\' }，写一条 warn。', lit: ['run', 'table', 'missing'] },
  { title: '第 3 步：执行处理函数', detail: '参数原样交给登记方的处理函数，由它自己校验；来源是第二个参数，没带就是 { via: "plugin" }。命令总线不校验参数、不设时限。', lit: ['table', 'handler'] },
  {
    title: '第 4 步：结果变成回执',
    detail: '处理函数返回带 ok 的对象，原样返回；返回别的值，包成 { ok: true, data }；抛错，收成 { ok: false, error }，不抛给调用方。',
    lit: ['handler', 'passThrough', 'wrapped', 'thrown'],
  },
  {
    title: '第 5 步：回执原路返回',
    detail: '成功写 info 日志（只读命令写 debug），失败写 warn。调用方只看 ok 判断成败，失败原因读 error。',
    lit: ['page', 'agent', 'plugin', 'kernel', 'mcp', 'run'],
    returning: true,
  },
]

export function CommandRun() {
  const state = useSteps(STEPS.length, 3200)
  const current = STEPS[state.step]!
  const lit = (part: Part) => (current.lit.includes(part) ? (current.returning ? 'b' : 'a') : undefined)
  const calling = state.step === 1
  const back = current.returning === true

  /** 调用方一侧的连线：调用时从左往右，返回时从右往左 */
  const link = (x1: number, x2: number, y: number, label?: string) =>
    back ? <Arrow from={[x2, y]} to={[x1, y]} tone="b" flow label={label} /> : <Arrow from={[x1, y]} to={[x2, y]} tone={calling ? 'a' : undefined} flow={calling} label={label} />

  return (
    <>
      <svg viewBox="0 0 760 410" role="img" aria-label="一条命令从调用方到处理函数、回执原路返回">
        <Box x={10} y={40} w={150} h={48} lines={['页面', 'window.gwb.command']} tone={lit('page')} mono />
        <Box x={10} y={120} w={150} h={48} lines={['agent', 'MCP 客户端']} tone={lit('agent')} />
        <Box x={10} y={200} w={150} h={48} lines={['别的插件', 'ctx.gwbCommands.run']} tone={lit('plugin')} mono />

        <Box x={190} y={40} w={140} h={48} lines={['内核', '带 via: "ui"']} tone={lit('kernel')} />
        <Box x={190} y={120} w={140} h={48} lines={['MCP 入口', '带 via: "mcp"']} tone={lit('mcp')} />

        {link(160, 190, 64)}
        {link(330, 380, 64)}
        {link(160, 190, 144)}
        {link(330, 380, 144)}
        {link(160, 380, 224, back ? '回执' : '直接调用')}

        <Frame x={368} y={10} w={236} h={250} label="命令总线 gwbCommands" />
        <Box x={380} y={36} w={80} h={212} lines={['run', '(name, args,', 'context?)', '从不抛错']} tone={lit('run')} mono />
        <Box x={474} y={36} w={118} h={212} lines={['命令表', 'skill.read', 'logger.backlog', 'mcp.info', '…']} tone={lit('table')} mono />
        <Arrow from={[460, 142]} to={[474, 142]} tone={state.step === 2 ? 'a' : undefined} />

        <Box x={630} y={112} w={120} h={60} lines={['处理函数', '登记方给的']} tone={lit('handler')} />
        <Arrow from={[592, 142]} to={[630, 142]} tone={state.step === 3 ? 'a' : undefined} flow={state.step === 3} />

        <Box x={10} y={276} w={179} h={52} lines={['返回带 ok 的对象', '原样返回']} tone={lit('passThrough')} />
        <Box x={197} y={276} w={179} h={52} lines={['返回别的值', '{ ok: true, data }']} tone={lit('wrapped')} mono />
        <Box x={384} y={276} w={179} h={52} lines={['处理函数抛错', '{ ok: false, error }']} tone={lit('thrown') === 'a' ? 'b' : undefined} mono />
        <Box x={571} y={276} w={179} h={52} lines={['没有这条命令', '{ ok: false, error }']} tone={lit('missing') === 'a' ? 'b' : undefined} mono />

        <StepCaption x={14} y={356} w={730} title={current.title} detail={current.detail} />
      </svg>
      <StepControls count={STEPS.length} state={state} />
    </>
  )
}

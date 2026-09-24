'use client'

/**
 * 日志从哪来、到哪去：左边三个来源汇进 cordis 的日志流，中间三个 exporter（内核的、cordis 自带的缓冲、日志插件的），
 * 右边日志插件的 2000 条缓冲、推给页面的事件与日志窗格，下面是 logger.backlog 命令。
 */

import { Arrow, Box, Frame, StepCaption } from './parts'
import { StepControls, useSteps } from './steps'

type Part = 'plugin' | 'kernel' | 'renderer' | 'stream' | 'kernelExporter' | 'buffer' | 'loggerExporter' | 'ring' | 'emit' | 'pane' | 'backlog'

const STEPS: { title: string; detail: string; lit: Part[]; flows: string[] }[] = [
  { title: '全貌', detail: '插件、内核、页面 console 的日志都经 cordis 的 ctx.logger 汇成一条流。日志插件在这条流上注册一个 exporter，收下每一条、存进缓冲、推给页面。', lit: [], flows: [] },
  {
    title: '第 1 步：三个来源汇成一条流',
    detail: '插件用 ctx.logger(\'<名字>\') 写；内核自己的名字是 kernel，loader 的是 loader；页面 console 由内核转成名为 renderer 的日志。',
    lit: ['plugin', 'kernel', 'renderer', 'stream'],
    flows: ['sources'],
  },
  {
    title: '第 2 步：内核写文件，cordis 留一份缓冲',
    detail: '内核注册的 exporter 写 stderr 与 <home>/gwb.log，日志插件不在时照写；cordis 自带的缓冲 ctx.logger.buffer 留 info 及以上。',
    lit: ['stream', 'kernelExporter', 'buffer'],
    flows: ['toKernel', 'toBuffer'],
  },
  {
    title: '第 3 步：日志插件加载，先补历史',
    detail: '先从 ctx.logger.buffer 把加载之前的日志补进自己的缓冲，再注册自己的 exporter（debug 也收）。先补再注册，两段不重叠。',
    lit: ['buffer', 'ring', 'loggerExporter'],
    flows: ['backfill'],
  },
  {
    title: '第 4 步：每条新日志存下并推给页面',
    detail: '编递增的 seq，按 logger 名分来源（renderer 是页面，kernel、loader 是内核，其余是插件），存进 2000 条缓冲，经 gwbKernel.emit 推 { t: \'gwb-logger\', line }。',
    lit: ['stream', 'loggerExporter', 'ring', 'emit'],
    flows: ['toLogger', 'toRing', 'toEmit'],
  },
  {
    title: '第 5 步：日志窗格取数',
    detail: '窗格先用 window.gwb.on 订阅实时事件，再调 logger.backlog 取缓冲里的历史，两段按 seq 合并去重。反过来做，中间那一刻的日志会漏掉。',
    lit: ['emit', 'pane', 'backlog', 'ring'],
    flows: ['toPane', 'call', 'read'],
  },
]

export function LogFlow() {
  const state = useSteps(STEPS.length, 3600)
  const current = STEPS[state.step]!
  const lit = (part: Part) => (current.lit.includes(part) ? 'a' : undefined)
  const flowing = (name: string) => current.flows.includes(name)
  const tone = (name: string) => (flowing(name) ? 'a' : undefined)

  return (
    <>
      <svg viewBox="0 0 760 420" role="img" aria-label="日志从三个来源经 cordis 日志流到日志插件、页面与日志窗格">
        <Box x={10} y={30} w={140} h={50} lines={['插件', "ctx.logger('名字')"]} tone={lit('plugin')} mono />
        <Box x={10} y={100} w={140} h={50} lines={['内核', 'kernel · loader']} tone={lit('kernel')} mono />
        <Box x={10} y={170} w={140} h={50} lines={['页面 console', '内核转成 renderer']} tone={lit('renderer')} />

        <Box x={180} y={30} w={110} h={190} lines={['cordis', '日志流', 'ctx.logger']} tone={lit('stream')} />
        <Arrow from={[150, 55]} to={[180, 55]} tone={tone('sources')} flow={flowing('sources')} />
        <Arrow from={[150, 125]} to={[180, 125]} tone={tone('sources')} flow={flowing('sources')} />
        <Arrow from={[150, 195]} to={[180, 195]} tone={tone('sources')} flow={flowing('sources')} />

        <Box x={320} y={20} w={170} h={44} lines={['内核的 exporter', 'stderr · gwb.log']} tone={lit('kernelExporter')} mono />
        <Box x={320} y={80} w={170} h={44} lines={['cordis 自带缓冲', 'ctx.logger.buffer']} tone={lit('buffer')} mono />
        <Frame x={306} y={140} w={324} h={96} label="日志插件 gwb-logger" lit={current.lit.includes('loggerExporter') || current.lit.includes('ring')} />
        <Box x={320} y={170} w={170} h={50} lines={['日志插件的 exporter', 'debug 也收']} tone={lit('loggerExporter')} />
        <Arrow from={[290, 42]} to={[320, 42]} tone={tone('toKernel')} flow={flowing('toKernel')} />
        <Arrow from={[290, 102]} to={[320, 102]} tone={tone('toBuffer')} flow={flowing('toBuffer')} />
        <Arrow from={[290, 195]} to={[320, 195]} tone={tone('toLogger')} flow={flowing('toLogger')} />

        <Box x={520} y={170} w={100} h={50} lines={['缓冲', '最近 2000 条']} tone={lit('ring')} />
        <Box x={640} y={170} w={100} h={50} lines={['gwbKernel', '.emit']} tone={lit('emit')} mono />
        <Arrow from={[490, 195]} to={[520, 195]} tone={tone('toRing')} flow={flowing('toRing')} />
        <Arrow from={[620, 195]} to={[640, 195]} tone={tone('toEmit')} flow={flowing('toEmit')} />
        <Arrow from={[490, 102]} to={[570, 170]} label="补历史" dashed={!flowing('backfill')} tone={tone('backfill')} flow={flowing('backfill')} />

        <Box x={560} y={270} w={190} h={56} lines={['日志窗格（界面插件仓）', '先订阅，再取历史，按 seq 合并']} tone={lit('pane')} />
        <Box x={320} y={270} w={170} h={56} lines={['命令 logger.backlog', '返回缓冲里的日志']} tone={lit('backlog')} mono />
        <Arrow from={[656, 220]} to={[656, 270]} label="window.gwb.on" tone={tone('toPane')} flow={flowing('toPane')} />
        <Arrow from={[560, 298]} to={[490, 298]} label="调用" tone={tone('call')} flow={flowing('call')} />
        <Arrow from={[540, 220]} to={[480, 270]} label="读" tone={tone('read')} dashed={!flowing('read')} />

        <StepCaption x={14} y={356} w={730} title={current.title} detail={current.detail} />
      </svg>
      <StepControls count={STEPS.length} state={state} />
    </>
  )
}

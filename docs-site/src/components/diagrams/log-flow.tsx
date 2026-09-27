'use client'

/**
 * 日志从哪来、日志插件怎么读：左边三个来源经内核写进 <home>/gwb.log，右上是 gwb.log 与轮转出的 gwb.log.1 两份文件，
 * 下面是日志插件的 logger.query 与调用它的日志窗格、agent；分步讲倒着读、after 只读新写的、轮转过的情形与坏行报错。
 */

import { Arrow, Box, Frame, Note, StepCaption } from './parts'
import { StepControls, useSteps } from './steps'

type Part = 'sources' | 'kernel' | 'current' | 'rotated' | 'query' | 'caller' | 'afterInCurrent' | 'afterBeyond' | 'badLine'

const STEPS: { title: string; detail: string; lit: Part[]; flows: string[] }[] = [
  {
    title: '全貌',
    detail: '内核把全部日志写进 <home>/gwb.log，写满了改名成 gwb.log.1。日志插件不收日志、不留缓冲，只在有人调 logger.query 时读这两份文件。',
    lit: [],
    flows: [],
  },
  {
    title: '第 1 步：内核写，满了改名',
    detail: '插件、内核、页面 console 的日志都由内核写成 gwb.log 里的一行 JSON：{ ts, level, source, name, msg }，键与顺序固定。gwb.log 满 128 MB 改名成 gwb.log.1，只留这一份旧的。日志插件一行都不写。',
    lit: ['sources', 'kernel', 'current', 'rotated'],
    flows: ['sources', 'write', 'rotate'],
  },
  {
    title: '第 2 步：不给 after，从末尾往前读',
    detail: '从 gwb.log 末尾按块往前读，逐行解析、按 minLevel / name / text 筛，凑够 limit 条（默认 2000）就停；gwb.log 不够就接着从 gwb.log.1 末尾往前读，不把整份文件读进内存。entries 从旧到新，cursor 是这时 gwb.log 的字节长度。',
    lit: ['current', 'rotated', 'query', 'caller'],
    flows: ['call', 'read', 'readCurrentBack', 'readRotatedBack'],
  },
  {
    title: '第 3 步：给 after，只读新写的',
    detail: '把上一次回执里的 cursor 作 after 传回来。gwb.log 不比 after 小，就只读 after 到末尾这一段，回执里的 cursor 跟到新的末尾；没有新日志就回空的 entries。',
    lit: ['current', 'query', 'caller', 'afterInCurrent'],
    flows: ['call', 'read'],
  },
  {
    title: '第 4 步：gwb.log 比 after 小，说明轮转过',
    detail: '改名之后新的 gwb.log 从零开始写，长度比 after 小。这时先读 gwb.log.1 从 after 到末尾，再读新 gwb.log 全部，两段连起来就是上一次之后写的全部日志。',
    lit: ['current', 'rotated', 'query', 'caller', 'afterBeyond'],
    flows: ['call', 'read', 'rotate'],
  },
  {
    title: '第 5 步：坏行、坏参数直接报错',
    detail: '某一行不是 JSON，或者五个键的顺序、类型与内核写的对不上，logger.query 直接报错，写明是哪份文件、那一行开头几十个字符，不跳过。参数里有认不出的键、类型不对，也直接报错。',
    lit: ['badLine', 'query'],
    flows: ['read'],
  },
]

const CURRENT = { x: 336, y: 128, w: 260, h: 40 }
const ROTATED = { x: 336, y: 48, w: 400, h: 40 }

export function LogFlow() {
  const state = useSteps(STEPS.length, 4200)
  const current = STEPS[state.step]!
  const lit = (part: Part) => (current.lit.includes(part) ? 'a' : undefined)
  const shows = (part: Part) => current.lit.includes(part)
  const flowing = (name: string) => current.flows.includes(name)
  const tone = (name: string) => (flowing(name) ? 'a' : undefined)

  return (
    <>
      <svg viewBox="0 0 760 450" role="img" aria-label="内核写 gwb.log 与 gwb.log.1，日志插件的 logger.query 读这两份文件">
        <Box x={10} y={30} w={130} h={50} lines={['插件', "ctx.logger('名字')"]} tone={lit('sources')} mono />
        <Box x={10} y={100} w={130} h={50} lines={['内核', 'kernel · loader']} tone={lit('sources')} mono />
        <Box x={10} y={170} w={130} h={50} lines={['页面 console', '内核转成 renderer']} tone={lit('sources')} />

        <Box x={170} y={30} w={120} h={190} lines={['内核', '每条写一行 JSON', 'stderr 另写文本']} tone={lit('kernel')} />
        <Arrow from={[140, 55]} to={[170, 55]} tone={tone('sources')} flow={flowing('sources')} />
        <Arrow from={[140, 125]} to={[170, 125]} tone={tone('sources')} flow={flowing('sources')} />
        <Arrow from={[140, 195]} to={[170, 195]} tone={tone('sources')} flow={flowing('sources')} />

        <Frame x={320} y={14} w={430} h={190} label="<home>" lit={shows('current') || shows('rotated')} />
        <Box {...ROTATED} lines={['gwb.log.1', '上一份，写满 128 MB 时改名而来']} tone={lit('rotated')} mono />
        <Box {...CURRENT} lines={['gwb.log', '正在写，追加在末尾']} tone={lit('current')} mono />
        <Arrow from={[290, 148]} to={[CURRENT.x, 148]} label="追加" tone={tone('write')} flow={flowing('write')} />
        <Arrow from={[400, CURRENT.y]} to={[400, ROTATED.y + ROTATED.h]} label="满了改名" dashed={!flowing('rotate')} tone={tone('rotate')} flow={flowing('rotate')} />

        <Arrow from={[CURRENT.x + CURRENT.w - 4, 184]} to={[CURRENT.x + 4, 184]} label="从末尾往前" labelAt="below" dashed={!flowing('readCurrentBack')} tone={tone('readCurrentBack')} flow={flowing('readCurrentBack')} />
        <Arrow from={[ROTATED.x + ROTATED.w - 4, 104]} to={[ROTATED.x + 150, 104]} label="不够再往前" labelAt="below" dashed={!flowing('readRotatedBack')} tone={tone('readRotatedBack')} flow={flowing('readRotatedBack')} />

        <line x1={CURRENT.x + CURRENT.w} y1={CURRENT.y - 4} x2={CURRENT.x + CURRENT.w} y2={CURRENT.y + CURRENT.h + 4} stroke="var(--diagram-b)" strokeWidth={1.6} />
        <Note x={CURRENT.x + CURRENT.w + 6} y={CURRENT.y + 24} mono>
          cursor
        </Note>

        {shows('afterInCurrent') && (
          <g>
            <rect x={520} y={CURRENT.y} width={CURRENT.x + CURRENT.w - 520} height={CURRENT.h} rx={4} fill="var(--diagram-a-soft)" stroke="var(--diagram-a)" />
            <line x1={520} y1={CURRENT.y - 6} x2={520} y2={CURRENT.y + CURRENT.h + 6} stroke="var(--diagram-a)" strokeWidth={1.6} />
            <Note x={516} y={CURRENT.y - 8} anchor="end" mono>
              after
            </Note>
          </g>
        )}
        {shows('afterBeyond') && (
          <g>
            <rect x={660} y={ROTATED.y} width={ROTATED.x + ROTATED.w - 660} height={ROTATED.h} rx={4} fill="var(--diagram-a-soft)" stroke="var(--diagram-a)" />
            <line x1={660} y1={ROTATED.y - 6} x2={660} y2={CURRENT.y + CURRENT.h + 6} stroke="var(--diagram-a)" strokeWidth={1.6} strokeDasharray="4 3" />
            <Note x={664} y={CURRENT.y + 24} mono>
              after
            </Note>
          </g>
        )}

        <Frame x={320} y={228} w={264} h={96} label="日志插件 gwb-logger" lit={shows('query')} />
        <Box x={334} y={258} w={236} h={52} lines={['命令 logger.query', '回 { file, cursor, entries }']} tone={lit('query')} mono />
        <Arrow from={[452, 204]} to={[452, 258]} label="读" dashed={!flowing('read')} tone={tone('read')} flow={flowing('read')} />

        <Box x={604} y={258} w={146} h={52} lines={['日志窗格、agent', '经命令总线调用']} tone={lit('caller')} />
        <Arrow from={[604, 284]} to={[570, 284]} tone={tone('call')} flow={flowing('call')} />

        <Box x={10} y={258} w={280} h={52} lines={['坏行：不是 JSON、键或类型不对', '直接报错，写明文件与行首']} tone={lit('badLine')} dashed={!shows('badLine')} />

        <StepCaption x={14} y={356} w={730} h={72} title={current.title} detail={current.detail} />
      </svg>
      <StepControls count={STEPS.length} state={state} />
    </>
  )
}

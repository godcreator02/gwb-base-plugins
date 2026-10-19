/**
 * 线程池一次 run 的全程：左边开池的插件，中间 gwbWorkers 的池（里面画排队），右边常驻的线程，下面回执。
 * 讲清两件事：模块在每个线程只加载一次；任务出错只影响它自己，排队的换新线程接着跑。
 * 派遣走池与线程列之间的通道，交回走线程列右侧的主干再折回执，两组线不相交。
 */

import { Arrow, Box, Note, StepCaption, toneStroke } from './parts'
import { StepControls, useSteps } from './steps'

type Part = 'plugin' | 'pool' | 'queue' | 'thread1' | 'thread2' | 'thread3' | 'receipt'

const STEPS: { title: string; detail: string; lit: Part[]; flows: string[] }[] = [
  {
    title: '全貌',
    detail: '插件开了一个最多 4 个线程的池。线程有任务才开，开了就留着；模块在每个线程里只加载一次，数据库连接这类模块级状态在同一个线程上保留。',
    lit: [],
    flows: [],
  },
  {
    title: '第 1 步：开池',
    detail: '插件调 ctx.gwbWorkers.pool({ name, module, threads, taskTimeoutMs? })。名字重了、threads 不在 1–16、module 不是 file: 地址，当场抛错。',
    lit: ['plugin', 'pool'],
    flows: [],
  },
  {
    title: '第 2 步：排队',
    detail: 'run(fn, args) 把任务放进队尾，先来的在右；参数要能被结构化克隆。',
    lit: ['plugin', 'queue'],
    flows: ['run'],
  },
  {
    title: '第 3 步：上线程',
    detail: '有空闲线程就交给它；没有且没满就开一个新线程，新线程先 import 模块再接任务。',
    lit: ['queue', 'thread2'],
    flows: ['dispatch'],
  },
  {
    title: '第 4 步：交回',
    detail: '线程调模块导出的 fn(...args)，回 { ok, value } 或带 name、message 的错误；主线程按原样交给插件，接着把队首的任务交给这个线程。',
    lit: ['thread2', 'receipt', 'plugin'],
    flows: ['reply', 'back'],
  },
  {
    title: '第 5 步：超时或崩溃',
    detail: '任务超过 taskTimeoutMs、线程出错或退出：终止这个线程，这一个任务报错；排队的任务换新线程接着跑。',
    lit: ['queue', 'thread3'],
    flows: ['rescue'],
  },
  {
    title: '第 6 步：关池',
    detail: '插件卸载时池关闭：排队的与正在跑的都报错，线程全部终止，之后的 run 也报错。',
    lit: ['pool', 'thread1', 'thread2', 'thread3'],
    flows: [],
  },
]

/** 折线箭头：横平竖直的几段拼成，末端带箭头，样式与 parts 的 Arrow 一致 */
function Elbow({ points, tone, flow }: { points: [number, number][]; tone?: 'a'; flow?: boolean }) {
  const d = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${String(x)},${String(y)}`).join(' ')
  const [x2, y2] = points[points.length - 1]!
  const [px, py] = points[points.length - 2]!
  const angle = Math.atan2(y2 - py, x2 - px)
  const head = 7
  const color = toneStroke(tone)
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeWidth={flow ? 1.6 : 1.2} className={flow ? 'diagram-flow' : undefined} />
      <polygon
        points={`${String(x2)},${String(y2)} ${String(x2 - head * Math.cos(angle - 0.4))},${String(y2 - head * Math.sin(angle - 0.4))} ${String(x2 - head * Math.cos(angle + 0.4))},${String(y2 - head * Math.sin(angle + 0.4))}`}
        fill={color}
      />
    </g>
  )
}

export function WorkersRun() {
  const state = useSteps(STEPS.length, 3600)
  const current = STEPS[state.step]!
  const lit = (part: Part) => (current.lit.includes(part) ? 'a' : undefined)
  const flowing = (name: string) => current.flows.includes(name)
  const tone = (name: string) => (flowing(name) ? 'a' : undefined)
  const dead = state.step === 5
  const taskTone = lit('queue')

  return (
    <>
      <svg viewBox="0 0 840 500" role="img" aria-label="线程池从开池到回结果">
        <Box x={10} y={120} w={190} h={76} lines={['插件', "pool.run('countPapers',", '[dataDir])']} tone={lit('plugin')} mono />

        <Box x={280} y={90} w={260} h={160} lines={['gwbWorkers · 池 library', '排队 · 先来的在右']} tone={lit('pool')} />
        {[[340], [380], [420]].map(([x], index) => (
          <rect
            key={index}
            x={x}
            y={210}
            width={30}
            height={18}
            rx={3}
            fill={taskTone === undefined ? 'var(--color-fd-background)' : 'var(--diagram-a-soft)'}
            stroke={taskTone === undefined ? 'var(--color-fd-muted-foreground)' : 'var(--diagram-a)'}
            strokeWidth={1.2}
            style={{ transition: 'fill 400ms ease, stroke 400ms ease' }}
          />
        ))}

        <Box x={600} y={40} w={190} h={60} lines={['线程 1', '已加载 worker.js']} tone={lit('thread1')} mono />
        <Box
          x={600}
          y={140}
          w={190}
          h={60}
          lines={dead ? ['线程 2', '坏了，已终止'] : ['线程 2', '已加载 worker.js']}
          tone={lit('thread2')}
          mono
          dim={dead}
        />
        <Box
          x={600}
          y={240}
          w={190}
          h={60}
          lines={dead ? ['线程 3', '换的新线程接着跑'] : ['线程 3', '已加载 worker.js']}
          tone={lit('thread3')}
          mono
        />

        <Box x={10} y={340} w={470} h={60} lines={['回执', '值，或带原 name 与 message 的错误']} tone={lit('receipt')} mono />

        {flowing('run') && (
          <>
            <Arrow from={[200, 158]} to={[280, 158]} tone={tone('run')} flow />
            <Note x={240} y={148} anchor="middle">run(fn, args)</Note>
          </>
        )}
        {flowing('dispatch') && (
          <>
            <Arrow from={[540, 170]} to={[600, 170]} tone={tone('dispatch')} flow />
            <Note x={610} y={124} anchor="start">交给空闲线程</Note>
          </>
        )}
        {flowing('rescue') && (
          <>
            <Elbow points={[[540, 170], [570, 170], [570, 270], [600, 270]]} tone={tone('rescue')} flow />
            <Note x={578} y={220} anchor="start">换新线程接着跑</Note>
          </>
        )}
        {flowing('reply') && (
          <>
            <Elbow points={[[790, 170], [815, 170], [815, 372], [485, 372]]} tone={tone('reply')} flow />
            <Note x={650} y={362} anchor="middle">回 {'{ ok, value }'} 或错误</Note>
          </>
        )}
        {flowing('back') && (
          <>
            <Arrow from={[105, 340]} to={[105, 196]} tone={tone('back')} flow />
            <Note x={113} y={268} anchor="start">交回插件</Note>
          </>
        )}

        <StepCaption x={14} y={415} w={810} title={current.title} detail={current.detail} h={72} />
      </svg>
      <StepControls count={STEPS.length} state={state} />
    </>
  )
}

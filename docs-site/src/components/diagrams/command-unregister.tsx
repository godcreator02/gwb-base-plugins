'use client'

/**
 * 登记与自动注销：两个插件先后登记同名命令 mine.hello，再先后卸载。
 * 左边是两个插件和各自 effect 上的注销函数，右边是命令表里 mine.hello 此刻指向谁、这一步写了哪行日志。
 */

import { Arrow, Box, Frame, MUTED, Note, StepCaption, type Tone } from './parts'
import { StepControls, useSteps } from './steps'

type Owner = '@scope/a' | '@scope/b' | undefined

const STEPS: {
  title: string
  detail: string
  row: Owner
  log: string[]
  aLoaded: boolean
  bLoaded: boolean
  aRegistered: boolean
  bRegistered: boolean
  active?: 'a' | 'b' | 'aOff' | 'bOff'
}[] = [
  {
    title: '全貌',
    detail: 'register 把注销登记在调用方的 effect 上：服务方法里的 this.ctx 是调用方的上下文，调用方卸载时命令自动注销，不用自己包 ctx.effect。',
    row: undefined,
    log: [],
    aLoaded: true,
    bLoaded: true,
    aRegistered: false,
    bRegistered: false,
  },
  {
    title: '第 1 步：插件 A 登记 mine.hello',
    detail: 'A 调 ctx.gwbCommands.register(def, handler)，拿回注销函数；同一个注销函数也登记在 A 的 effect 上。',
    row: '@scope/a',
    log: ['info', '命令 mine.hello 已登记（@scope/a）'],
    aLoaded: true,
    bLoaded: true,
    aRegistered: true,
    bRegistered: false,
    active: 'a',
  },
  {
    title: '第 2 步：插件 B 登记同名命令',
    detail: '同名时后登记的生效，同时写一条 warn，写明原来是哪个包、现在是哪个包。',
    row: '@scope/b',
    log: ['warn', '命令 mine.hello 被重复登记，后登记的生效：', '@scope/a → @scope/b'],
    aLoaded: true,
    bLoaded: true,
    aRegistered: true,
    bRegistered: true,
    active: 'b',
  },
  {
    title: '第 3 步：插件 A 卸载',
    detail: 'A 的 effect 执行注销函数。注销函数先确认表里还是自己登记的那条记录才删；现在是 B 的，所以什么也不删。',
    row: '@scope/b',
    log: ['表里不是自己那条：不删，不写日志'],
    aLoaded: false,
    bLoaded: true,
    aRegistered: true,
    bRegistered: true,
    active: 'aOff',
  },
  {
    title: '第 4 步：插件 B 卸载',
    detail: 'B 的注销函数发现表里是自己那条，删掉。注销函数重复调用什么也不做；B 自己又包了一层 ctx.effect 也只注销一次。',
    row: undefined,
    log: ['表里是自己那条：mine.hello 从表里删掉'],
    aLoaded: false,
    bLoaded: false,
    aRegistered: false,
    bRegistered: true,
    active: 'bOff',
  },
]

function Plugin({ y, name, pkg, loaded, registered, lit, tone }: { y: number; name: string; pkg: string; loaded: boolean; registered: boolean; lit: boolean; tone: Tone }) {
  return (
    <g>
      <Frame x={10} y={y} w={260} h={116} label={loaded ? name : `${name}（已卸载）`} lit={lit} />
      <Box x={24} y={y + 28} w={232} h={36} lines={[pkg, 'register(def, handler)']} mono dim={!loaded} />
      <Box x={24} y={y + 72} w={232} h={34} lines={[registered ? 'effect：注销 mine.hello' : 'effect：（空）']} dashed={!registered} dim={!loaded && !lit} tone={registered && lit ? tone : undefined} />
    </g>
  )
}

export function CommandUnregister() {
  const state = useSteps(STEPS.length, 3400)
  const current = STEPS[state.step]!
  const rowText = current.row === undefined ? 'mine.hello　（没有这条）' : `mine.hello → ${current.row} 的处理函数`

  return (
    <>
      <svg viewBox="0 0 760 372" role="img" aria-label="两个插件登记同名命令、先后卸载时命令表的变化">
        <Plugin y={10} name="插件 A" pkg="@scope/a" loaded={current.aLoaded} registered={current.aRegistered} lit={current.active === 'a' || current.active === 'aOff'} tone="a" />
        <Plugin y={140} name="插件 B" pkg="@scope/b" loaded={current.bLoaded} registered={current.bRegistered} lit={current.active === 'b' || current.active === 'bOff'} tone="b" />

        <Frame x={340} y={10} w={410} h={116} label="命令表 gwbCommands" />
        <Box x={354} y={46} w={382} h={52} lines={[rowText]} tone={current.row === undefined ? undefined : current.row === '@scope/a' ? 'a' : 'b'} dashed={current.row === undefined} mono />

        <Frame x={340} y={140} w={410} h={116} label="这一步的日志" />
        {current.log.length === 0 && (
          <Note x={356} y={200} size={11.5} color={MUTED}>
            —
          </Note>
        )}
        {current.log.map((line, index) => (
          <Note key={`${index}-${line}`} x={356} y={178 + index * 20} size={11.5} color={index === 0 && line.length < 6 ? MUTED : 'var(--color-fd-foreground)'}>
            {line}
          </Note>
        ))}

        {current.active === 'a' && <Arrow from={[270, 56]} to={[354, 66]} tone="a" flow label="register" />}
        {current.active === 'b' && <Arrow from={[270, 186]} to={[354, 88]} tone="b" flow label="register" />}
        {current.active === 'aOff' && <Arrow from={[256, 99]} to={[354, 80]} tone="a" dashed />}
        {current.active === 'bOff' && <Arrow from={[256, 229]} to={[354, 92]} tone="b" flow />}

        <StepCaption x={14} y={292} w={730} title={current.title} detail={current.detail} h={60} />
      </svg>
      <StepControls count={STEPS.length} state={state} />
    </>
  )
}

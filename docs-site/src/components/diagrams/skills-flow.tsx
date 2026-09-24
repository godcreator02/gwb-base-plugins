'use client'

/**
 * 说明书从登记到被读：左边是带说明书的插件（构建产物与包根的 skills/ 目录），中间是说明书插件的登记表与两条命令，
 * 右边是经 MCP 入口读说明书的 agent。左下是另一个带同名说明书的插件。
 */

import { Arrow, Box, Frame, StepCaption } from './parts'
import { StepControls, useSteps } from './steps'

type Part = 'entry' | 'folder' | 'other' | 'table' | 'commands' | 'agent'

const STEPS: { title: string; detail: string; lit: Part[]; flows: string[]; unloaded?: boolean; clash?: boolean }[] = [
  { title: '全貌', detail: '说明书是随插件包发布的目录，每个子目录一份 SKILL.md。插件自己把目录交给说明书插件，agent 经 skill.list、skill.read 读。', lit: [], flows: [] },
  {
    title: '第 1 步：插件登记目录',
    detail: '插件用 ctx.inject([\'gwbSkills\'], …) 局部注入，调 register(new URL(\'../skills/\', import.meta.url))；没装说明书插件时照常加载。',
    lit: ['entry', 'table'],
    flows: ['register'],
  },
  {
    title: '第 2 步：扫描目录',
    detail: '每个带 SKILL.md 的子目录算一份；frontmatter 只认单行的 name、description；包名取自调用方条目，登记方不用自己报。超限、读不了的逐条写 warn。',
    lit: ['folder', 'table'],
    flows: ['scan'],
  },
  {
    title: '第 3 步：名字已被占',
    detail: '说明书名全局唯一：先登记的保留，后来的这一份不登记，写一条 warn 说明名字被哪个插件占着。',
    lit: ['other', 'table'],
    flows: ['clash'],
    clash: true,
  },
  {
    title: '第 4 步：agent 读正文',
    detail: 'run skill.list 回 { count, skills }；run skill.read { name, file? } 只读登记时扫出的文件清单里的文件，每次从磁盘读，回 { name, file, text }。',
    lit: ['agent', 'commands', 'folder'],
    flows: ['agent', 'read'],
  },
  {
    title: '第 5 步：插件卸载',
    detail: 'register 把注销登记在调用方的 effect 上，插件卸载时它登记的说明书从表里撤掉，只撤自己那几份。',
    lit: ['table'],
    flows: [],
    unloaded: true,
  },
]

export function SkillsFlow() {
  const state = useSteps(STEPS.length, 3400)
  const current = STEPS[state.step]!
  const lit = (part: Part) => (current.lit.includes(part) ? (current.clash && part === 'other' ? 'b' : 'a') : undefined)
  const flowing = (name: string) => current.flows.includes(name)
  const gone = current.unloaded === true

  return (
    <>
      <svg viewBox="0 0 760 410" role="img" aria-label="插件登记说明书、agent 读说明书、插件卸载时撤掉">
        <Frame x={10} y={10} w={230} h={220} label={gone ? '带说明书的插件（已卸载）' : '带说明书的插件（包根）'} lit={current.lit.includes('entry') || current.lit.includes('folder')} />
        <Box x={24} y={40} w={202} h={52} lines={['dist/index.js', 'register(dir)']} tone={lit('entry')} mono dim={gone} />
        <Box x={24} y={110} w={202} h={104} lines={['skills/', '<子目录>/SKILL.md', '<子目录>/references/…', '（列进 package.json 的 files）']} tone={lit('folder')} mono dim={gone} />

        <Box x={10} y={252} w={230} h={52} lines={['另一个插件', '也带一份同名说明书']} tone={lit('other')} dim={!current.lit.includes('other')} dashed={!current.lit.includes('other')} />

        <Frame x={290} y={10} w={220} h={294} label="说明书插件 gwbSkills" />
        <Box x={304} y={38} w={192} h={120} lines={gone ? ['登记表', '（这个插件的那几份已撤掉）'] : ['登记表：名字 → 一份', 'name · description', 'plugin（包名）', 'files（文件清单）']} tone={lit('table')} />
        <Box x={304} y={178} w={192} h={110} lines={['两条命令', 'skill.list', 'skill.read', '{ name, file? }']} tone={lit('commands')} mono />

        <Box x={560} y={206} w={190} h={60} lines={['agent', '经 MCP 入口的 run']} tone={lit('agent')} />

        <Arrow from={[226, 66]} to={[304, 80]} label="register" tone={flowing('register') ? 'a' : undefined} flow={flowing('register')} />
        <Arrow from={[226, 150]} to={[304, 120]} label="扫描" dashed={!flowing('scan')} tone={flowing('scan') ? 'a' : undefined} flow={flowing('scan')} />
        {flowing('clash') && <Arrow from={[240, 270]} to={[304, 150]} label="同名：不登记" tone="b" flow />}
        <Arrow from={[560, 236]} to={[496, 236]} label="run skill.read" tone={flowing('agent') ? 'a' : undefined} flow={flowing('agent')} />
        {flowing('read') && <Arrow from={[304, 196]} to={[226, 180]} label="按清单读文件" labelAt="below" tone="a" flow />}

        <StepCaption x={14} y={336} w={730} title={current.title} detail={current.detail} />
      </svg>
      <StepControls count={STEPS.length} state={state} />
    </>
  )
}

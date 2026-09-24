'use client'

/**
 * 三个工具的内容从哪来：每行一个工具，左边是工具与参数，中间是它每次调用时取的东西，右边是返回什么。
 * 最下面一行是 run 按回执形状翻译的三种结果。
 */

import { Arrow, Box, StepCaption } from './parts'
import { StepControls, useSteps } from './steps'

type Part = 'index' | 'search' | 'run' | 'cli' | 'standard' | 'custom'

const STEPS: { title: string; detail: string; lit: Part[] }[] = [
  { title: '全貌', detail: 'index、search 每次调用都重新读取命令表与说明书清单，不缓存；run 把命令交给命令总线，再按回执的形状翻译成工具结果。', lit: [] },
  {
    title: 'index',
    detail: '无参数。返回 home 名、MCP 插件版本、instructions.md 全文、说明书清单（名字、包名、描述）、按包名分组的命令名，末尾一句提示下一步去哪查。',
    lit: ['index'],
  },
  {
    title: 'search',
    detail: 'plugin 精确匹配包名，命令与说明书一起筛；prefix 只筛命令名；q 在名字、一句话介绍、用法里找子串。命中的命令总带 usage；不带参数返回全部。',
    lit: ['search'],
  },
  {
    title: 'run',
    detail: '参数是字符串时先试着按 JSON 解析（有的客户端会把对象参数序列化成字符串）；交给 gwbCommands.run，每次都写一条日志。',
    lit: ['run'],
  },
  {
    title: 'run 的回执怎么翻译',
    detail: '同时有 stdout 与 exitCode 的是命令行工具回执，只留六项；有 ok、data、error 以外的键，原样转成文本；标准回执失败时回「执行失败：<error>」并带 isError。',
    lit: ['run', 'cli', 'custom', 'standard'],
  },
]

export function McpTools() {
  const state = useSteps(STEPS.length, 3400)
  const current = STEPS[state.step]!
  const lit = (part: Part) => (current.lit.includes(part) ? 'a' : undefined)
  const on = (part: Part) => current.lit.includes(part)

  return (
    <>
      <svg viewBox="0 0 760 420" role="img" aria-label="MCP 入口三个工具的内容来源与返回">
        <Box x={10} y={20} w={160} h={56} lines={['index', '无参数']} tone={lit('index')} mono />
        <Box x={210} y={20} w={250} h={56} lines={['gwbCommands.list()', 'gwbSkills.list() · instructions.md']} tone={lit('index')} mono />
        <Box x={500} y={20} w={250} h={56} lines={['地图', '说明书清单 · 命令按包名分组只列名字']} tone={lit('index')} />
        <Arrow from={[170, 48]} to={[210, 48]} tone={lit('index')} flow={on('index')} />
        <Arrow from={[460, 48]} to={[500, 48]} tone={lit('index')} flow={on('index')} />

        <Box x={10} y={100} w={160} h={56} lines={['search', '{ plugin?, prefix?, q? }']} tone={lit('search')} mono />
        <Box x={210} y={100} w={250} h={56} lines={['同一份 list()', '现取现筛']} tone={lit('search')} />
        <Box x={500} y={100} w={250} h={56} lines={['命中的命令（带 usage）', '命中的说明书']} tone={lit('search')} />
        <Arrow from={[170, 128]} to={[210, 128]} tone={lit('search')} flow={on('search')} />
        <Arrow from={[460, 128]} to={[500, 128]} tone={lit('search')} flow={on('search')} />

        <Box x={10} y={180} w={160} h={56} lines={['run', '{ command, args? }']} tone={lit('run')} mono />
        <Box x={210} y={180} w={250} h={56} lines={['字符串参数先试 JSON 解析', 'gwbCommands.run(command, args)']} tone={lit('run')} mono />
        <Box x={500} y={180} w={250} h={56} lines={['按回执形状翻译', '三种形状见下一行']} tone={lit('run')} />
        <Arrow from={[170, 208]} to={[210, 208]} tone={lit('run')} flow={on('run') && state.step === 3} />
        <Arrow from={[460, 208]} to={[500, 208]} tone={lit('run')} flow={on('run') && state.step === 3} />

        <Box x={10} y={264} w={240} h={72} lines={['命令行工具回执', '有 stdout 与 exitCode', 'ok · exitCode · timedOut …六项']} tone={lit('cli')} />
        <Box x={260} y={264} w={240} h={72} lines={['处理函数原样返回的对象', '有 ok / data / error 以外的键', '整个对象原样转成文本']} tone={lit('custom')} />
        <Box x={510} y={264} w={240} h={72} lines={['标准回执', '只有 ok / data / error', '失败：执行失败：… + isError']} tone={lit('standard') === 'a' ? 'b' : undefined} />

        <StepCaption x={14} y={364} w={730} title={current.title} detail={current.detail} />
      </svg>
      <StepControls count={STEPS.length} state={state} />
    </>
  )
}

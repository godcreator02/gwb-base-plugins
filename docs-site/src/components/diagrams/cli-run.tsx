'use client'

/**
 * node 命令行工具从登记到回执：左边登记方插件与它随包带的 js，中间 gwbNodeCli 与命令总线，右边调用方与子进程，
 * 下面是回执与超长输出写进的临时文件。
 */

import { Arrow, Box, StepCaption } from './parts'
import { StepControls, useSteps } from './steps'

type Part = 'owner' | 'entry' | 'bus' | 'nodeCli' | 'caller' | 'child' | 'receipt' | 'spill'

const STEPS: { title: string; detail: string; lit: Part[]; flows: string[] }[] = [
  { title: '全貌', detail: '登记方插件带着自己编译出的 js；gwbNodeCli 负责启动进程、时限、截断输出，并把登记的工具同时登记成命令总线上的命令。', lit: [], flows: [] },
  {
    title: '第 1 步：登记工具',
    detail: '插件调 ctx.gwbNodeCli.register({ name, entry, args?, cwd?, env?, timeoutMs? })。名字为空或带空白、entry 不是绝对路径、时限不合规，当场抛错。',
    lit: ['owner', 'entry', 'nodeCli'],
    flows: ['register'],
  },
  {
    title: '第 2 步：同时登记成总线命令',
    detail: '用同一个名字调 gwbCommands.register，plugin 缺省是调用方的包名，usage 缺省是参数说明。注销登记在调用方的 effect 上，卸载时两边一起注销。',
    lit: ['nodeCli', 'bus'],
    flows: ['mirror'],
  },
  {
    title: '第 3 步：调用',
    detail: '页面、agent、别的插件经 gwbCommands.run(name, args) 调它：args 给数组就是追加参数，给 { args?, cwd? } 也认。按次给的 cwd 不合规就不启动进程，回 { ok: false, error }。',
    lit: ['caller', 'bus', 'nodeCli'],
    flows: ['call', 'handler'],
  },
  {
    title: '第 4 步：启动子进程',
    detail: '程序是 process.execPath，加 ELECTRON_RUN_AS_NODE=1 以 node 模式运行；argv 是 [entry, ...固定参数, ...追加参数]，不经 shell。工作目录：按次给的 > 登记时给的 > entry 所在目录。',
    lit: ['nodeCli', 'child', 'entry'],
    flows: ['spawn'],
  },
  {
    title: '第 5 步：时限与输出',
    detail: '缺省 60 秒，到时限用 taskkill /T /F 结束整个进程树。stdout、stderr 只留尾部 64,000 字节，超出时全量写进系统临时目录的 gwb-cli-out-*.log、gwb-cli-err-*.log。',
    lit: ['child', 'spill'],
    flows: ['spill'],
  },
  {
    title: '第 6 步：回执',
    detail: '退出码 0 且没超时才算 ok。回执带 ok，命令总线原样返回；MCP 入口转给 agent 时只留 ok、exitCode、timedOut、durationMs、stdout、stderr 六项。',
    lit: ['receipt', 'bus', 'caller'],
    flows: ['receipt', 'back'],
  },
]

export function CliRun() {
  const state = useSteps(STEPS.length, 3600)
  const current = STEPS[state.step]!
  const lit = (part: Part) => (current.lit.includes(part) ? 'a' : undefined)
  const flowing = (name: string) => current.flows.includes(name)
  const tone = (name: string) => (flowing(name) ? 'a' : undefined)

  return (
    <>
      <svg viewBox="0 0 760 440" role="img" aria-label="node 命令行工具的登记、调用与回执">
        <Box x={10} y={110} w={180} h={52} lines={['登记方插件', 'register(spec)']} tone={lit('owner')} mono />
        <Box x={10} y={184} w={180} h={52} lines={['dist/cli.js', '随包发布的 js（entry）']} tone={lit('entry')} mono />

        <Box x={240} y={20} w={220} h={56} lines={['命令总线', '同名命令 mine.build']} tone={lit('bus')} mono />
        <Box x={240} y={110} w={220} h={126} lines={['gwbNodeCli', '登记表：名字 → spec', '参数与 cwd 检查', '启动 · 时限 · 截断输出']} tone={lit('nodeCli')} />

        <Box x={530} y={20} w={220} h={56} lines={['调用方', '页面 · agent · 别的插件']} tone={lit('caller')} />
        <Box x={530} y={130} w={220} h={86} lines={['子进程', 'electron.exe（node 模式）', 'argv: [entry, …参数]', '超时：taskkill /T /F']} tone={lit('child')} mono />

        <Box x={10} y={272} w={500} h={60} lines={['回执 CliRunResult', 'ok · exitCode · signal · timedOut · timeoutMs', 'stdout · stderr（尾部 + spillPath）· durationMs']} tone={lit('receipt')} mono />
        <Box x={530} y={272} w={220} h={60} lines={['系统临时目录', 'gwb-cli-out-*.log', 'gwb-cli-err-*.log']} tone={lit('spill')} mono />

        <Arrow from={[190, 136]} to={[240, 136]} label="register" tone={tone('register')} flow={flowing('register')} />
        <Arrow from={[350, 110]} to={[350, 76]} label="gwbCommands.register" tone={tone('mirror')} flow={flowing('mirror')} />
        {flowing('back') ? (
          <Arrow from={[460, 48]} to={[530, 48]} label="原样返回" tone="a" flow />
        ) : (
          <Arrow from={[530, 48]} to={[460, 48]} label="run" tone={tone('call')} flow={flowing('call')} />
        )}
        {flowing('handler') && <Arrow from={[300, 76]} to={[300, 110]} tone="a" flow />}
        <Arrow from={[460, 172]} to={[530, 172]} label="spawn" tone={tone('spawn')} flow={flowing('spawn')} />
        <Arrow from={[640, 216]} to={[640, 272]} tone={tone('spill')} flow={flowing('spill')} />
        <Arrow from={[350, 236]} to={[350, 272]} tone={tone('receipt')} flow={flowing('receipt')} />

        <StepCaption x={14} y={362} w={730} title={current.title} detail={current.detail} h={64} />
      </svg>
      <StepControls count={STEPS.length} state={state} />
    </>
  )
}

/**
 * python 命令行工具多出来的 venv 检查：左边登记方的包根（py 项目与 venv 里的几样东西），中间 gwbPyCli 与命令总线，
 * 右边调用方、uv 与 python 子进程，下面是这一步的回执。
 */

import { Arrow, Box, Frame, StepCaption } from './parts'
import { StepControls, useSteps } from './steps'

type Part = 'project' | 'venv' | 'site' | 'scripts' | 'bus' | 'pyCli' | 'caller' | 'uv' | 'python' | 'receipt'

const STEPS: { title: string; detail: string; lit: Part[]; flows: string[]; receipt: string; failed?: boolean }[] = [
  {
    title: '全貌',
    detail: '和 node 命令行工具是同一套运行办法，多出来的是 venv：每次运行前检查 venv 在不在、对不对，不对就用 uv 重建，再运行 venv 里的程序。',
    lit: [],
    flows: [],
    receipt: '回执',
  },
  {
    title: '第 1 步：登记工具',
    detail: '插件调 register({ name, packageRoot, distName, version, command 或 module })，同名登记成总线命令；顺带发起一次 venv 检查，不等它完成，不挡登记方的 apply。',
    lit: ['pyCli', 'bus', 'project'],
    flows: ['mirror'],
    receipt: '回执',
  },
  {
    title: '第 2 步：每次运行前检查 venv',
    detail: '三项都对就跳过、不启动任何进程：<包根>/py/.venv 在；.gwb-built-for 写的是这个包根；Lib/site-packages 下有 <distName>-<version>.dist-info。',
    lit: ['caller', 'bus', 'pyCli', 'venv', 'site'],
    flows: ['call', 'check'],
    receipt: '回执',
  },
  {
    title: '第 3 步：不对就用 uv 重建',
    detail: 'uv sync --frozen --no-dev --inexact --project <包根>/py；同一个包根同时只跑一次。成功后才写 .gwb-built-for，写完再检查一遍。',
    lit: ['pyCli', 'uv', 'venv', 'project'],
    flows: ['sync'],
    receipt: '回执',
  },
  {
    title: '第 4 步：建不起来时',
    detail: 'uv 不在 PATH、退出码不是 0、超过 300 秒，都收成 { ready: false, reason }。运行抛错，经命令总线调用时变成失败回执；插件本身照常加载。',
    lit: ['pyCli', 'receipt'],
    flows: [],
    receipt: '{ ok: false, error: \'Error: venv 没就绪,<名字> 跑不了：<原因>\' }',
    failed: true,
  },
  {
    title: '第 5 步：启动 python',
    detail: 'command 运行 Scripts/<command>.exe，module 运行 Scripts/python.exe -m <module>；加 PYTHONUTF8=1 与 PYTHONIOENCODING=utf-8，工作目录缺省是 <包根>/py。',
    lit: ['pyCli', 'python', 'scripts'],
    flows: ['spawn'],
    receipt: '回执',
  },
  {
    title: '第 6 步：回执',
    detail: '时限、输出截断、回执形状都和 node 命令行工具一样：ok、exitCode、signal、timedOut、timeoutMs、stdout、stderr、durationMs。',
    lit: ['receipt', 'bus', 'caller'],
    flows: ['back'],
    receipt: 'CliRunResult：ok · exitCode · stdout · stderr …',
  },
]

export function PyCliRun() {
  const state = useSteps(STEPS.length, 3600)
  const current = STEPS[state.step]!
  const lit = (part: Part) => (current.lit.includes(part) ? (current.failed && part === 'receipt' ? 'b' : 'a') : undefined)
  const flowing = (name: string) => current.flows.includes(name)
  const tone = (name: string) => (flowing(name) ? 'a' : undefined)

  return (
    <>
      <svg viewBox="0 0 760 430" role="img" aria-label="python 命令行工具的 venv 检查、重建与运行">
        <Frame x={10} y={10} w={240} h={290} label="登记方的包根" />
        <Box x={24} y={38} w={212} h={50} lines={['py/', 'pyproject.toml · uv.lock']} tone={lit('project')} mono />
        <Box x={24} y={100} w={212} h={50} lines={['py/.venv/', '.gwb-built-for（包根）']} tone={lit('venv')} mono />
        <Box x={24} y={162} w={212} h={50} lines={['.venv/Lib/site-packages/', '<名字>-<版本>.dist-info']} tone={lit('site')} mono />
        <Box x={24} y={224} w={212} h={60} lines={['.venv/Scripts/', '<command>.exe', 'python.exe']} tone={lit('scripts')} mono />

        <Box x={290} y={20} w={200} h={56} lines={['命令总线', '同名命令']} tone={lit('bus')} />
        <Box x={290} y={110} w={200} h={120} lines={['gwbPyCli', '登记表 · run', 'ensureReady', '检查并在需要时重建 venv']} tone={lit('pyCli')} mono />

        <Box x={540} y={20} w={210} h={56} lines={['调用方', '页面 · agent · 别的插件']} tone={lit('caller')} />
        <Box x={540} y={110} w={210} h={56} lines={['uv（从 PATH 找）', 'uv sync --frozen …']} tone={lit('uv')} mono />
        <Box x={540} y={184} w={210} h={56} lines={['python 子进程', 'PYTHONUTF8=1']} tone={lit('python')} mono />

        <Box x={290} y={262} w={460} h={38} lines={[current.receipt]} tone={lit('receipt')} mono dashed={current.receipt === '回执'} />

        <Arrow from={[390, 110]} to={[390, 76]} tone={tone('mirror')} flow={flowing('mirror')} />
        {flowing('back') ? (
          <Arrow from={[490, 48]} to={[540, 48]} tone="a" flow />
        ) : (
          <Arrow from={[540, 48]} to={[490, 48]} tone={tone('call')} flow={flowing('call')} />
        )}
        <Arrow from={[290, 140]} to={[236, 125]} label="读文件" tone={tone('check')} dashed={!flowing('check')} />
        <Arrow from={[290, 190]} to={[236, 187]} tone={tone('check')} dashed={!flowing('check')} />
        <Arrow from={[490, 138]} to={[540, 138]} tone={tone('sync')} flow={flowing('sync')} />
        <Arrow from={[490, 206]} to={[540, 210]} tone={tone('spawn')} flow={flowing('spawn')} />
        <Arrow from={[390, 230]} to={[390, 262]} tone={current.lit.includes('receipt') ? (current.failed ? 'b' : 'a') : undefined} />

        <StepCaption x={14} y={330} w={730} title={current.title} detail={current.detail} h={64} />
      </svg>
      <StepControls count={STEPS.length} state={state} />
    </>
  )
}

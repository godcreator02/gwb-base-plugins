'use client'

/**
 * 数据归属：一个插件的包名从 @old/gwb-foo 改成 @new/gwb-foo，条目 id 仍是 foo。
 * 左边两个包名与插件管理，中间数据插件与设置插件，右边两处归属记录，最下面是这一步的结果。
 */

import { Arrow, Box, StepCaption } from './parts'
import { StepControls, useSteps } from './steps'

type Part = 'old' | 'renamed' | 'manager' | 'data' | 'settings' | 'ownerFile' | 'ownerTable'

const STEPS: { title: string; detail: string; lit: Part[]; owner: string | undefined; outcome: string; refused?: boolean; flows: string[] }[] = [
  {
    title: '全貌',
    detail: '数据目录名与设置分区名都是条目 id 的末段，条目删掉后数据和设置还留着。所以两处都记下归哪个包：数据目录里的 .owner.json、settings.json 顶层的 $owners。',
    lit: [],
    owner: undefined,
    outcome: '',
    flows: [],
  },
  {
    title: '第 1 步：第一次使用时记下归属',
    detail: '@old/gwb-foo 的条目 home:foo 第一次取数据目录、第一次 define 设置时，两处还没有记录，记成调用方的包名。',
    lit: ['old', 'data', 'settings', 'ownerFile', 'ownerTable'],
    owner: '@old/gwb-foo',
    outcome: '记下归属：foo → @old/gwb-foo',
    flows: ['old'],
  },
  {
    title: '第 2 步：包名对不上就拒绝',
    detail: '同一个插件改名成 @new/gwb-foo，条目 id 还是 foo。两个插件都抛错、不动任何数据，报错写明归属于谁，指向 plugin-manager.transfer-owner。',
    lit: ['renamed', 'data', 'settings'],
    owner: '@old/gwb-foo',
    outcome: '拒绝：foo 归 @old/gwb-foo，@new/gwb-foo 用不了',
    refused: true,
    flows: ['renamed'],
  },
  {
    title: '第 3 步：插件管理转移归属',
    detail: '确认是同一个插件改了包名后，plugin-manager.transfer-owner 调两个服务的 transferOwner(\'foo\', \'@new/gwb-foo\')，立刻写入磁盘；没装的那边跳过。',
    lit: ['manager', 'data', 'settings', 'ownerFile', 'ownerTable'],
    owner: '@new/gwb-foo',
    outcome: 'transferOwner：foo → @new/gwb-foo',
    flows: ['manager'],
  },
  {
    title: '第 4 步：新包名放行，旧包名被拒',
    detail: '之后 @new/gwb-foo 照常读写；@old/gwb-foo 再来就被拒。owners() 列出 foo → @new/gwb-foo，插件管理分配新条目 id 时据此避开。',
    lit: ['renamed', 'data', 'settings'],
    owner: '@new/gwb-foo',
    outcome: '放行：@new/gwb-foo 读写 foo 的数据与设置',
    flows: ['renamed'],
  },
]

export function OwnerTransfer() {
  const state = useSteps(STEPS.length, 3600)
  const current = STEPS[state.step]!
  const lit = (part: Part) => (current.lit.includes(part) ? 'a' : undefined)
  const flowing = (name: string) => current.flows.includes(name)
  const outcomeTone = current.outcome === '' ? undefined : current.refused ? 'b' : 'a'

  return (
    <>
      <svg viewBox="0 0 760 400" role="img" aria-label="数据目录与设置分区的归属记录与转移">
        <Box x={10} y={20} w={200} h={52} lines={['@old/gwb-foo', '条目 home:foo']} tone={lit('old')} mono dim={state.step >= 2 && !current.lit.includes('old')} />
        <Box x={10} y={96} w={200} h={52} lines={['@new/gwb-foo', '改名后，条目仍是 home:foo']} tone={lit('renamed')} mono dim={state.step < 2} dashed={state.step < 2} />
        <Box x={10} y={172} w={200} h={52} lines={['插件管理（devkit 仓）', 'plugin-manager.transfer-owner']} tone={lit('manager')} mono />

        <Box x={270} y={34} w={200} h={64} lines={['数据插件 gwbData', 'owners() · transferOwner()']} tone={lit('data')} mono />
        <Box x={270} y={134} w={200} h={64} lines={['设置插件 gwbSettings', 'owners() · transferOwner()']} tone={lit('settings')} mono />

        <Box x={530} y={34} w={220} h={64} lines={['data/foo/.owner.json', current.owner === undefined ? '（还没有这个文件）' : `{ "pkg": "${current.owner}" }`]} tone={lit('ownerFile')} mono dashed={current.owner === undefined} />
        <Box x={530} y={134} w={220} h={64} lines={['settings.json 的 $owners', current.owner === undefined ? '（还没有 foo 这一项）' : `"foo": "${current.owner}"`]} tone={lit('ownerTable')} mono dashed={current.owner === undefined} />

        <Arrow from={[210, 46]} to={[270, 60]} tone={flowing('old') ? 'a' : undefined} flow={flowing('old')} />
        <Arrow from={[210, 122]} to={[270, 80]} tone={flowing('renamed') ? (current.refused ? 'b' : 'a') : undefined} flow={flowing('renamed')} />
        <Arrow from={[210, 128]} to={[270, 160]} tone={flowing('renamed') ? (current.refused ? 'b' : 'a') : undefined} flow={flowing('renamed')} />
        <Arrow from={[210, 198]} to={[270, 180]} tone={flowing('manager') ? 'a' : undefined} flow={flowing('manager')} />
        {flowing('manager') && <Arrow from={[210, 186]} to={[270, 94]} tone="a" flow />}
        <Arrow from={[470, 66]} to={[530, 66]} tone={lit('ownerFile')} />
        <Arrow from={[470, 166]} to={[530, 166]} tone={lit('ownerTable')} />

        <Box x={270} y={232} w={480} h={44} lines={[current.outcome === '' ? '这一步的结果' : current.outcome]} tone={outcomeTone} dashed={current.outcome === ''} />

        <StepCaption x={14} y={310} w={730} title={current.title} detail={current.detail} h={60} />
      </svg>
      <StepControls count={STEPS.length} state={state} />
    </>
  )
}

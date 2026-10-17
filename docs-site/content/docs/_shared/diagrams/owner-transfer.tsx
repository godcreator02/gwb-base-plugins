/**
 * 数据归属：一个插件的包名从 @old/gwb-foo 改成 @new/gwb-foo，条目 id 仍是 foo。
 * 左边两个包名与手工处理的人，中间数据插件与设置插件，右边两处归属记录，最下面是这一步的结果。
 */

import { Arrow, Box, StepCaption } from './parts'
import { StepControls, useSteps } from './steps'

type Part = 'old' | 'renamed' | 'person' | 'data' | 'settings' | 'ownerFile' | 'ownerTable'

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
    detail: '同一个插件改名成 @new/gwb-foo，条目 id 还是 foo。两个插件都抛错、不动任何数据，报错写明归属于谁、磁盘上哪个目录或文件要手工处理。',
    lit: ['renamed', 'data', 'settings'],
    owner: '@old/gwb-foo',
    outcome: '拒绝：foo 归 @old/gwb-foo，不能给 @new/gwb-foo 用',
    refused: true,
    flows: ['renamed'],
  },
  {
    title: '第 3 步：人改归属记录',
    detail: '确认是同一个插件后，卸掉旧包，调插件管理的 plugin-manager.transfer-owner 把两处都改成 @new/gwb-foo，它经两个插件的 transferOwner 改、不用关工作台；也可以手工改 data/foo/.owner.json 的 pkg，关掉工作台再改 settings.json 里 $owners 的 foo。不是同一个插件时改名或删掉旧的目录与分区。',
    lit: ['person', 'ownerFile', 'ownerTable'],
    owner: '@new/gwb-foo',
    outcome: '改归属：foo → @new/gwb-foo',
    flows: [],
  },
  {
    title: '第 4 步：新包名放行，旧包名被拒',
    detail: '之后 @new/gwb-foo 照常读写；@old/gwb-foo 再来就被拒。',
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
      <svg viewBox="0 0 760 400" role="img" aria-label="数据目录与设置分区的归属记录与手工处理">
        <Box x={10} y={20} w={200} h={52} lines={['@old/gwb-foo', '条目 home:foo']} tone={lit('old')} mono dim={state.step >= 2 && !current.lit.includes('old')} />
        <Box x={10} y={96} w={200} h={52} lines={['@new/gwb-foo', '改名后，条目仍是 home:foo']} tone={lit('renamed')} mono dim={state.step < 2} dashed={state.step < 2} />
        <Box x={10} y={172} w={200} h={52} lines={['人', '照报错手工改归属记录']} tone={lit('person')} />

        <Box x={270} y={34} w={200} h={64} lines={['数据插件 gwbData', '每次访问核对 .owner.json']} tone={lit('data')} mono />
        <Box x={270} y={134} w={200} h={64} lines={['设置插件 gwbSettings', 'define 时核对 $owners']} tone={lit('settings')} mono />

        <Box x={530} y={34} w={220} h={64} lines={['data/foo/.owner.json', current.owner === undefined ? '（还没有这个文件）' : `{ "pkg": "${current.owner}" }`]} tone={lit('ownerFile')} mono dashed={current.owner === undefined} />
        <Box x={530} y={134} w={220} h={64} lines={['settings.json 的 $owners', current.owner === undefined ? '（还没有 foo 这一项）' : `"foo": "${current.owner}"`]} tone={lit('ownerTable')} mono dashed={current.owner === undefined} />

        <Arrow from={[210, 46]} to={[270, 60]} tone={flowing('old') ? 'a' : undefined} flow={flowing('old')} />
        <Arrow from={[210, 122]} to={[270, 80]} tone={flowing('renamed') ? (current.refused ? 'b' : 'a') : undefined} flow={flowing('renamed')} />
        <Arrow from={[210, 128]} to={[270, 160]} tone={flowing('renamed') ? (current.refused ? 'b' : 'a') : undefined} flow={flowing('renamed')} />
        <Arrow from={[470, 66]} to={[530, 66]} tone={lit('data') && lit('ownerFile')} />
        <Arrow from={[470, 166]} to={[530, 166]} tone={lit('settings') && lit('ownerTable')} />

        <Box x={270} y={232} w={480} h={44} lines={[current.outcome === '' ? '这一步的结果' : current.outcome]} tone={outcomeTone} dashed={current.outcome === ''} />

        <StepCaption x={14} y={310} w={730} title={current.title} detail={current.detail} h={60} />
      </svg>
      <StepControls count={STEPS.length} state={state} />
    </>
  )
}

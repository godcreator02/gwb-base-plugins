/**
 * 数据目录按条目分：左边同一个包在 cordis.yml 里的两条条目，中间数据插件的服务，右边 <home>/data/ 下两个目录各自的文件。
 * 下面一行是 writeDoc 的原子写入与 readDoc 读不到时的结果。
 */

import { Arrow, Box, Frame, Note } from './parts'

export function DataLayout() {
  return (
    <svg viewBox="0 0 760 380" role="img" aria-label="数据插件按条目 id 给每条条目一个数据目录">
      <Box x={10} y={34} w={200} h={60} lines={['条目 home:notes', '@scope/gwb-notes']} tone="a" mono />
      <Box x={10} y={150} w={200} h={60} lines={['条目 home:notes-work', '同一个包的第二条条目']} tone="b" mono />

      <Frame x={240} y={10} w={200} h={220} label="数据插件 gwbData" />
      <Box x={254} y={38} w={172} h={176} lines={['dir · readDoc(doc)', 'writeDoc(doc, value)', '', '从调用方条目算出目录', '先核对归属', '再读写']} mono />

      <Frame x={470} y={10} w={280} h={220} label="<home>/data/" />
      <Box x={484} y={38} w={252} h={82} lines={['notes/', '.owner.json（记着包名）', 'layout.json', '…插件自己放的文件']} tone="a" mono />
      <Box x={484} y={134} w={252} h={82} lines={['notes-work/', '.owner.json', '<文档名>.json']} tone="b" mono />

      <Arrow from={[210, 64]} to={[254, 82]} />
      <Arrow from={[210, 180]} to={[254, 170]} />
      <Arrow from={[426, 90]} to={[484, 80]} tone="a" />
      <Arrow from={[426, 160]} to={[484, 172]} tone="b" />

      <Box x={10} y={256} w={360} h={56} lines={['writeDoc：整份替换', '先写同目录的临时文件，再改名覆盖；失败时删掉临时文件']} />
      <Box x={390} y={256} w={360} h={56} lines={['readDoc：没有这份或解析不了', '都回 undefined，解析不了时另写一条 warn']} />

      <Note x={10} y={340}>
        目录名是条目 id 的末段，按条目分、不按包名分：同一个包的两条条目各用各的目录。插件报不出别人的条目，读写不到别人的目录。
      </Note>
    </svg>
  )
}

/**
 * 调用方身份从哪来：左边 cordis.yml 里的一条条目，中间 loader 放在调用方 fiber 上的 entry，
 * 右边五个插件各取哪一样、算出什么名字。
 */

import { Arrow, Box, Frame, Note } from './parts'

export function EntryIdentity() {
  return (
    <svg viewBox="0 0 760 350" role="img" aria-label="条目 id 与包名从 cordis.yml 经 loader 到五个插件">
      <Frame x={10} y={10} w={200} h={130} label="cordis.yml（home 这一层）" />
      <Box x={24} y={40} w={172} h={84} lines={['一条条目', 'id: hello', 'name: @scope/gwb-hello']} mono />

      <Frame x={236} y={10} w={240} h={130} label="调用方的 ctx.fiber.entry" />
      <Box x={250} y={40} w={212} h={36} lines={["id: 'home:hello'"]} tone="a" mono />
      <Box x={250} y={86} w={212} h={36} lines={["options.name: '@scope/gwb-hello'"]} tone="b" mono />

      <Arrow from={[196, 82]} to={[250, 82]} label="loader" />

      <Box x={500} y={10} w={250} h={60} lines={['数据插件 entryDirName', '<home>/data/hello/']} tone="a" mono />
      <Box x={500} y={82} w={250} h={60} lines={['设置插件 entrySection', 'settings.json 的分区 hello']} tone="a" mono />
      <Box x={500} y={170} w={250} h={76} lines={['说明书、node / python 命令行工具', '只取包名', '写进说明书与命令的 plugin']} tone="b" />

      <Arrow from={[462, 58]} to={[500, 40]} tone="a" />
      <Arrow from={[462, 58]} to={[500, 112]} tone="a" />
      <Arrow from={[462, 104]} to={[500, 196]} tone="b" />
      <Arrow from={[462, 110]} to={[500, 60]} tone="b" dashed />
      <Arrow from={[462, 114]} to={[500, 130]} tone="b" dashed />

      <Box x={10} y={170} w={466} h={76} lines={['条目 id → 目录名 / 分区名', '只取末段：home:hello 得 hello', '超过两段、有段不是 kebab-case 就抛错；两个插件各写一份，靠约定一致']} />

      <Note x={10} y={284}>
        数据插件与设置插件还取包名记归属（虚线）。条目没手写 id 时 loader 给 8 位十六进制的随机 id，每次启动都变。
      </Note>
      <Note x={10} y={306}>
        身份一律从调用方的 fiber 上取，不接受调用方传进来的名字；取不到（不是经 cordis.yml 加载的插件在调用）就抛错。
      </Note>
    </svg>
  )
}

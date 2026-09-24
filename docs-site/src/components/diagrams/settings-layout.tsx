/**
 * 设置存在哪、谁读写哪一块：左边三类调用方，中间设置插件的两种入口（服务按调用方条目定分区、命令按位置），
 * 右边是 settings.json 的顶层：$owners、各条目的分区、公共区 *。
 */

import { Arrow, Box, Frame, Note } from './parts'

export function SettingsLayout() {
  return (
    <svg viewBox="0 0 760 360" role="img" aria-label="settings.json 按条目分区，服务与命令各读写哪一块">
      <Box x={10} y={24} w={210} h={60} lines={['插件（条目 home:mcp）', 'define · get · set · delete(key)']} tone="a" mono />
      <Box x={10} y={120} w={210} h={60} lines={['别的插件', 'get(key)，自己没声明这一项']} tone="a" />
      <Box x={10} y={216} w={210} h={60} lines={['页面、agent', 'settings.* 四条命令']} />

      <Frame x={250} y={10} w={190} h={280} label="设置插件 gwbSettings" />
      <Box x={264} y={38} w={162} h={128} lines={['服务 ctx.gwbSettings', '只给 key', '分区由调用方条目定', '没声明的 key 读公共区']} tone="a" />
      <Box x={264} y={186} w={162} h={90} lines={['四条命令', '给 { section, key }', '不认调用方身份']} />

      <Frame x={470} y={10} w={280} h={280} label="<home>/settings.json" />
      <Box x={484} y={38} w={252} h={48} lines={['$owners', '分区名 → 包名']} tone="b" mono />
      <Box x={484} y={96} w={252} h={48} lines={['mcp', 'port: { title, type, value, … }']} tone="a" mono />
      <Box x={484} y={154} w={252} h={48} lines={['<别的条目 id 末段>', '各插件自己声明的项']} mono />
      <Box x={484} y={212} w={252} h={64} lines={['*（公共区）', 'shared: true 的项', '别的插件不用声明也读得到']} tone="a" mono />

      <Arrow from={[220, 54]} to={[264, 72]} />
      <Arrow from={[220, 150]} to={[264, 140]} />
      <Arrow from={[220, 246]} to={[264, 231]} />
      <Arrow from={[426, 90]} to={[484, 118]} tone="a" />
      <Arrow from={[426, 140]} to={[484, 236]} tone="a" />
      <Arrow from={[426, 231]} to={[484, 178]} dashed />

      <Note x={10} y={316}>
        settings.all 里 secret 项只给 isSet 与定长掩码 ••••，不给值；settings.get 与服务的 get 回明文。
      </Note>
      <Note x={10} y={338}>
        分区名是调用方条目 id 的末段（home:mcp 得 mcp）；第一次 define 时在 $owners 记下归哪个包，包名对不上就抛错。
      </Note>
    </svg>
  )
}

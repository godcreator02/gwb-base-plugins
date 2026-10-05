/**
 * 设置存在哪、谁读写哪一块：左边三类调用方，中间设置插件的两种入口（服务按调用方条目定分区、命令按位置），
 * 右边是当前 home 的两份文件：普通设置与元信息、明文凭据。两者使用相同的分区与键。
 */

import { Arrow, Box, Frame, Note } from './parts'

export function SettingsLayout() {
  return (
    <svg viewBox="0 0 760 390" role="img" aria-label="每个 home 独立保存普通设置与明文凭据，插件内部取用，AI 只收状态">
      <Box x={10} y={24} w={210} h={60} lines={['插件（条目 home:mcp）', 'define · get · set · delete(key)']} tone="a" mono />
      <Box x={10} y={120} w={210} h={60} lines={['别的插件', 'get(key)，自己没声明这一项']} tone="a" />
      <Box x={10} y={216} w={210} h={60} lines={['页面、agent', 'settings.* / credentials.*']} />

      <Frame x={250} y={10} w={190} h={280} label="设置插件 gwbSettings" />
      <Box x={264} y={38} w={162} h={128} lines={['服务 ctx.gwbSettings', '只给 key', '分区由调用方条目定', '没声明的 key 读公共区']} tone="a" />
      <Box x={264} y={186} w={162} h={90} lines={['按对象选命令', '按 section / key 管理', '凭据只返回状态']} />

      <Frame x={470} y={10} w={280} h={158} label="<home>/settings.json" />
      <Box x={484} y={38} w={252} h={48} lines={['$owners · 设置声明', '分区归属、标题、类型、说明']} tone="b" />
      <Box x={484} y={96} w={252} h={56} lines={['普通值按分区保存', 'mcp.port · * 公共区']} tone="a" />
      <Frame x={470} y={186} w={280} h={104} label="<home>/credentials.json" />
      <Box x={484} y={214} w={252} h={60} lines={['secret 明文值', '相同的分区与键 · 删除记录']} tone="b" />

      <Arrow from={[220, 54]} to={[264, 72]} />
      <Arrow from={[220, 150]} to={[264, 140]} />
      <Arrow from={[220, 246]} to={[264, 231]} />
      <Arrow from={[426, 90]} to={[484, 118]} tone="a" />
      <Arrow from={[426, 140]} to={[484, 238]} tone="a" />
      <Arrow from={[426, 231]} to={[484, 254]} dashed />

      <Note x={10} y={316}>
        settings.get 只读普通设置；凭据查 credentials.status；插件服务 get 仍可取明文。
      </Note>
      <Note x={10} y={338}>
        每个 home 独立保管；显式复制只读来源、只写当前 home，复制后的值不自动同步。
      </Note>
      <Note x={10} y={360}>文件不加密；避免凭据进入日常 AI 回执，不是本机程序的隔离边界。</Note>
    </svg>
  )
}

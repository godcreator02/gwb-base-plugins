/**
 * 接缝图：虚线框是本仓，框里是九个插件；插件与插件、插件与仓外模块之间的连线是接缝，编号与入口页的接缝表一一对应。
 * 实线接缝有代码接口，点线接缝只靠约定。各插件都经接缝 1 登记命令，图上只画命令总线到仓外插件那一条。
 */
import { BG, Box, FG, MONO, MUTED, Note } from './parts'

const SEAM = 'var(--diagram-b)'

function Package({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return <rect x={x} y={y} width={w} height={h} rx={10} fill="none" stroke={MUTED} strokeWidth={1} strokeDasharray="5 4" />
}

function PackageLabel({ x, y, name, path, anchor = 'start' }: { x: number; y: number; name: string; path?: string; anchor?: 'start' | 'middle' | 'end' }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={12.5} fontWeight={600} fill={FG}>
      {name}
      {path !== undefined && (
        <tspan dx={6} fontSize={11} fontWeight={400} fill={MUTED} fontFamily={MONO}>
          {path}
        </tspan>
      )}
    </text>
  )
}

function SeamLine({ d, byConvention }: { d: string; byConvention?: boolean }) {
  return <path d={d} fill="none" stroke={byConvention ? MUTED : SEAM} strokeWidth={1.4} strokeDasharray={byConvention ? '2 3' : undefined} />
}

function Badge({ x, y, n, byConvention }: { x: number; y: number; n: number; byConvention?: boolean }) {
  const color = byConvention ? MUTED : SEAM
  return (
    <g>
      <circle cx={x} cy={y} r={9} fill={BG} stroke={color} strokeWidth={1.2} strokeDasharray={byConvention ? '2 2' : undefined} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={10.5} fontWeight={600} fill={color}>
        {n}
      </text>
    </g>
  )
}

export function SeamMap() {
  return (
    <svg viewBox="0 0 760 570" role="img" aria-label="基础插件仓的九个插件与十一条接缝">
      <Package x={20} y={90} w={520} h={320} />
      <PackageLabel x={528} y={108} name="基础插件仓" path="gwb-base-plugins" anchor="end" />

      <SeamLine d="M520,152 H580" />
      <SeamLine d="M95,60 V130" />
      <SeamLine d="M115,174 V187 H445 V174" />
      <SeamLine d="M520,222 H580" />
      <SeamLine d="M520,292 H580" />
      <SeamLine d="M520,362 H580" />
      <SeamLine d="M520,376 H560 V492 H580" />
      <SeamLine d="M445,384 V470" byConvention />
      <SeamLine d="M280,314 V470" />
      <SeamLine d="M280,130 V60" />
      <SeamLine d="M115,384 V470" byConvention />

      <Box x={20} y={20} w={150} h={40} lines={['MCP 客户端', 'agent']} />
      <Box x={230} y={20} w={220} h={40} lines={['内核', '转交页面的命令 · 日志流']} />

      <Box x={40} y={130} w={150} h={44} lines={['MCP 入口', 'gwb-mcp']} tone="a" />
      <Box x={205} y={130} w={150} h={44} lines={['日志', 'gwb-logger']} tone="a" />
      <Box x={370} y={130} w={150} h={44} lines={['命令总线', 'gwb-commands']} tone="a" />
      <Box x={205} y={200} w={150} h={44} lines={['node 命令行工具', 'gwb-node-cli']} tone="a" />
      <Box x={370} y={200} w={150} h={44} lines={['说明书', 'gwb-skills']} tone="a" />
      <Box x={205} y={270} w={150} h={44} lines={['python 命令行工具', 'gwb-py-cli']} tone="a" />
      <Box x={370} y={270} w={150} h={44} lines={['设置', 'gwb-settings']} tone="a" />
      <Box x={40} y={340} w={150} h={44} lines={['插件来源', 'gwb-plugin-sources']} tone="a" />
      <Box x={370} y={340} w={150} h={44} lines={['数据', 'gwb-data']} tone="a" />

      <Box x={580} y={130} w={160} h={254} lines={['别的插件', '外壳 · 插件管理 · 应用插件 …']} />

      <Box x={40} y={470} w={150} h={44} lines={['包源', '.npmrc · registry']} />
      <Box x={205} y={470} w={150} h={44} lines={['子进程', 'Electron 的 node · uv']} />
      <Box x={370} y={470} w={150} h={44} lines={['cordis loader', '条目 id']} />
      <Box x={580} y={470} w={160} h={44} lines={['插件管理', 'devkit 仓']} />

      <Badge x={550} y={152} n={1} />
      <Badge x={95} y={100} n={2} />
      <Badge x={280} y={187} n={3} />
      <Badge x={550} y={222} n={4} />
      <Badge x={550} y={292} n={5} />
      <Badge x={550} y={362} n={6} />
      <Badge x={560} y={440} n={7} />
      <Badge x={445} y={440} n={8} byConvention />
      <Badge x={280} y={440} n={9} />
      <Badge x={280} y={95} n={10} />
      <Badge x={115} y={440} n={11} byConvention />

      <Note x={20} y={552}>虚线框是本仓；实线接缝有代码接口，点线接缝只靠约定；各插件都经接缝 1 登记命令，图上只画命令总线到别的插件那一条</Note>
    </svg>
  )
}

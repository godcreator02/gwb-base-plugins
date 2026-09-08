/**
 * 三格的假数据，外加每个字段的**出处**。
 *
 * 这份是设计图里最该被审的一个文件：它把「界面要什么」摊平了，于是「后端此刻给不出
 * 什么」一眼可见。每个类型的头注里都标了三种出处之一：
 *
 * - **有** —— 此刻真调得到，命令名写在注释里
 * - **拼** —— 几条现有的命令拼得出来，但没人拼过
 * - **缺** —— 没有任何口子，得新开（新开在哪一层，见各处注释与本次会话的结论）
 */

// ────────────────────────────── settings 那一格 ──────────────────────────────

/**
 * 一条设置项。**有**：`settings.all` 回的就是这个形状（`SettingView`，见
 * `plugins/settings/src/registry.ts`）。写回走 `settings.set`，按位置定位
 * （`{ scope, section, key, value }`）——界面不是一个件、没有身份可绑。
 */
export interface SettingRow {
  scope: 'home' | 'machine'
  /** 盘上的分区：home 级是 entryId，machine 级是包名 */
  section: string
  key: string
  title?: string
  type?: 'string' | 'number' | 'boolean' | 'secret'
  description?: string
  value?: unknown
  /** 此刻有件声明着它吗。件停了盘上那份还在，但这里是 false */
  live: boolean
}

/**
 * 一条插件横条。**这个形状此刻拼不出来**，四个来源缺三个：
 *
 * | 字段 | 出处 |
 * | --- | --- |
 * | `entryId` / `pkg` / `enabled` / `state` / `error` | **缺**——条目树在 node 侧是 `ctx.loader`，没人开成命令 |
 * | `title` / `icon` | **拼**——shell 的 `plugin-registry` 有，但只收**主动报过名**的件，而且没开成命令 |
 * | `version` | **缺**——条目上没有，得读包的 package.json |
 * | `settings` | **有**——`settings.all` 按 `section` 筛 |
 *
 * 结论：外层这张表要一个新件（拿 `ctx.loader` 开「列条目 / 开关条目」两条命令），
 * 卸载那条另算（见 `removable`）。
 */
export interface PluginRow {
  entryId: string
  pkg: string
  title: string
  /** lucide 的图标名（kebab-case），件报名字时给的 */
  icon: string
  version: string
  enabled: boolean
  /** cordis fiber 此刻的样子。`failed` 带 `error` */
  state: 'active' | 'stopped' | 'failed'
  error?: string
  /**
   * 关得掉吗。**关不掉的不是「禁止」而是「关了就没有界面了」**：外壳占整页，
   * 命令总线是界面通往 node 侧的唯一一条路——关掉这两个之一，这一格自己就没了。
   * 所以开关直接禁用并说明，不做成「点了再拦」。
   */
  lockable?: string
  /**
   * 卸得掉吗。**缺**得最狠的一条：内核的 `gwbKernel` 只有 `install(specs)`，
   * 没有 remove；而内核 CLAUDE.md 明写「装过了就不再动它」。要真删包，
   * 得先推翻那一条。这一版设计图先把入口画出来，后端另开单。
   */
  removable?: boolean
  settings: SettingRow[]
}

/**
 * 无主的设置：盘上有值，此刻却没有件声明它（`live: false`）。件卸了设置还在，
 * 是真会发生的常态——不给它一个落点的话，这些值就永远看不见也删不掉。
 */
export const ORPHAN_SECTION = '__orphan__'

export const PLUGINS: PluginRow[] = [
  {
    entryId: 'shell',
    pkg: '@godcreator02/gwb-shell',
    title: '外壳',
    icon: 'layout-dashboard',
    version: '0.0.5',
    enabled: true,
    state: 'active',
    lockable: '关掉它整页就没了——这一格自己也住在它的井里',
    settings: [],
  },
  {
    entryId: 'commands',
    pkg: '@godcreator02/gwb-commands',
    title: '命令总线',
    icon: 'terminal',
    version: '0.0.1',
    enabled: true,
    state: 'active',
    lockable: '界面通往 node 侧只有这一条路，关掉之后连开关它自己都调不动',
    settings: [],
  },
  {
    entryId: 'settings',
    pkg: '@godcreator02/gwb-settings',
    title: '设置',
    icon: 'settings',
    version: '0.0.1',
    enabled: true,
    state: 'active',
    settings: [
      {
        scope: 'machine',
        section: '@godcreator02/gwb-settings',
        key: 'confirm-uninstall',
        title: '卸载前二次确认',
        type: 'boolean',
        description: '关掉之后「⋯ → 卸载」不再弹确认框',
        value: true,
        live: true,
      },
    ],
  },
  {
    entryId: 'logger',
    pkg: '@godcreator02/gwb-logger',
    title: '日志',
    icon: 'scroll-text',
    version: '0.0.2',
    enabled: true,
    state: 'active',
    settings: [
      {
        scope: 'home',
        section: 'logger',
        key: 'max-lines',
        title: '一格最多挂多少行',
        type: 'number',
        description: '渲染成本定的，不是缓冲大小。更早的去日志文件翻',
        value: 2000,
        live: true,
      },
      {
        scope: 'home',
        section: 'logger',
        key: 'default-level',
        title: '打开时的级别',
        type: 'string',
        description: 'debug / info / warn / error',
        value: 'debug',
        live: true,
      },
      {
        scope: 'machine',
        section: '@godcreator02/gwb-logger',
        key: 'wrap-long-lines',
        title: '长行折行',
        type: 'boolean',
        value: false,
        live: true,
      },
    ],
  },
  {
    entryId: 'mcp',
    pkg: '@godcreator02/gwb-mcp',
    title: 'MCP 桥',
    icon: 'plug',
    version: '0.0.2',
    enabled: true,
    state: 'active',
    settings: [
      {
        scope: 'machine',
        section: '@godcreator02/gwb-mcp',
        key: 'port',
        title: '首选端口',
        type: 'number',
        description: '被占（多 home 同时开的常态）就退让到系统分配的那个',
        value: 2870,
        live: true,
      },
    ],
  },
  {
    entryId: 'skills',
    pkg: '@godcreator02/gwb-skills',
    title: 'Skill',
    icon: 'book-open',
    version: '0.0.1',
    enabled: true,
    state: 'active',
    settings: [],
  },
  {
    entryId: 'data',
    pkg: '@godcreator02/gwb-data',
    title: '数据',
    icon: 'database',
    version: '0.0.2',
    enabled: true,
    state: 'active',
    settings: [],
  },
  {
    entryId: 'hello',
    pkg: '@godcreator02/gwb-hello',
    title: '示例件',
    icon: 'sparkles',
    version: '0.0.3',
    enabled: true,
    state: 'active',
    removable: true,
    settings: [
      {
        scope: 'home',
        section: 'hello',
        key: 'greeting',
        title: '打招呼说什么',
        type: 'string',
        description: '空着就用包名',
        value: '早',
        live: true,
      },
      {
        scope: 'home',
        section: 'hello',
        key: 'times',
        title: '说几遍',
        type: 'number',
        value: 1,
        live: true,
      },
      {
        scope: 'home',
        section: 'hello',
        key: 'loud',
        title: '大声',
        type: 'boolean',
        description: '全大写，末尾加感叹号',
        value: false,
        live: true,
      },
      {
        scope: 'machine',
        section: '@godcreator02/gwb-hello',
        key: 'api-key',
        title: '外部接口凭据',
        type: 'secret',
        description: 'secret 只影响显示打码，盘上照样明文——这一条界面上得说出来',
        value: 'sk-demo-3f9a2c81b4e7',
        live: true,
      },
    ],
  },
  {
    entryId: 'py-cli',
    pkg: '@godcreator02/gwb-py-cli',
    title: 'Python 命令',
    icon: 'file-code',
    version: '0.0.2',
    enabled: false,
    state: 'stopped',
    removable: true,
    settings: [
      {
        scope: 'machine',
        section: '@godcreator02/gwb-py-cli',
        key: 'python-path',
        title: 'python 可执行文件',
        type: 'string',
        description: '空着就用 venv 里那个',
        value: '',
        live: true,
      },
    ],
  },
  {
    entryId: 'node-cli',
    pkg: '@godcreator02/gwb-node-cli',
    title: 'Node 命令',
    icon: 'file-code-2',
    version: '0.0.2',
    enabled: true,
    state: 'failed',
    error: '挂载时抛错：Cannot find module \'@godcreator02/gwb-commands\'（它没装进这个 home）',
    removable: true,
    settings: [],
  },
]

/** 无主的那几项。盘上有值、没件声明——`settings.all` 照回，`live` 是 false */
export const ORPHANS: SettingRow[] = [
  {
    scope: 'home',
    section: 'weather',
    key: 'city',
    title: '城市',
    type: 'string',
    description: '声明它的件已经不在了',
    value: '杭州',
    live: false,
  },
  {
    scope: 'machine',
    section: '@godcreator02/gwb-translate',
    key: 'api-key',
    title: '接口凭据',
    type: 'secret',
    value: 'tr-old-9c2f',
    live: false,
  },
]

// ──────────────────────────────── mcp 那一格 ────────────────────────────────

/**
 * 连接串。**有**：`mcp.info` 回的就是 `{ url, port, token }`；取不到令牌时
 * 回 `{ ok: false, error }`，那条错**带真原因**（问它的人本来就在本机）。
 */
export interface McpInfo {
  ok: boolean
  url: string
  port: number
  token: string
  /** 首选端口。被占之后 `port` 是退让来的另一个，界面得说清 */
  wantPort: number
  error?: string
}

export const MCP_INFO: McpInfo = {
  ok: true,
  url: 'http://127.0.0.1:2871/mcp',
  port: 2871,
  wantPort: 2870,
  token: 'a3f9c2e814b7d05f6a1c93e28b4d7f60',
}

/**
 * 工具面。**拼**：`mcp.info` 不回工具表。此刻工具就固定这两件（写死在
 * `plugins/mcp/src/index.ts` 的 `buildServer`），界面照着列没问题；
 * 真要动态取，得给 mcp 件加一条 `mcp.tools`。
 */
export interface McpTool {
  name: string
  description: string
  params?: { name: string; type: string; required: boolean; description: string }[]
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'gwb_command_list',
    description: '列出这个 home 此刻有哪些命令（名字 + 描述 + 注册它的件）。命令随装了哪些件而变，没有固定清单。',
  },
  {
    name: 'gwb_command_run',
    description:
      '按命令名调工作台的命令面（先用 gwb_command_list 看有哪些）。命令自身失败（不存在、参数不对）不算协议错误，回的是 isError 的结果文本，照常往下读。',
    params: [
      { name: 'command', type: 'string', required: true, description: '命令名，如 skill.list' },
      { name: 'args', type: 'unknown', required: false, description: '可选参数，命令自己校验' },
    ],
  },
]

/** 命令面此刻有多少条。**有**：`cli.list`（命令总线自己那条自省） */
export const COMMAND_COUNT = 14

// ─────────────────────────────── skills 那一格 ───────────────────────────────

/**
 * 一份 skill。**有**：`skill.list` 回 `{ count, skills: GwbSkill[] }`，
 * 正文走 `skill.read`（`{ name, file? }`，file 缺省 `SKILL.md`，**每次现读盘**）。
 * 形状照 Anthropic Agent Skills 那套，同一份文件两边通用。
 */
export interface SkillRow {
  name: string
  /** frontmatter 的 description。**agent 靠它决定要不要读正文**，所以列表里必须整条显示，不截断 */
  description: string
  /** 挂它的那个件（完整包名） */
  plugin: string
  /** 目录下的文件清单（相对路径，POSIX 分隔符）。SKILL.md 恒在第一位 */
  files: string[]
}

export const SKILLS: SkillRow[] = [
  {
    name: 'gwb-release',
    description:
      '发一个件的新版本之前用。版本号怎么定、prepublishOnly 为什么不能省、发完要在 home 里验哪几样——按顺序走完这一份，别凭记忆发版。',
    plugin: '@godcreator02/gwb-hello',
    files: ['SKILL.md', 'references/verdaccio.md', 'references/checklist.md'],
  },
  {
    name: 'gwb-pane',
    description:
      '给一个件加窗格界面时用。mountPane 的形状、样式表为什么整张 scope 在 data-gwb-plugin 之下、弹层组件必须把 container 指回窗格容器（否则是一片没样式的白板）。',
    plugin: '@godcreator02/gwb-shell',
    files: ['SKILL.md', 'references/portal.md'],
  },
  {
    name: 'gwb-command',
    description:
      '注册一条命令之前用。命名按「件名.动作」，参数自己校验，失败回 { ok: false, error } 而不是抛——外部 agent 那半靠这条约定读结果。',
    plugin: '@godcreator02/gwb-commands',
    files: ['SKILL.md'],
  },
  {
    name: 'gwb-settings-define',
    description:
      '件要声明自己的设置项时用。scope 选 home 还是 machine、shared 什么时候写 true、为什么 secret 只是显示打码而盘上照样明文。',
    plugin: '@godcreator02/gwb-settings',
    files: ['SKILL.md', 'references/scope.md'],
  },
  {
    name: 'py-env',
    description: 'Python 那半的环境怎么起：venv 由守卫现建，装进 node_modules 之后也一样；写死的绝对路径进不得 git。',
    plugin: '@godcreator02/gwb-py-cli',
    files: ['SKILL.md', 'references/venv.md', 'scripts/bootstrap.md'],
  },
]

/** `skill.read` 拉回来的正文。demo 里预置一份，真界面点开时才去调 */
export const SKILL_BODY = `---
name: gwb-pane
description: 给一个件加窗格界面时用。mountPane 的形状、样式表为什么整张 scope 在 data-gwb-plugin 之下、弹层组件必须把 container 指回窗格容器（否则是一片没样式的白板）。
---

# 给件加一格窗格

## 导出名是 mountPane，不是 bootShell

外壳占整页那个根，窗格占井里一格。单看导出名就知道自己是哪种件。

\`\`\`ts
export function mountPane(args: PaneArgs, container: HTMLElement): { dispose(): void }
\`\`\`

## 认不出的 paneId 要报错，不要回落

「注册了 x 却画出 main」是那种没有任何现象的错。

## 弹层必须挂窗格容器

件的样式表整张 scope 在 \`[data-gwb-plugin="<包名>"]\` 之下。Select、DropdownMenu、
AlertDialog 这些 Radix 组件默认把 Portal 挂到 \`body\`——挂出去就一条规则都匹配不上，
症状是「下拉打开是一片没样式的白板」，不报错。

做成 context 而不是逐个传：传漏了同样是静默白板，而这种忘了传的错没有任何现象。
`

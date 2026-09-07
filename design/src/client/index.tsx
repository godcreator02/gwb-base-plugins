import { createRoot, type Root } from 'react-dom/client'
import type { ReactElement } from 'react'
import { PortalContainer } from './portal'
import { McpPane } from './McpPane'
import { SettingsPane } from './SettingsPane'
import { SkillsPane } from './SkillsPane'

/**
 * 设计图的挂载。**这个文件是脚手架，不是设计的一部分**——真件那半是各自的
 * `mountPane(args, container)`，由外壳调；这儿只是把三格摆到一页上。
 *
 * 挂载这几步跟真件一模一样，照抄就行：
 *
 * 1. 容器身上带 `data-gwb-plugin="<包名>"`——件的样式表整张 scope 在它之下
 * 2. 容器 `position: relative`——AlertDialog 那类改成了 absolute，参照的就是它
 * 3. 用 `PortalContainer` 把容器供出去——弹层挂它，不挂 body
 */

/** 把一格挂进容器。三步都在这儿，真件的 mountPane 里也是这三步 */
function mount(id: string, node: ReactElement): Root | undefined {
  const container = document.getElementById(id)
  if (container === null) return undefined
  // 弹层用 absolute 定位，参照系是最近的 positioned 祖先——不给这一句的话，
  // 确认框会跑到井外面去
  container.style.position = 'relative'
  const root = createRoot(container)
  root.render(<PortalContainer value={container}>{node}</PortalContainer>)
  return root
}

mount('pane-settings', <SettingsPane />)
mount('pane-mcp', <McpPane />)
mount('pane-skills', <SkillsPane />)

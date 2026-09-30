/**
 * 三个区合成一棵侧栏树：每个区一个 `root: true` 的根节点（侧栏分区），URL 仍按区分前缀，路由各用各的 loader。
 * base-ui 版的 Root 只有一个 fallback 槽，多棵树切换不稳定，所以用根节点分区。
 * 区内的顺序由各区 content/<区>/meta.json 定；content 下任何子目录的 meta.json 都不许带 `root: true`。
 */
import { source, sourceFuture, sourceTrajectory } from './source'
import type { Node, Root } from 'fumadocs-core/page-tree'

/**
 * 每个区必须带唯一的 $id：fumadocs 给侧栏的区切换下拉找「这个根节点对应哪个选项」时，除了比对象本身还比 $id，
 * 都没有 $id 的话 undefined === undefined 成立，三个区都会对上第一个选项
 */
function zone(id: string, name: string, root: Root): Node {
  return { $id: `zone:${id}`, type: 'folder', name, root: true, defaultOpen: true, children: root.children }
}

export function zoneTree(): Root {
  return {
    name: 'gwb-base-plugins',
    children: [
      zone('docs', '现状', source.getPageTree()),
      zone('trajectory', '轨迹', sourceTrajectory.getPageTree()),
      zone('future', '未来', sourceFuture.getPageTree()),
    ],
  }
}

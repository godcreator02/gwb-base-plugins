import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { zoneTree } from '@/lib/tree'
import type { ReactNode } from 'react'

// 带侧栏的那一组：现状、轨迹卡、未来三个区的页共用同一棵树（三个根节点），URL 前缀各是各的；整页星轨盘在 (trajectory-disk) 里，不用侧栏。
export default function Layout({ children }: { children: ReactNode }) {
  return <DocsLayout tree={zoneTree()}>{children}</DocsLayout>
}

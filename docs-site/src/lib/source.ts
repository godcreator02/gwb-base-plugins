import { loader } from 'fumadocs-core/source'
// .source/ 是 fumadocs-mdx 按 source.config.ts 生成的（gitignore），集合从这里拿。
// 三个区各一条 loader：URL 前缀 /docs、/trajectory、/future，路由各用各的 loader，侧栏在 src/lib/tree.ts 合成一棵树。
import { docs, future, trajectory } from '../../.source/server'

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
})

export const sourceTrajectory = loader({
  baseUrl: '/trajectory',
  source: trajectory.toFumadocsSource(),
})

export const sourceFuture = loader({
  baseUrl: '/future',
  source: future.toFumadocsSource(),
})

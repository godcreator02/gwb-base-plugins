import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // **空着,这一行就是那条「不许外置」的账。** 塌包之后 `@godcreator02/docfirst-workflow`
  // 里同时住着服务端那半（读盘、调 git、remark 插件)与客户端组件（`/fumadocs/pre`),
  // `serverExternalPackages` 按包名匹配、没有子路径粒度,所以它整包不能外置:外置之后
  // Next 走 Node 单独加载、跟站打包的 React 分了家,预渲染就报 `Cannot read properties of null`。
  // 不外置的代价只是多打一遍服务端那半,那半只在构建期跑、进不了客户端束
  serverExternalPackages: [],
  redirects: async () => [
    { source: '/', destination: '/docs/overview', permanent: true },
    { source: '/docs', destination: '/docs/overview', permanent: true },
    // 六区装配（2026-09-12）：路线升未来区、反馈与 README 正本各归各的区，老 URL 全保
    { source: '/docs/roadmap', destination: '/future/roadmap', permanent: true },
    { source: '/docs/feedback', destination: '/feedback/inbox', permanent: true },
    { source: '/docs/readme', destination: '/outputs/readme', permanent: true },
  ],
}

export default withMDX(config)

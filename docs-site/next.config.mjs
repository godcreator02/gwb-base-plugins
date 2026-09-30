import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // 必须为空：`@godcreator/docfirst-workflow` 一个包里既有服务端代码（读盘、调 git、remark 插件）
  // 又有客户端组件 /fumadocs/pre，serverExternalPackages 只能按整个包名设置，不能只外置子路径。
  // 外置之后 Next 用 Node 单独加载它，它拿到的 React 和站点打包的不是同一份，预渲染报
  // Cannot read properties of null
  serverExternalPackages: [],
  redirects: async () => [
    { source: '/', destination: '/docs', permanent: false },
    // 路线图在未来区；生成正本在现状区的 outputs/ 下；交接区与反馈区并进未来区的 spec/ 与 inbox/。旧网址都保留
    { source: '/docs/roadmap', destination: '/future/roadmap', permanent: true },
    { source: '/docs/feedback', destination: '/future', permanent: false },
    { source: '/docs/readme', destination: '/docs/outputs/readme', permanent: false },
    { source: '/outputs/:path*', destination: '/docs/outputs/:path*', permanent: false },
    { source: '/spec/:path*', destination: '/future', permanent: false },
    { source: '/feedback/:path*', destination: '/future', permanent: false },
    // 现状区按接缝图重写（2026-09-24）。用临时跳转：永久跳转会被浏览器缓存，以后这些网址再用上就打不开
    { source: '/docs/decisions', destination: '/docs/design', permanent: false },
    { source: '/docs/walls', destination: '/docs/pitfalls', permanent: false },
    // 找插件、配包源已并入生命周期插件仓 gwb-lifecycle-plugins 的插件管理（2026-09-24），这个文档站没有对应的页
    { source: '/docs/plugin-sources', destination: '/docs', permanent: false },
    { source: '/docs/seams/sources', destination: '/docs', permanent: false },
  ],
  // 旧配置曾把 / 与 /docs 永久重定向到 /docs/overview，浏览器缓存着那条 308：这里再重定向回 /docs
  // 就成环。改写不发 30x，缓存了旧跳转的浏览器也看得到入口页
  rewrites: async () => [{ source: '/docs/overview', destination: '/docs' }],
}

export default withMDX(config)

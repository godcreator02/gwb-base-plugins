import { Link, useLoaderData } from 'react-router'
import { siteHomeData } from '@godcreator/god-docsite/server'
import { SiteHomeLayout } from '@godcreator/god-docsite/react'
import { site } from '@/lib/site.server'
import { featureRuntime } from '@/features/runtime.generated'

// 站点的首页：建站器只在建站时写这一份，之后归站点自己改

export function loader() {
  return siteHomeData(site)
}

export default function Home() {
  const data = useLoaderData<typeof loader>()
  return (
    <SiteHomeLayout data={data} sidebarLinks={featureRuntime.sidebarLinks}>
      <title>{data.siteName}</title>
      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center">
        <h1 className="text-4xl font-bold">{data.siteName}</h1>
        <p className="text-fd-muted-foreground">
          gwb 的无界面基础插件：命令、MCP 入口、说明书、设置、数据、node-cli、py-cli。每条插件之间的接缝一页，每个插件一页，讲清功能、接口与刻意不做的事，全部钉在插件自己的代码上。
        </p>
        <Link to={data.docsUrl} className="rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground">
          看文档
        </Link>
      </section>
    </SiteHomeLayout>
  )
}

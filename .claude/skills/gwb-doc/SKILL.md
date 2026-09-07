---
name: gwb-doc
description: 写或改文档、往 CLAUDE.md 加东西、写代码注释、加一条「撞过的墙」、动 livedoc 引用之前用。正本在内核仓，这里只是路标加件仓自己的两条差异。
---

# 文档怎么写：正本在内核仓

**先读正本**：`D:\unitfolders\26090705ymz\gwb-kernel\.claude\skills\gwb-doc\SKILL.md`

坐在这个仓时它不进上下文，直接 Read 那个路径。三层分流、walls 条目格式、livedoc 五类
引用、注释政策、README 为什么是生成物，全在那份里。

## 这个仓的两条差异

**一、站在 4315，不是 4314。**

```powershell
pnpm --filter gwb-base-plugins-docs-site dev   # http://localhost:4315
pnpm doc          # livedoc check
pnpm doc:confirm  # 确认
```

**二、只钉件自己的代码。**

规则本身（准入判据、服务命名、依赖三档）的正本在**内核仓的站**上，这个站不重复写——
指过去就行。跨单元也钉不了那边的代码（livedoc 的路径相对本站，git 记忆也认不了另一个仓）。

这个站装的是：件的实现取舍、每个件的说明、**件这边撞的墙**。

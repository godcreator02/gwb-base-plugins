/**
 * 取货地址与样式表注入。内核的约定是 `gwb://asset/plugins/<包名>/<exports 子路径>`
 * ——**不在包的 `exports` 表里的文件一概解析不到**。
 */

/**
 * **`sub` 是 exports 表里的键，不是文件名**（键去掉开头那两个字符：`./client` → `client`）。
 * 这一条踩过：写成 `client.js` 时内核去表里查 `./client.js`，查不到，症状是
 * `Failed to fetch dynamically imported module` ——像网络错，其实是键名对不上。
 */
export function assetUrl(pkg: string, sub: string): string {
  return `gwb://asset/plugins/${pkg}/${sub}`
}

/** 件的浏览器那半。约定住 exports 的 `./client`，跟内核那边的 clientUrl 是同一条 */
export function clientUrl(pkg: string): string {
  return assetUrl(pkg, 'client')
}

/**
 * 注过的地址不再注，**也永不摘**。
 *
 * 样式表是全局的、幂等的，同一个件开两格没必要注两条。摘它才是麻烦：那需要引用计数，
 * 而计数错了的症状是「关掉一格，另一格的样式跟着没了」——静默，且要两格同开才复现。
 * 留着的代价只是内存里一份 CSSOM。
 */
const mounted = new Map<string, Promise<boolean>>()

/**
 * 注一张表并**等它真到位**。只 append 是不够的：`<link>` 是异步取的，第一帧 DOM
 * 完全可能落在表到位之前，那一瞬间是一堆没有样式的裸元素。
 *
 * **取不到回 false，不抛**：件可以没有样式表（`exports` 里没列 `./style.css` 就解析不到），
 * 那是正常情况而不是错。调用方照常挂它。
 */
export function loadStyle(href: string): Promise<boolean> {
  const seen = mounted.get(href)
  if (seen !== undefined) return seen
  const task = new Promise<boolean>((resolve) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.addEventListener('load', () => resolve(true))
    link.addEventListener('error', () => resolve(false))
    document.head.appendChild(link)
  })
  mounted.set(href, task)
  return task
}

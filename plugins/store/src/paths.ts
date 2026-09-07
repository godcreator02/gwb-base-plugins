import path from 'node:path'

/**
 * 数据区的路径与命名——零 I/O 纯逻辑（出现 `node:fs` import 即越界）。
 *
 * **这里的校验挡的是手滑，不是安全边界**：件本来就能自己 `fs.writeFile` 到任何地方，
 * node 里没有沙箱。它拦的是「名字里带斜杠造出意外的嵌套目录」这类事故。
 */

/** 文档名：kebab-case。写侧从严，挡掉路径穿越与大小写歧义 */
const DOC_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** npm 包名：可带 scope。件的身份来自 cordis.yml 的 name，形状照 npm 的规矩 */
const PKG_PATTERN = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

export function isValidDocName(value: string): boolean {
  return DOC_PATTERN.test(value)
}

export function isValidPackageName(value: string): boolean {
  // 单独挡 `..` 段：正则允许点号（npm 包名里合法），但 `..` 做目录名就是穿越
  if (value.split('/').some((seg) => seg === '.' || seg === '..')) return false
  return PKG_PATTERN.test(value)
}

/** 文档名不合规当场抛——别让坏名字落成盘上谁也对不上的文件 */
export function assertDocName(value: string): void {
  if (!isValidDocName(value)) {
    throw new Error(
      `文档名 ${JSON.stringify(value)} 不合规。一律 kebab-case（小写字母、数字、单连字符分段），比如 layout、open-panes。`,
    )
  }
}

export function assertPackageName(value: string): void {
  if (!isValidPackageName(value)) {
    throw new Error(`包名 ${JSON.stringify(value)} 不像个 npm 包名，算不出数据目录。`)
  }
}

/**
 * 一个件的数据目录：`<home>/data/<包名>`。
 *
 * **用完整包名不用短名**——短名不保证跨件唯一（`@acme/gwb-console` 与自家 `console` 会
 * 算出同一个），而数据撞了是互相覆盖，比样式撞了严重。带 scope 的包名天然是两级目录，
 * 跟 `node_modules` 一个形状。
 */
export function packageDir(dataDir: string, pkg: string): string {
  assertPackageName(pkg)
  return path.join(dataDir, 'data', ...pkg.split('/'))
}

/** 一份文档在某个件的目录里的落点 */
export function docFileIn(dir: string, doc: string): string {
  assertDocName(doc)
  return path.join(dir, `${doc}.json`)
}

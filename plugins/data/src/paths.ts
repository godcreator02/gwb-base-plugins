import path from 'node:path'

// 这个文件只算路径，不做 I/O

/** 文档名与条目 id 的每一段。字符集里没有点号，`.` 与 `..` 这两个穿越段进不来 */
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** 条目没手写 id 时 loader 发的是 8 位随机十六进制，每次启动都变 */
const RANDOM_ID = /^[0-9a-f]{8}$/

/** loader 把条目放在内核那条 include 下面，所以 entryId 是 `home:hello` 这样的两段 */
const MAX_ID_SEGMENTS = 2

export function isValidDocName(value: string): boolean {
  return KEBAB_CASE.test(value)
}

export function assertDocName(value: string): void {
  if (!isValidDocName(value)) {
    throw new Error(
      `文档名 ${JSON.stringify(value)} 不合规。一律 kebab-case（小写字母、数字、单连字符分段），比如 layout、open-panes。`,
    )
  }
}

function assertAtMostMaxSegments(entryId: string, segments: string[]): void {
  if (segments.length > MAX_ID_SEGMENTS) {
    throw new Error(
      `条目 id ${JSON.stringify(entryId)} 有 ${segments.length} 段，超过 ${MAX_ID_SEGMENTS} 段就算不出数据目录：数据目录按末段算，嵌套出来的同名末段会对应到同一个目录。`,
    )
  }
}

function assertEverySegmentIsKebabCase(entryId: string, segments: string[]): void {
  for (const segment of segments) {
    if (!KEBAB_CASE.test(segment)) {
      throw new Error(
        `条目 id ${JSON.stringify(entryId)} 里的 ${JSON.stringify(segment)} 不合规。id 要当数据目录名用，一律 kebab-case（小写字母、数字、单连字符分段），比如 hello、py-cli。`,
      )
    }
  }
}

/** 只取末段：`home:hello` → `hello`。与 gwb-settings 的 `entrySection` 是同一套算法的两份，改一处要同时改另一处 */
export function entryDirName(entryId: string): string {
  const segments = entryId.split(':')
  assertAtMostMaxSegments(entryId, segments)
  assertEverySegmentIsKebabCase(entryId, segments)
  return segments[segments.length - 1]!
}

/** 一条条目的数据目录：`<home>/data/<条目 id 末段>` */
export function entryDir(dataDir: string, entryId: string): string {
  return path.join(dataRoot(dataDir), entryDirName(entryId))
}

export function dataRoot(dataDir: string): string {
  return path.join(dataDir, 'data')
}

export function docFileIn(dir: string, doc: string): string {
  assertDocName(doc)
  return path.join(dir, `${doc}.json`)
}

/** 只看末段：前面那段是 loader 拼上的父条目 id */
export function looksRandom(entryId: string): boolean {
  const lastSegment = entryId.split(':').pop() ?? ''
  return RANDOM_ID.test(lastSegment)
}

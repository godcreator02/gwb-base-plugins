import path from 'node:path'

// 这个文件只算路径与名字，不做 I/O

/** 公共区的分区名。声明 `shared` 的项写在这里，别的插件不用 define 也读得到 */
export const SHARED_SECTION = '*'

/** 归属表在文件里的键：分区名 → 包名。分区名是 kebab-case 或 `*`，带 `$` 的键撞不上 */
export const OWNERS_KEY = '$owners'

const HOME_FILE = 'settings.json'

/** 设置名与条目 id 的每一段。字符集里没有点号，`.` 与 `..` 进不来；gwb-data 拿同一套字符集当目录名 */
const KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** 条目没手写 id 时 loader 发的是 8 位随机十六进制，每次启动都变 */
const RANDOM_ID = /^[0-9a-f]{8}$/

/** loader 把条目放在内核那条 include 下面，所以 entryId 是 `home:hello` 这样的两段 */
const MAX_ID_SEGMENTS = 2

export function isValidKey(value: string): boolean {
  return KEY_PATTERN.test(value)
}

export function assertKey(value: string): void {
  if (!isValidKey(value)) {
    throw new Error(
      `设置名 ${JSON.stringify(value)} 不合规。一律 kebab-case（小写字母、数字、单连字符分段），比如 level、anthropic-api-key。`,
    )
  }
}

/** 分区名的形状由 cordis.yml 决定，这里只挡空名与占用公共区 */
export function assertSection(value: string): void {
  if (value === SHARED_SECTION) {
    throw new Error(`${JSON.stringify(SHARED_SECTION)} 是公共区的保留名，条目 id 不能叫它。`)
  }
  if (value === '') throw new Error('分区名是空的——算不出这一项该落在哪。')
}

function assertAtMostMaxSegments(entryId: string, segments: string[]): void {
  if (segments.length > MAX_ID_SEGMENTS) {
    throw new Error(
      `条目 id ${JSON.stringify(entryId)} 有 ${segments.length} 段，超过 ${MAX_ID_SEGMENTS} 段就算不出分区名：分区按末段算，嵌套出来的同名末段会撞进同一个分区。`,
    )
  }
}

function assertEverySegmentIsKebabCase(entryId: string, segments: string[]): void {
  for (const segment of segments) {
    if (!KEY_PATTERN.test(segment)) {
      throw new Error(
        `条目 id ${JSON.stringify(entryId)} 里的 ${JSON.stringify(segment)} 不合规。id 要当设置的分区名用，一律 kebab-case（小写字母、数字、单连字符分段），比如 hello、py-cli。`,
      )
    }
  }
}

/** 只取末段：`home:hello` → `hello`。与 gwb-data 的 `entryDirName` 是同一套算法的两份，改一处要同时改另一处 */
export function entrySection(entryId: string): string {
  const segments = entryId.split(':')
  assertAtMostMaxSegments(entryId, segments)
  assertEverySegmentIsKebabCase(entryId, segments)
  return segments[segments.length - 1]!
}

/** `<home>/settings.json`，和 cordis.yml 并排 */
export function homeFile(dataDir: string): string {
  return path.join(dataDir, HOME_FILE)
}

/** 只看末段：前面那段是 loader 拼上的父条目 id */
export function looksRandom(entryId: string): boolean {
  const lastSegment = entryId.split(':').pop() ?? ''
  return RANDOM_ID.test(lastSegment)
}

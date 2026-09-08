import path from 'node:path'

/**
 * 设置文件的落点、设置名与分区名的规矩——零 I/O 纯逻辑（出现 `node:fs` import 即越界）。
 *
 * **这里的校验挡的是手滑，不是安全边界**：件本来就能自己 `fs.writeFile` 到任何地方，
 * node 里没有沙箱。它拦的是「名字里带斜杠」「顶掉公共区」这类事故。
 */

/** 公共区的分区名。件声明 `shared` 就落这儿，别的件不用 define 也读得到 */
export const SHARED_SECTION = '*'

/** 本 home 那份的文件名，跟 cordis.yml 并排。home 自持全部配置，没有第二份 */
const HOME_FILE = 'settings.json'

/**
 * 设置名与条目 id 的每一段：kebab-case。写侧从严，顺带挡掉分区键里的分隔符与路径穿越。
 * 字符集里没有点号，`.` 与 `..` 因此也进不来——姊妹件 `gwb-data` 拿同一套字符集当目录名。
 */
const KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** 条目 id 没手写时 loader 发的是 8 位随机十六进制，那种 id 每次启动都变 */
const RANDOM_ID = /^[0-9a-f]{8}$/

/** loader 把件的条目挂在内核那条 include 下面，所以 entryId 是 `home:hello` 这样的两段 */
const MAX_ID_SEGMENTS = 2

export function isValidKey(value: string): boolean {
  return KEY_PATTERN.test(value)
}

/** 设置名不合规当场抛——别让坏名字落成盘上谁也对不上的键 */
export function assertKey(value: string): void {
  if (!isValidKey(value)) {
    throw new Error(
      `设置名 ${JSON.stringify(value)} 不合规。一律 kebab-case（小写字母、数字、单连字符分段），比如 level、anthropic-api-key。`,
    )
  }
}

/**
 * 分区名是条目 id 的末段，形状由 cordis.yml 决定。这里只挡一件事：**不许顶掉公共区**。
 * `*` 那一格归共享项，被一个叫 `*` 的条目占了的话，两边的数据会互相覆盖。
 */
export function assertSection(value: string): void {
  if (value === SHARED_SECTION) {
    throw new Error(`${JSON.stringify(SHARED_SECTION)} 是公共区的保留名，条目 id 不能叫它。`)
  }
  if (value === '') throw new Error('分区名是空的——算不出这一项该落在哪。')
}

/**
 * entryId 换成 home 级那档的分区名。**这个算法只有这一处**——换算法只动这个函数。
 *
 * 现在的算法是**只取末段**：`home:hello` → `hello`。
 *
 * entryId 是 `Entry.id` 的 getter 用 cordis 的 `EntryTree.sep`（就是 `:`）把父条目 id 跟
 * 自己的拼出来的，`home` 那段是**内核**的 `ENTRY_ROOT` 常量——承载 cordis.yml 那条
 * `cordis:include` 的条目 id，跟件本身没关系。所以末段才是人在 cordis.yml 里手写的那个 id，
 * 取末段等于**跟内核那个常量脱钩**：内核哪天改 `ENTRY_ROOT` 的值，分区名不受影响。
 *
 * **姊妹件 `gwb-data` 的数据目录名必须是同一个答案**，那边有一份一模一样的 `entryDirName`
 * （它那份还多一层意思：冒号在 Windows 上当不了目录名）。两处都是十几行纯逻辑，为它
 * 新建一个共享包过不了准入判据；改了这儿就得同时改那儿。
 *
 * 段数超过两段当场抛：那意味着出现了 group 嵌套，不同 group 底下的同名末段会算进同一个
 * 分区、互相覆盖，得先把算法重新定过。
 */
export function entrySection(entryId: string): string {
  const segments = entryId.split(':')
  if (segments.length > MAX_ID_SEGMENTS) {
    throw new Error(
      `条目 id ${JSON.stringify(entryId)} 有 ${segments.length} 段，超过 ${MAX_ID_SEGMENTS} 段就算不出分区名：分区按末段算，嵌套出来的同名末段会撞进同一个分区。`,
    )
  }
  for (const segment of segments) {
    if (!KEY_PATTERN.test(segment)) {
      throw new Error(
        `条目 id ${JSON.stringify(entryId)} 里的 ${JSON.stringify(segment)} 不合规。id 要当设置的分区名用，一律 kebab-case（小写字母、数字、单连字符分段），比如 hello、py-cli。`,
      )
    }
  }
  return segments[segments.length - 1]!
}

/** 本 home 那份 */
export function homeFile(dataDir: string): string {
  return path.join(dataDir, HOME_FILE)
}

/**
 * entryId 形如 `home:hello`，末段才是 cordis.yml 里那个 id。
 * 末段像随机串就说明那条条目没手写 id，它的设置重启后对不上。
 */
export function looksRandom(entryId: string): boolean {
  const last = entryId.split(':').pop() ?? ''
  return RANDOM_ID.test(last)
}

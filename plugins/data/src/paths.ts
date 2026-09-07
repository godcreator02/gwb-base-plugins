import path from 'node:path'

/**
 * 数据区的路径与命名——零 I/O 纯逻辑（出现 `node:fs` import 即越界）。
 *
 * **这里的校验挡的是手滑，不是安全边界**：件本来就能自己 `fs.writeFile` 到任何地方，
 * node 里没有沙箱。它拦的是「名字里带斜杠造出意外的嵌套目录」这类事故。
 */

/**
 * 文档名与条目 id 的每一段：kebab-case。写侧从严，挡掉路径穿越与大小写歧义。
 * 字符集里没有点号，`.` 与 `..` 这两个穿越段因此进不来。
 */
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** 条目 id 没手写时 loader 发的是 8 位随机十六进制，那种 id 每次启动都变 */
const RANDOM_ID = /^[0-9a-f]{8}$/

/** loader 把件的条目挂在内核那条 include 下面，所以 entryId 是 `home:hello` 这样的两段 */
const MAX_ID_SEGMENTS = 2

export function isValidDocName(value: string): boolean {
  return KEBAB.test(value)
}

/** 文档名不合规当场抛——别让坏名字落成盘上谁也对不上的文件 */
export function assertDocName(value: string): void {
  if (!isValidDocName(value)) {
    throw new Error(
      `文档名 ${JSON.stringify(value)} 不合规。一律 kebab-case（小写字母、数字、单连字符分段），比如 layout、open-panes。`,
    )
  }
}

/**
 * entryId 换成一个目录名。**目录算法只有这一处**——换算法只动这个函数。
 *
 * 现在的算法是**只取末段**：`home:hello` → `hello`。
 *
 * entryId 是 `Entry.id` 的 getter 用 cordis 的 `EntryTree.sep`（就是 `:`）把父条目 id 跟
 * 自己的拼出来的，`home` 那段是**内核**的 `ENTRY_ROOT` 常量——承载 cordis.yml 那条
 * `cordis:include` 的条目 id，跟件本身没关系。所以末段才是人在 cordis.yml 里手写的那个 id，
 * 取末段等于**跟内核那个常量脱钩**：内核哪天改 `ENTRY_ROOT` 的值，数据目录不受影响。
 * 顺带解决冒号——它在 Windows 上是保留字符，进不了目录名。
 *
 * 超过两段当场抛：那意味着出现了 group 嵌套，不同 group 底下的同名末段会算进同一个
 * 目录、互相覆盖，得先把目录算法重新定过。
 */
export function entryDirName(entryId: string): string {
  const segments = entryId.split(':')
  if (segments.length > MAX_ID_SEGMENTS) {
    throw new Error(
      `条目 id ${JSON.stringify(entryId)} 有 ${segments.length} 段，超过 ${MAX_ID_SEGMENTS} 段就算不出数据目录：数据目录按末段算，嵌套出来的同名末段会撞进同一个目录。`,
    )
  }
  for (const segment of segments) {
    if (!KEBAB.test(segment)) {
      throw new Error(
        `条目 id ${JSON.stringify(entryId)} 里的 ${JSON.stringify(segment)} 不合规。id 要当数据目录名用，一律 kebab-case（小写字母、数字、单连字符分段），比如 hello、py-cli。`,
      )
    }
  }
  return segments[segments.length - 1]!
}

/**
 * 一条条目的数据目录：`<home>/data/<条目 id 末段>`。
 *
 * **按条目 id 切、不按包名切**——`id` 才是 cordis 条目模型里的身份，`name` 只说「装哪个
 * 包」。同一个包挂两条条目（比如两条 `gwb-py-cli` 各配一个解释器）是两份独立配置的实例，
 * 按包名切的话它们共用一个目录、互相覆盖。
 *
 * **姊妹件 `gwb-settings` 的分区键必须是同一个答案**，那边有一份一模一样的
 * `entrySection`。两处都是十几行纯逻辑，为它新建一个共享包过不了准入判据；
 * 改了这儿就得同时改那儿。
 */
export function entryDir(dataDir: string, entryId: string): string {
  return path.join(dataDir, 'data', entryDirName(entryId))
}

/** 一份文档在某个件的目录里的落点 */
export function docFileIn(dir: string, doc: string): string {
  assertDocName(doc)
  return path.join(dir, `${doc}.json`)
}

/**
 * entryId 形如 `home:hello`，末段才是 cordis.yml 里那个 id。
 * 末段像随机串就说明那条条目没手写 id，它的数据重启后对不上。
 */
export function looksRandom(entryId: string): boolean {
  const last = entryId.split(':').pop() ?? ''
  return RANDOM_ID.test(last)
}

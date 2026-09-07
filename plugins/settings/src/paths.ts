import path from 'node:path'

/**
 * 两份文件的落点、设置名与分区名的规矩——零 I/O 纯逻辑（出现 `node:fs` import 即越界）。
 *
 * **这里的校验挡的是手滑，不是安全边界**：件本来就能自己 `fs.writeFile` 到任何地方，
 * node 里没有沙箱。它拦的是「名字里带斜杠」「顶掉公共区」这类事故。
 */

/** 公共区的分区名。件声明 `shared` 就落这儿，别的件不用 define 也读得到 */
export const SHARED_SECTION = '*'

/** 本 home 那份的文件名，跟 cordis.yml 并排 */
const HOME_FILE = 'settings.json'

/** 机器级那份的文件名，跟 homes/ 并列 */
const MACHINE_FILE = 'machine.json'

/** 内核把 home 排成 `<userData>/homes/<名>`。机器级那份要跳出这一层 */
const HOMES_DIR = 'homes'

/** 设置名：kebab-case。写侧从严，顺带挡掉分区键里的分隔符与路径穿越 */
const KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** 条目 id 没手写时 loader 发的是 8 位随机十六进制，那种 id 每次启动都变 */
const RANDOM_ID = /^[0-9a-f]{8}$/

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
 * 分区名是包名或 entryId，形状由 cordis.yml 决定，这里只挡一件事：**不许顶掉公共区**。
 * `*` 那一格归共享项，被一条 `id: "*"` 的条目占了的话，两边的数据会互相覆盖。
 */
export function assertSection(value: string): void {
  if (value === SHARED_SECTION) {
    throw new Error(`${JSON.stringify(SHARED_SECTION)} 是公共区的保留名，条目 id 与包名都不能叫它。`)
  }
  if (value === '') throw new Error('分区名是空的——算不出这一项该落在哪。')
}

/** 本 home 那份 */
export function homeFile(dataDir: string): string {
  return path.join(dataDir, HOME_FILE)
}

/**
 * 机器级那份，跟 `homes/` 并列。
 *
 * 内核只交出 `dataDir`、没有 userData 路径，所以这儿从 `<userData>/homes/<名>` 往上推
 * 两层。**父目录必须叫 `homes`**——不叫就是内核改了 home 的排布，当场抛：把凭据写进一个
 * 意外的地方，比起不来难查得多。
 */
export function machineFile(dataDir: string): string {
  const homes = path.dirname(dataDir)
  if (path.basename(homes) !== HOMES_DIR) {
    throw new Error(
      `算不出机器级设置的落点：home 目录 ${JSON.stringify(dataDir)} 的父目录不叫 ${HOMES_DIR}。内核改了 home 的排布，这个件要跟着改。`,
    )
  }
  return path.join(path.dirname(homes), MACHINE_FILE)
}

/**
 * entryId 形如 `home:hello`，末段才是 cordis.yml 里那个 id。
 * 末段像随机串就说明那条条目没手写 id，它的设置重启后对不上。
 */
export function looksRandom(entryId: string): boolean {
  const last = entryId.split(':').pop() ?? ''
  return RANDOM_ID.test(last)
}

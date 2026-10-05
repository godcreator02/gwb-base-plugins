import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { credentialsFile, OWNERS_KEY } from './paths.js'
import { toOwners, toSettingsFile, type SettingsFile, type SettingsOwners } from './registry.js'
import { isRecord } from './vocab.js'

/** 内存中的完整设置。落盘时 secret.value 单独放在这个 home 的 credentials.json */
export interface StoredHome {
  sections: SettingsFile
  owners: SettingsOwners
}

function emptyHome(): StoredHome {
  return { sections: {}, owners: {} }
}

interface CredentialSlot {
  /** 没有 value 是删除记录：两文件写入中断时也不能恢复旧 settings.json 里的值 */
  value?: unknown
}

type CredentialSections = Record<string, Record<string, CredentialSlot>>

interface CredentialsFile {
  version: 1
  sections: CredentialSections
}

/** 不拼底层异常、JSON 片段或输入值，错误也不能成为凭据的回显通路 */
function storageError(name: string, action: string): Error {
  return new Error(`${name} ${action}失败；请检查该 home 的文件后重试，现有文件不会作为空凭据覆盖。`)
}

function readJson(file: string, name: string): unknown {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error: unknown) {
    if (isRecord(error) && error.code === 'ENOENT') return undefined
    throw storageError(name, '读取')
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw storageError(name, '解析')
  }
}

function readCredentials(file: string): CredentialsFile {
  const raw = readJson(file, 'credentials.json')
  if (raw === undefined) return { version: 1, sections: {} }
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.sections)
    || Object.keys(raw).some((key) => key !== 'version' && key !== 'sections')) {
    throw storageError('credentials.json', '格式校验')
  }
  for (const items of Object.values(raw.sections)) {
    if (!isRecord(items)) throw storageError('credentials.json', '格式校验')
    for (const slot of Object.values(items)) {
      if (!isRecord(slot) || Object.keys(slot).some((key) => key !== 'value')) {
        throw storageError('credentials.json', '格式校验')
      }
    }
  }
  return raw as unknown as CredentialsFile
}

function readOrdinarySettings(file: string, warn: (message: string) => void): StoredHome {
  let raw: unknown
  try {
    raw = readJson(file, 'settings.json')
  } catch {
    // 保留旧 settings 文件的宽松读取，但不把解析异常里可能出现的凭据写进日志。
    // writeSettings 会再次严格读取；损坏文件不会被后续自动持久化覆盖。
    warn(`${file} 读取或解析不了，暂按空设置处理；修复前禁止覆盖。`)
    return emptyHome()
  }
  if (raw === undefined) return emptyHome()
  return { sections: toSettingsFile(raw, warn, file), owners: toOwners(raw, warn, file) }
}

/**
 * 同步合并当前 home 两份文件；旧 settings 内的 secret.value 在下次持久化时迁移。
 * credentials 槽（包括删除记录）优先，并强制标记 secret，防止中断后元信息缺席导致回显。
 */
export function readSettings(file: string, warn: (message: string) => void): StoredHome {
  const home = readOrdinarySettings(file, warn)
  const credentials = readCredentials(credentialsFile(path.dirname(file)))
  for (const [section, slots] of Object.entries(credentials.sections)) {
    const items = Object.hasOwn(home.sections, section) ? home.sections[section]! : {}
    const merged = { ...items }
    for (const [key, slot] of Object.entries(slots)) {
      const stored = Object.hasOwn(items, key) ? items[key] : undefined
      const { value: _oldValue, ...metadata } = stored ?? {}
      Object.defineProperty(merged, key, {
        value: { ...metadata, type: 'secret', ...slot }, enumerable: true, configurable: true, writable: true,
      })
    }
    Object.defineProperty(home.sections, section, {
      value: merged, enumerable: true, configurable: true, writable: true,
    })
  }
  return home
}

/** 每个文件排在最后的那次写入，写完（成功或失败）就兑现；只用来排队，失败由那次写入自己的 promise 交给调用方 */
const lastQueuedWriteByFile = new Map<string, Promise<void>>()

/** 同一个文件的写入按发起顺序一次一个：每次都是整份替换，后发起的那次必须最后写进文件 */
function writeInCallOrder(file: string, write: () => Promise<void>): Promise<void> {
  const previous = lastQueuedWriteByFile.get(file)
  const current = previous === undefined ? write() : previous.then(write)
  const settled = current.catch(() => undefined)
  lastQueuedWriteByFile.set(file, settled)
  void settled.then(() => {
    if (lastQueuedWriteByFile.get(file) === settled) lastQueuedWriteByFile.delete(file)
  })
  return current
}

/** 随机后缀保证同一毫秒里的两次写入不共用一个临时文件 */
function tempFileNextTo(file: string): string {
  return `${file}.${process.pid}.${randomUUID()}.tmp`
}

/** 先写临时文件再改名覆盖。rename 只在同一分区上原子，所以临时文件必须和目标同目录 */
async function replaceFileAtomically(file: string, text: string): Promise<void> {
  const tmp = tempFileNextTo(file)
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    await fs.promises.writeFile(tmp, text, 'utf8')
    await fs.promises.rename(tmp, file)
  } catch {
    await fs.promises.rm(tmp, { force: true }).catch(() => undefined)
    throw storageError(path.basename(file), '写入')
  }
}

/** 已有槽永久保留删除记录，避免两文件之间中断后旧 settings 值复活 */
function splitSecrets(home: StoredHome, previous: CredentialsFile): { settings: StoredHome; credentials: CredentialsFile } {
  const secretSections: CredentialSections = Object.fromEntries(Object.entries(previous.sections).map(([section, slots]) => [
    section, Object.fromEntries(Object.keys(slots).map((key) => [key, {}])),
  ]))
  const sections: SettingsFile = Object.fromEntries(Object.entries(home.sections).map(([section, items]) => {
    const ordinaryItems = Object.fromEntries(Object.entries(items).map(([key, item]) => {
      const previousSlots = Object.hasOwn(previous.sections, section) ? previous.sections[section] : undefined
      const wasSecret = previousSlots !== undefined && Object.hasOwn(previousSlots, key)
      if (item.type !== 'secret' && !wasSecret) return [key, item]
      const { value, ...metadata } = item
      const slots = Object.hasOwn(secretSections, section) ? secretSections[section]! : {}
      Object.defineProperty(slots, key, {
        value: value === undefined ? {} : { value }, enumerable: true, configurable: true, writable: true,
      })
      Object.defineProperty(secretSections, section, {
        value: slots, enumerable: true, configurable: true, writable: true,
      })
      return [key, { ...metadata, type: 'secret' }]
    }))
    return [section, ordinaryItems]
  }))
  return { settings: { sections, owners: home.owners }, credentials: { version: 1, sections: secretSections } }
}

function serialize(data: unknown): string {
  try {
    return `${JSON.stringify(data, null, 2)}\n`
  } catch {
    throw storageError('设置与凭据', '序列化')
  }
}

/**
 * 同一个 home 按发起顺序写两份快照；先 credentials 再 settings。
 * 两文件无法一次 rename，但凭据优先与删除记录保证中断后不会恢复旧凭据，也不会丢掉已迁移值。
 */
export async function writeSettings(file: string, home: StoredHome): Promise<void> {
  // 在排队前快照，调用方随后改内存也不会更改这次写入；序列化失败时不创建任何文件。
  const snapshot = JSON.parse(serialize(home)) as StoredHome
  const resolvedFile = path.resolve(file)
  const queueKey = process.platform === 'win32' ? resolvedFile.toLowerCase() : resolvedFile
  await writeInCallOrder(queueKey, async () => {
    const secretFile = credentialsFile(path.dirname(resolvedFile))
    const previous = readCredentials(secretFile)
    // 旧 settings 可能仍含凭据，损坏时同样禁止覆盖。ENOENT 才当作没有文件。
    readJson(resolvedFile, 'settings.json')
    const { settings, credentials } = splitSecrets(snapshot, previous)
    const settingsText = serialize({ [OWNERS_KEY]: settings.owners, ...settings.sections })
    const credentialsText = serialize(credentials)
    await replaceFileAtomically(secretFile, credentialsText)
    await replaceFileAtomically(resolvedFile, settingsText)
  })
}

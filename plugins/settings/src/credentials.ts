import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { isRecord } from './vocab.js'
import { readSettings } from './store.js'
import { homeFile, isValidDerivedKey, isValidKey } from './paths.js'
import type { SettingStatus, Slot } from './registry.js'

const MAX_IMPORT_BYTES = 1024 * 1024

export interface CredentialDestination {
  to: Slot
  overwrite: boolean
}

export interface CopyCredentialArgs extends CredentialDestination {
  from: Slot & { home?: string }
}

export interface ImportCredentialArgs extends CredentialDestination {
  from: { file: string; format: 'text' | 'json'; path?: string[] }
}

export function objectArgs(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(raw)) throw new Error('参数要是一个对象')
  if (Object.keys(raw).some((key) => !allowed.includes(key))) throw new Error('参数包含不支持的字段；请查看命令 usage')
  return raw
}

/** 槽位只有分区和键；拒绝原型属性，不把无效输入回显到日志。 */
export function credentialSlot(raw: unknown): Slot {
  const value = objectArgs(raw, ['section', 'key'])
  const section = value['section']
  const key = value['key']
  if (typeof section !== 'string' || (section !== '*' && !isValidKey(section))) throw new Error('section 要是分区名（kebab-case 或 *）')
  if (typeof key !== 'string' || !(isValidKey(key) || isValidDerivedKey(key)) || ['constructor', 'prototype'].includes(key)) {
    throw new Error('key 要是有效的设置键（kebab-case，或一组设置派生的 <组>.<实例>.<字段>）')
  }
  if (section === 'constructor' || section === 'prototype') throw new Error('section 不能使用原型属性名')
  return { section, key }
}

function destination(raw: Record<string, unknown>): CredentialDestination {
  if (raw['overwrite'] !== undefined && typeof raw['overwrite'] !== 'boolean') throw new Error('overwrite 要是 boolean')
  return { to: credentialSlot(raw['to']), overwrite: raw['overwrite'] === true }
}

export function copyArgs(raw: unknown): CopyCredentialArgs {
  const value = objectArgs(raw, ['from', 'to', 'overwrite'])
  const from = objectArgs(value['from'], ['home', 'section', 'key'])
  const home = from['home']
  if (home !== undefined && (typeof home !== 'string' || !isValidKey(home))) throw new Error('from.home 只接受 home 名字，不接受路径')
  const slot = credentialSlot({ section: from['section'], key: from['key'] })
  return { ...destination(value), from: { ...slot, ...(home === undefined ? {} : { home: home as string }) } }
}

export function importArgs(raw: unknown): ImportCredentialArgs {
  const value = objectArgs(raw, ['from', 'to', 'overwrite'])
  const from = objectArgs(value['from'], ['file', 'format', 'path'])
  const file = from['file']
  const format = from['format']
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('from.file 要是本机文件的绝对路径')
  if (format !== 'text' && format !== 'json') throw new Error('from.format 要是 text 或 json')
  const keys = from['path']
  if (format === 'text' && keys !== undefined) throw new Error('text 导入不接受 path')
  if (format === 'json' && keys !== undefined && (!Array.isArray(keys) || !keys.every((key) => typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key)))) {
    throw new Error('from.path 要是 JSON 字段路径的字符串数组')
  }
  return { ...destination(value), from: { file, format, ...(keys === undefined ? {} : { path: keys as string[] }) } }
}

export function generateArgs(raw: unknown): CredentialDestination & { bytes: number } {
  const value = objectArgs(raw, ['to', 'overwrite', 'bytes'])
  const bytes = value['bytes'] === undefined ? 32 : value['bytes']
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 16 || bytes > 128) throw new Error('bytes 要是 16 到 128 的整数')
  return { ...destination(value), bytes }
}

export function assertWritableCredential(status: SettingStatus | undefined, overwrite: boolean): void {
  if (status?.secret !== true || !status.live) throw new Error('目标必须是当前 home 已启用插件声明的 secret 项')
  if (status.isSet && !overwrite) throw new Error('目标已配置；要替换请明确给 overwrite:true')
}

function credentialText(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('来源不是非空的凭据字符串')
  return value
}

/** 只读指定文件，不把解析异常、文件内容或所选值交回错误。 */
export function readImportedCredential(from: ImportCredentialArgs['from']): string {
  let contents: string
  try {
    const info = fs.statSync(from.file)
    if (!info.isFile() || info.size > MAX_IMPORT_BYTES) throw new Error('invalid source')
    contents = fs.readFileSync(from.file, 'utf8')
  } catch {
    throw new Error('凭据来源文件无法读取，或不是 1 MiB 以内的普通文件')
  }
  if (from.format === 'text') return credentialText(contents.replace(/\r?\n$/, ''))
  let value: unknown
  try {
    value = JSON.parse(contents.replace(/^\uFEFF/, '')) as unknown
  } catch {
    throw new Error('凭据来源文件不是有效 JSON；内容未回显')
  }
  for (const key of from.path ?? []) {
    if ((!isRecord(value) && !Array.isArray(value)) || !Object.hasOwn(value, key)) throw new Error('凭据来源文件中没有指定的 JSON 字段')
    value = (value as Record<string, unknown>)[key]
  }
  return credentialText(value)
}

/** 跨 home 只读指定的兄弟 home；只写当前服务，避免绕过另一进程的内存表。 */
export function readCopiedCredential(currentSettingsFile: string, from: CopyCredentialArgs['from'], readLocal: (slot: Slot) => unknown, statusLocal: (slot: Slot) => SettingStatus | undefined): string {
  const currentHome = path.dirname(currentSettingsFile)
  if (from.home === undefined || from.home === path.basename(currentHome)) {
    if (statusLocal(from)?.secret !== true) throw new Error('来源必须是 secret 项')
    return credentialText(readLocal(from))
  }
  const sourceHome = path.join(path.dirname(currentHome), from.home)
  if (!fs.existsSync(sourceHome)) throw new Error('指定的来源 home 不存在')
  const stored = readSettings(homeFile(sourceHome), () => {})
  const item = stored.sections[from.section]?.[from.key]
  if (item?.type !== 'secret') throw new Error('来源 home 中没有指定的 secret 项')
  return credentialText(item.value)
}

/** 随机值只供本机服务安装使用；有效期与服务端注册由使用方负责。 */
export function generateCredential(bytes: number): string {
  return randomBytes(bytes).toString('base64url')
}

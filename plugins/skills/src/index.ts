import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Logger } from 'cordis'
import type { GwbContext } from '@godcreator/gwb-kernel-desktop'
import type { GwbResult } from '@godcreator/gwb-commands'
// 这个 import 同时激活命令插件的 `declare module 'cordis'`，给 ctx 加上 gwbCommands
import type { GwbCommands } from '@godcreator/gwb-commands'
import { collectSkills, SKILL_ENTRY, type CollectedSkill, type CollectProblem, type GwbSkill } from './collect.js'

export type { GwbSkill } from './collect.js'
export { SKILL_ENTRY } from './collect.js'

export const SKILL_LIST_COMMAND = 'skill.list'
export const SKILL_READ_COMMAND = 'skill.read'

const PLUGIN_NAME = 'gwb-skills'
const PACKAGE_NAME = '@godcreator/gwb-skills'

/** 调用方拿到的接口。写 `inject: ['gwbSkills']` 或局部注入才有 */
export interface GwbSkillsApi {
  /**
   * 登记一个装说明书的目录（下面每个子目录是一份），回注销函数。
   * 这个目录要列进自己 `package.json` 的 `files`，漏了包照样发布、装得上，到登记时才报「说明书目录读不了」
   */
  register(dir: string | URL): () => void
  /** 此刻登记着的全部说明书 */
  list(): GwbSkill[]
  /** 读某份说明书里的一个文件（缺省 `SKILL.md`），每次从磁盘读。不在表里回 undefined */
  read(name: string, file?: string): Promise<string | undefined>
}

function logCollectProblems(log: Logger, pkg: string, problems: CollectProblem[]): void {
  for (const problem of problems) log.warn(`[${pkg}] ${problem.where}：${problem.message}`)
}

export default class GwbSkills extends Service implements GwbSkillsApi {
  static inject = ['gwbCommands']

  /** 用 TS 的 `private` 不用 `#`：cordis 给每个调用方派生 `Object.create(this)`，`#` 字段在派生对象上一读就抛错 */
  private readonly skillsByName = new Map<string, CollectedSkill>()

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbSkills')
  }

  [Service.init](): void {
    const commandBus = this.ctx.gwbCommands
    // inject 保证了它在，这句只是把类型收窄
    if (commandBus === undefined) return
    this.registerSkillCommands(commandBus)
    this.ctx
      .logger(PLUGIN_NAME)
      .info(`说明书插件就绪（ctx.gwbSkills），列出说明书调 ${SKILL_LIST_COMMAND}、读正文调 ${SKILL_READ_COMMAND}`)
  }

  private registerSkillCommands(commandBus: GwbCommands): void {
    this.ctx.effect(() =>
      commandBus.register(
        { name: SKILL_LIST_COMMAND, description: '此刻登记着的全部说明书（每份带名字、描述、登记它的插件的包名、文件清单）', usage: '无参数', plugin: PACKAGE_NAME, effect: 'read' },
        () => ({ count: this.skillsByName.size, skills: this.list() }),
      ),
    )
    this.ctx.effect(() =>
      commandBus.register(
        { name: SKILL_READ_COMMAND, description: '读一份 skill 的正文', usage: '参数 { name, file? }，file 缺省 SKILL.md', plugin: PACKAGE_NAME, effect: 'read' },
        (args) => this.runSkillReadCommand(args),
      ),
    )
  }

  private async runSkillReadCommand(args: unknown): Promise<GwbResult> {
    const readArgs = args as { name?: unknown; file?: unknown } | undefined
    const skillName = readArgs?.name
    if (typeof skillName !== 'string' || skillName === '') {
      return { ok: false, error: `${SKILL_READ_COMMAND} 要 { name: string, file?: string }` }
    }
    const file = typeof readArgs?.file === 'string' && readArgs.file !== '' ? readArgs.file : SKILL_ENTRY
    const text = await this.read(skillName, file)
    // 不区分「没这份说明书」与「没这个文件」，免得外面借报错探出哪些名字存在
    if (text === undefined) return { ok: false, error: `读不到 ${skillName}/${file}（不在登记表里）` }
    return { ok: true, data: { name: skillName, file, text } }
  }

  /** `fiber.entry` 是 loader 加上的，不在 cordis 的类型里，按运行时形状取 */
  private callerPackageName(): string {
    const fiber = this.ctx.fiber as unknown as { entry?: { options?: { name?: unknown } } } | undefined
    const name = fiber?.entry?.options?.name
    if (typeof name !== 'string' || name === '') {
      throw new Error('取不到调用方的身份——ctx.gwbSkills 只能在经 cordis.yml 加载的插件里用')
    }
    return name
  }

  /** 同名的先到先得：已被别的包占住的那份不收、写 warn。回收下的那几份 */
  private addSkillsKeepingFirstComer(log: Logger, pkg: string, collectedSkills: CollectedSkill[]): CollectedSkill[] {
    const addedSkills: CollectedSkill[] = []
    for (const collected of collectedSkills) {
      const holder = this.skillsByName.get(collected.skill.name)
      if (holder !== undefined) {
        log.warn(`[${pkg}] skill 名 ${collected.skill.name} 已被 ${holder.skill.plugin} 占着，这一份不登记`)
        continue
      }
      this.skillsByName.set(collected.skill.name, collected)
      addedSkills.push(collected)
    }
    return addedSkills
  }

  /** 只删表里仍是自己那条记录的：先注销再被别人登记的同名说明书，不随这次注销一起删 */
  private removeSkillsStillHeldBy(addedSkills: CollectedSkill[]): void {
    for (const added of addedSkills) {
      if (this.skillsByName.get(added.skill.name) === added) this.skillsByName.delete(added.skill.name)
    }
  }

  register(dir: string | URL): () => void {
    const pkg = this.callerPackageName()
    const skillsDir = dir instanceof URL ? fileURLToPath(dir) : path.resolve(dir)
    const log = this.ctx.logger(PLUGIN_NAME)
    const { skills, problems } = collectSkills(skillsDir, pkg)
    logCollectProblems(log, pkg, problems)

    const addedSkills = this.addSkillsKeepingFirstComer(log, pkg, skills)
    if (addedSkills.length > 0) {
      log.info(`[${pkg}] 登记了 ${addedSkills.length} 份 skill：${addedSkills.map((added) => added.skill.name).join('、')}`)
    }

    const unregisterAddedSkills = (): void => this.removeSkillsStillHeldBy(addedSkills)
    // this.ctx 是调用方的上下文，调用方卸载时自动注销
    this.ctx.effect(() => unregisterAddedSkills)
    return unregisterAddedSkills
  }

  list(): GwbSkill[] {
    return [...this.skillsByName.values()].map((found) => found.skill)
  }

  async read(name: string, file: string = SKILL_ENTRY): Promise<string | undefined> {
    const found = this.skillsByName.get(name)
    if (found === undefined) return undefined
    // 只认登记时扫出的清单，不做路径拼接：清单是扫出来的，里面不会有 `..`
    if (!found.skill.files.includes(file)) return undefined
    try {
      return await fs.readFile(path.join(found.dir, ...file.split('/')), 'utf8')
    } catch (readError) {
      this.ctx.logger(PLUGIN_NAME).warn(`读 ${name}/${file} 失败：${String(readError)}`)
      return undefined
    }
  }
}

declare module 'cordis' {
  interface Context {
    gwbSkills: GwbSkillsApi
  }
}

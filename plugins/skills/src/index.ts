import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service } from 'cordis'
import type { GwbContext } from '@godcreator02/gwb-plugin-api'
// 只为激活 commands 件的 `declare module 'cordis'`——它给 ctx 加上 gwbCommands 这个名字
import type {} from '@godcreator02/gwb-commands'
import { collectSkills, SKILL_ENTRY, type CollectedSkill, type GwbSkill } from './collect.js'

export type { GwbSkill } from './collect.js'
export { SKILL_ENTRY } from './collect.js'

/**
 * skill 服务：**谁有说明书谁自己挂上来**。
 *
 * skill 是给 agent 看的说明书（`SKILL.md` + 可选的附件）。工作台把命令面开给外部
 * agent 之后，agent 手上只有一张命令名清单——多步流程、调用顺序、踩过的坑无处可讲，
 * 这个件就是那些话的落点。
 *
 * 三条纪律，各自挡住一种骗人的局面：
 *
 * - **挂载是主动的**：件在自己的 `apply` 里挂一个目录，随 `ctx.effect` 卸载回收。
 *   不扫 `node_modules`、不问条目树的启停——表里每一条都对应一个此刻真挂着的件，
 *   不会出现「skill 在、它讲的命令不在」
 * - **正文每次现读盘**：改了 `SKILL.md` 的正文立刻生效，不必重挂件；内存里只留元信息。
 *   （加删文件、改 frontmatter 仍要重挂——那些是注册时扫的）
 * - **读文件只认登记过的清单**：名字来查表，不做路径拼接——拼接就意味着一个带 `../`
 *   的参数能读出件目录以外的任何文件
 *
 * 暴露给外部 agent 的那一面**不在这儿**：这个件只管收集与查询，不认识 MCP。
 */

/** 取表那条命令。注册与调用两处同吃这一个常量 */
export const SKILL_LIST_COMMAND = 'skill.list'

/** 读正文那条命令。服务面的 `read` 在这一版还没有别的出口，缺了它就没人调得到 */
export const SKILL_READ_COMMAND = 'skill.read'

/** 消费方拿到的那一格。写 `inject: ['gwbSkills']` 才有 */
export interface GwbSkillsApi {
  /**
   * 挂一个装 skill 的目录（下面每个子目录是一个 skill），回注销函数。
   * **别忘了把那个目录加进自己 `package.json` 的 `files`**——漏了包照发照装得上，
   * 到挂载时才报「skill 目录读不动」。
   */
  register(dir: string | URL): () => void
  /** 此刻挂着的全部 skill */
  list(): GwbSkill[]
  /** 读某份 skill 里的一个文件（缺省 `SKILL.md`），每次现读盘。不在表里回 undefined */
  read(name: string, file?: string): Promise<string | undefined>
}

export default class GwbSkills extends Service implements GwbSkillsApi {
  /** 没有命令总线就不挂——inject 是 cordis 的等待机制，不是建议 */
  static inject = ['gwbCommands']

  /**
   * skill 名 → 那一份（名字全局唯一，见 register 的重名纪律）。
   * **用 TS 的 `private` 不用 `#`**：cordis 给每个消费者派生一份 `Object.create(this)`，
   * 而 `#` 私有字段的内部槽不在原型链上，派生对象上一读就炸。
   */
  private readonly table = new Map<string, CollectedSkill>()

  constructor(ctx: GwbContext) {
    super(ctx, 'gwbSkills')
  }

  /** 服务就绪时把取表那条命令挂上；effect 包着，本件卸载时自动注销 */
  [Service.init](): void {
    const cli = this.ctx.gwbCommands
    // inject 保证了它在，这句只是把类型收窄
    if (cli === undefined) return
    this.ctx.effect(() =>
      cli.register(
        { name: SKILL_LIST_COMMAND, description: '此刻挂着的 skill（名字 + 描述 + 挂它的件）', plugin: 'gwb-skills' },
        () => ({ count: this.table.size, skills: this.list() }),
      ),
    )
    this.ctx.effect(() =>
      cli.register(
        { name: SKILL_READ_COMMAND, description: '读一份 skill 的正文（{ name, file? }，file 缺省 SKILL.md）', plugin: 'gwb-skills' },
        async (args) => {
          const req = args as { name?: unknown; file?: unknown } | undefined
          const skillName = req?.name
          if (typeof skillName !== 'string' || skillName === '') {
            return { ok: false, error: `${SKILL_READ_COMMAND} 要 { name: string, file?: string }` }
          }
          const file = typeof req?.file === 'string' && req.file !== '' ? req.file : SKILL_ENTRY
          const text = await this.read(skillName, file)
          // 读不到就说读不到。**不区分「没这份 skill」与「没这个文件」**——两者都是
          // 「不在登记表里」，分开报等于告诉外面哪些名字存在
          if (text === undefined) return { ok: false, error: `读不到 ${skillName}/${file}（不在登记表里）` }
          return { ok: true, data: { name: skillName, file, text } }
        },
      ),
    )
    this.ctx
      .logger('gwb-skills')
      .info(`skill 注册就绪（ctx.gwbSkills），取表走 ${SKILL_LIST_COMMAND}、读正文走 ${SKILL_READ_COMMAND}`)
  }

  /**
   * 挂它的是哪个件。方法里的 `this.ctx` 是**消费者**的 ctx，`fiber.entry` 是 loader
   * 挂上的（不是 cordis 本体的面），所以按运行时形状取、不动全局类型声明
   */
  private owner(): string {
    const fiber = this.ctx.fiber as unknown as { entry?: { options?: { name?: unknown } } } | undefined
    const name = fiber?.entry?.options?.name
    if (typeof name !== 'string' || name === '') {
      throw new Error('取不到调用方的身份——ctx.gwbSkills 只能在经 cordis.yml 挂上的件里用')
    }
    return name
  }

  register(dir: string | URL): () => void {
    const owner = this.owner()
    const root = dir instanceof URL ? fileURLToPath(dir) : path.resolve(dir)
    const log = this.ctx.logger('gwb-skills')
    const { skills, problems } = collectSkills(root, owner)
    for (const p of problems) log.warn(`[${owner}] ${p.where}：${p.message}`)

    const taken: string[] = []
    for (const found of skills) {
      const clash = this.table.get(found.skill.name)
      if (clash !== undefined) {
        // 静默覆盖会让 agent 读到另一个件的说明书，而症状只是「它照着做但做错了」
        log.warn(`[${owner}] skill 名 ${found.skill.name} 已被 ${clash.skill.plugin} 占着，这一份没挂`)
        continue
      }
      this.table.set(found.skill.name, found)
      taken.push(found.skill.name)
    }
    if (taken.length > 0) log.info(`[${owner}] 挂上 ${taken.length} 份 skill：${taken.join('、')}`)

    const off = (): void => {
      // 只撤自己挂上的那几个：别人后来挂的同名一份不动
      for (const key of taken) this.table.delete(key)
    }
    // 挂在**调用方**的 effect 上（this.ctx 在方法里是消费者的），件卸载时自动摘
    this.ctx.effect(() => off)
    return off
  }

  list(): GwbSkill[] {
    return [...this.table.values()].map((found) => found.skill)
  }

  async read(name: string, file: string = SKILL_ENTRY): Promise<string | undefined> {
    const found = this.table.get(name)
    if (found === undefined) return undefined
    // 只认登记表里的那几份——这张表是扫出来的，条目里不会有 `..`
    if (!found.skill.files.includes(file)) return undefined
    try {
      return await fs.readFile(path.join(found.dir, ...file.split('/')), 'utf8')
    } catch (err) {
      this.ctx.logger('gwb-skills').warn(`读 ${name}/${file} 失败：${String(err)}`)
      return undefined
    }
  }
}

declare module 'cordis' {
  interface Context {
    gwbSkills: GwbSkillsApi
  }
}

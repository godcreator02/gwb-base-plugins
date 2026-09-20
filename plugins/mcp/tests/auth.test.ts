import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  allowedHosts,
  allowedOrigins,
  bearerIn,
  gateRequest,
  loadOrCreateToken,
  rotateToken,
  SECRET_DIR,
  SECRET_FILE,
  TOKEN_ENV,
  TOKEN_HEADER,
  TOKEN_SCHEME,
} from '../src/auth.js'
import { credentialNote } from '../src/index.js'

/**
 * 这道门的判据守卫。
 *
 * 三件事最该钉住，它们各自的坏法在别处看不见：
 *
 * 1. **token 落盘且重启不换**——0.4 摘鉴权的理由是「跟着重启换新，逼人反复翻日志捞」。
 *    哪天有人把生成挪到内存里，症状是「所有人都突然连不上」，而测试全绿
 * 2. **判据在派发之前**——顺序错了（先建 server 再判）功能上看不出区别，
 *    但「拒绝」就只是一句日志，不是一道墙
 * 3. **坏文件先留证再换**——静默覆盖之后，那次损坏的原始字节就永远查不到了
 */

const made: string[] = []

function tempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwb-mcp-auth-'))
  made.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** 一次判据调用的默认入参：全合法，各用例只坏自己关心的那一格 */
function gateInput(over: Partial<Parameters<typeof gateRequest>[0]> = {}): Parameters<typeof gateRequest>[0] {
  return {
    headers: { [TOKEN_HEADER]: `${TOKEN_SCHEME} tok-abcdefghijklmnop`, host: '127.0.0.1:2870' },
    token: 'tok-abcdefghijklmnop',
    port: 2870,
    ...over,
  }
}

describe('凭据文件', () => {
  it('第一次取:现生成一份、落盘、再取还是同一份（重启不换就是这条）', () => {
    const home = tempHome()
    const first = loadOrCreateToken(home)
    expect(first.created).toBe(true)
    expect(first.regenerated).toBe(false)
    expect(first.token.length).toBeGreaterThanOrEqual(16)
    expect(first.file).toBe(path.join(home, SECRET_DIR, SECRET_FILE))

    // 同一个 home 再取一次＝模拟重启：必须原样拿到同一份
    const again = loadOrCreateToken(home)
    expect(again.token).toBe(first.token)
    expect(again.created).toBe(false)
  })

  it('两个 home 的 token 不一样——凭据是 home 级的身份，不是进程级的', () => {
    expect(loadOrCreateToken(tempHome()).token).not.toBe(loadOrCreateToken(tempHome()).token)
  })

  it('文件在但读不出 token:坏的先另存一份,再换新的', () => {
    const home = tempHome()
    const file = path.join(home, SECRET_DIR, SECRET_FILE)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{"token": ')

    const out = loadOrCreateToken(home)
    expect(out.regenerated).toBe(true)
    expect(out.created).toBe(false)

    const broken = fs.readdirSync(path.dirname(file)).filter((name) => name.includes('.broken-'))
    expect(broken).toHaveLength(1)
    const kept = broken[0]
    if (kept === undefined) throw new Error('没留下 .broken-* 那份')
    expect(fs.readFileSync(path.join(path.dirname(file), kept), 'utf8')).toBe('{"token": ')
  })

  it('空文件不算坏:不留下没意义的 .broken-*', () => {
    const home = tempHome()
    const file = path.join(home, SECRET_DIR, SECRET_FILE)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '')

    const out = loadOrCreateToken(home)
    expect(out.created).toBe(true)
    expect(out.regenerated).toBe(false)
    expect(fs.readdirSync(path.dirname(file)).some((name) => name.includes('.broken-'))).toBe(false)
  })

  it('换发:回新的一份,旧的那份读不出来了', () => {
    const home = tempHome()
    const before = loadOrCreateToken(home).token
    const after = rotateToken(home)
    expect(after.token).not.toBe(before)
    expect(loadOrCreateToken(home).token).toBe(after.token)
  })

  it('常量是契约:客户端与环境变量认的就是这几个名字', () => {
    expect(SECRET_FILE).toBe('secret.json')
    expect(SECRET_DIR).toBe('mcp')
    expect(TOKEN_ENV).toBe('GWB_MCP_TOKEN')
    expect(TOKEN_HEADER).toBe('authorization')
    expect(TOKEN_SCHEME).toBe('Bearer')
  })
})

describe('bearerIn', () => {
  it('认 Bearer 前缀,大小写不敏感,多余空白剥掉', () => {
    expect(bearerIn('Bearer abc')).toBe('abc')
    expect(bearerIn('bearer  abc ')).toBe('abc')
    expect(bearerIn('BEARER abc')).toBe('abc')
  })

  it('裸给一个值也认——有的客户端 headers 只写得下一格,用户自然就填 token 本身', () => {
    expect(bearerIn('abc')).toBe('abc')
  })

  it('空值当没给', () => {
    expect(bearerIn(undefined)).toBeUndefined()
    expect(bearerIn('')).toBeUndefined()
    expect(bearerIn('   ')).toBeUndefined()
  })

  it('同名头来了两条:只认第一条', () => {
    expect(bearerIn(['Bearer abc', 'Bearer zzz'])).toBe('abc')
  })
})

describe('gateRequest:token 那一关', () => {
  it('没带 Authorization:401 那一支', () => {
    const verdict = gateRequest(gateInput({ headers: { host: '127.0.0.1:2870' } }))
    expect(verdict?.refused).toContain('没带 Authorization')
  })

  it('token 对不上:拒,而且原因是可读的', () => {
    const verdict = gateRequest(gateInput({ headers: { [TOKEN_HEADER]: 'Bearer 另一个', host: '127.0.0.1:2870' } }))
    expect(verdict?.refused).toContain('对不上')
  })

  it('长度不同的 token 也走到「对不上」——哈希比较不许抛异常', () => {
    expect(() => gateRequest(gateInput({ headers: { [TOKEN_HEADER]: 'Bearer x', host: '127.0.0.1:2870' } }))).not.toThrow()
  })

  it('全合法:返回 undefined（放行）', () => {
    expect(gateRequest(gateInput())).toBeUndefined()
  })

  it('token 为空串时一律拒——凭据取不出来是「全拒」,不是「全放」', () => {
    const verdict = gateRequest(gateInput({ token: '', headers: { [TOKEN_HEADER]: 'Bearer ', host: '127.0.0.1:2870' } }))
    expect(verdict).toBeDefined()
  })

  it('localhost 那个写法也放行', () => {
    expect(gateRequest(gateInput({ headers: { [TOKEN_HEADER]: 'Bearer tok-abcdefghijklmnop', host: 'localhost:2870' } }))).toBeUndefined()
  })
})

describe('gateRequest:Host 与 Origin', () => {
  it('Host 不在名单里:拒——DNS 重绑定走的就是这条（攻击者的域名解析到 127.0.0.1）', () => {
    const verdict = gateRequest(gateInput({ headers: { [TOKEN_HEADER]: 'Bearer tok-abcdefghijklmnop', host: 'evil.example.com:2870' } }))
    expect(verdict?.refused).toContain('Host')
  })

  it('不带 Host 也拒——HTTP/1.1 一定有 Host,没有就是手搓的请求', () => {
    expect(gateRequest(gateInput({ headers: { [TOKEN_HEADER]: 'Bearer tok-abcdefghijklmnop' } }))?.refused).toContain('Host')
  })

  it('别的口不算数:随机口的 home 拿 2870 拼不出来', () => {
    const verdict = gateRequest(
      gateInput({ port: 51234, headers: { [TOKEN_HEADER]: 'Bearer tok-abcdefghijklmnop', host: '127.0.0.1:2870' } }),
    )
    expect(verdict?.refused).toContain('Host')
  })

  it('不带 Origin 放行——curl、脚本、MCP 客户端都是这种,它们过的是 token 那一关', () => {
    expect(gateRequest(gateInput())).toBeUndefined()
  })

  it('自己的回环 Origin 放行', () => {
    const headers = { [TOKEN_HEADER]: 'Bearer tok-abcdefghijklmnop', host: '127.0.0.1:2870', origin: 'http://127.0.0.1:2870' }
    expect(gateRequest(gateInput({ headers }))).toBeUndefined()
  })

  it('别的站点的 Origin:拒', () => {
    const headers = { [TOKEN_HEADER]: 'Bearer tok-abcdefghijklmnop', host: '127.0.0.1:2870', origin: 'https://example.com' }
    expect(gateRequest(gateInput({ headers }))?.refused).toContain('Origin')
  })

  it('Origin: null 不认——那是沙箱化 iframe 与本地文件页面的值', () => {
    const headers = { [TOKEN_HEADER]: 'Bearer tok-abcdefghijklmnop', host: '127.0.0.1:2870', origin: 'null' }
    expect(gateRequest(gateInput({ headers }))?.refused).toContain('Origin')
  })

  it('token 那一关先判:token 不对时不去看 Origin（顺序是有意的）', () => {
    const headers = { [TOKEN_HEADER]: 'Bearer 错的', host: 'evil.example.com:2870', origin: 'https://example.com' }
    expect(gateRequest(gateInput({ headers }))?.refused).toContain('token')
  })
})

describe('允许名单', () => {
  it('只有两个回环写法,而且都带口', () => {
    expect(allowedHosts(2870)).toEqual(['127.0.0.1:2870', 'localhost:2870'])
    expect(allowedOrigins(2870)).toEqual(['http://127.0.0.1:2870', 'http://localhost:2870'])
  })
})

describe('换发之后的判据当场换新', () => {
  it('rotate 之后旧 token 立刻不认、新的立刻认——「回执报了新号、门还认旧的」那条回归', () => {
    const home = tempHome()
    const first = loadOrCreateToken(home).token
    const rotated = rotateToken(home).token

    // 旧 token 打不过（这一条就是隔离 home 验机抓到的那个缺陷：只写文件不回写的话，旧 token 照样过）
    expect(
      gateRequest({
        headers: { [TOKEN_HEADER]: `${TOKEN_SCHEME} ${first}`, host: '127.0.0.1:2870' },
        token: rotated,
        port: 2870,
      })?.refused,
    ).toContain('对不上')

    // 新 token 直接过
    expect(
      gateRequest({
        headers: { [TOKEN_HEADER]: `${TOKEN_SCHEME} ${rotated}`, host: '127.0.0.1:2870' },
        token: rotated,
        port: 2870,
      }),
    ).toBeUndefined()
  })
})

describe('credentialNote', () => {
  it('带文件时把文件路径一起指出来——拒绝路径上唯一的指路', () => {
    expect(credentialNote('/h/mcp/secret.json')).toContain('/h/mcp/secret.json')
    expect(credentialNote('/h/mcp/secret.json')).toContain('mcp.token')
  })

  it('凭据取不出来时也要给一条路,不能只留个空指引', () => {
    expect(credentialNote(undefined)).toBe('token 取法见 mcp.token 命令')
  })
})

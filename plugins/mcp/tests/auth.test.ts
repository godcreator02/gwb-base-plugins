import { describe, expect, it } from 'vitest'
import {
  allowedHosts,
  allowedOrigins,
  bearerIn,
  gateRequest,
  SECRET_DIR,
  SECRET_FILE,
  TOKEN_ENV,
  TOKEN_HEADER,
  TOKEN_SCHEME,
} from '../src/auth.js'
import { credentialNote } from '../src/index.js'

// 这里只测请求鉴权；凭据生成、迁移、持久化与轮换由 credentials/apply 测试覆盖。

/** 一次判据调用的默认入参：全合法，各用例只坏自己关心的那一格 */
function gateInput(over: Partial<Parameters<typeof gateRequest>[0]> = {}): Parameters<typeof gateRequest>[0] {
  return {
    headers: { [TOKEN_HEADER]: `${TOKEN_SCHEME} tok-abcdefghijklmnop`, host: '127.0.0.1:2870' },
    token: 'tok-abcdefghijklmnop',
    port: 2870,
    ...over,
  }
}

describe('凭据位置与协议常量', () => {
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

describe('credentialNote', () => {
  it('带文件时把文件路径一起指出来——拒绝路径上唯一的指路', () => {
    expect(credentialNote('/h/credentials.json')).toContain('/h/credentials.json')
    expect(credentialNote('/h/credentials.json')).toContain('mcp.token')
  })

  it('凭据取不出来时也要给一条路,不能只留个空指引', () => {
    expect(credentialNote(undefined)).toContain('onboard')
  })
})

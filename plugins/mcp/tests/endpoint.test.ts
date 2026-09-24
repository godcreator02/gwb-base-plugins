import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOME_PORT,
  choosePort,
  connectionInfo,
  defaultPort,
  endpointUrl,
  homeNameOf,
  mcpServers,
  type McpServerEntry,
} from '../src/endpoint.js'

describe('homeNameOf', () => {
  it('取末段——两种分隔符都认', () => {
    expect(homeNameOf('C:\\Users\\me\\AppData\\Roaming\\gwb-kernel\\homes\\default')).toBe('default')
    expect(homeNameOf('/home/me/.config/gwb-kernel/homes/probe')).toBe('probe')
  })

  it('末尾的分隔符先去掉——不然末段是空串,default 就认不出来了', () => {
    expect(homeNameOf('C:\\gwb\\homes\\default\\')).toBe('default')
    expect(homeNameOf('/gwb/homes/default//')).toBe('default')
  })

  it('没有分隔符时整串就是名字', () => {
    expect(homeNameOf('default')).toBe('default')
  })
})

describe('choosePort：default home', () => {
  it('不给配置就是 2870,而且被占时不换端口', () => {
    expect(choosePort('default')).toEqual({ port: DEFAULT_HOME_PORT, fallback: false })
    expect(DEFAULT_HOME_PORT).toBe(2870)
  })

  it('显式给了端口就用那个,照样不换——换了就是把会话送给占着端口的那个 home', () => {
    expect(choosePort('default', 3999)).toEqual({ port: 3999, fallback: false })
  })

  it('配置写坏了当没给,回到 2870', () => {
    expect(choosePort('default', 2870.5)).toEqual({ port: DEFAULT_HOME_PORT, fallback: false })
    expect(choosePort('default', -1)).toEqual({ port: DEFAULT_HOME_PORT, fallback: false })
    expect(choosePort('default', 70000)).toEqual({ port: DEFAULT_HOME_PORT, fallback: false })
    expect(choosePort('default', Number.NaN)).toEqual({ port: DEFAULT_HOME_PORT, fallback: false })
    // 设置插件不做运行时校验,什么形状都可能进来
    expect(choosePort('default', 'abc')).toEqual({ port: DEFAULT_HOME_PORT, fallback: false })
    expect(choosePort('default', null)).toEqual({ port: DEFAULT_HOME_PORT, fallback: false })
    expect(choosePort('default', { port: 1 })).toEqual({ port: DEFAULT_HOME_PORT, fallback: false })
  })

  it('数字串也认——界面上文本框写进来的就是串', () => {
    expect(choosePort('default', '3999')).toEqual({ port: 3999, fallback: false })
    expect(choosePort('probe', ' 2871 ')).toEqual({ port: 2871, fallback: true })
    expect(choosePort('probe', '')).toEqual({ port: 0, fallback: false })
  })
})

describe('defaultPort：port 设置的缺省', () => {
  it('default 是 2870,其它 home 是 0——跟 choosePort 不给配置时的答案一致', () => {
    expect(defaultPort('default')).toBe(DEFAULT_HOME_PORT)
    expect(defaultPort('probe')).toBe(0)
    expect(choosePort('default', defaultPort('default'))).toEqual(choosePort('default'))
    expect(choosePort('probe', defaultPort('probe'))).toEqual(choosePort('probe'))
  })
})

describe('choosePort：其它 home', () => {
  it('不给配置就用系统分配的端口——多个 home 同时运行是常态,没有哪个地址是它的契约', () => {
    expect(choosePort('probe')).toEqual({ port: 0, fallback: false })
    expect(choosePort('probe', 0)).toEqual({ port: 0, fallback: false })
  })

  it('显式给了端口就试那个,被占时可以换', () => {
    expect(choosePort('probe', 2871)).toEqual({ port: 2871, fallback: true })
  })

  it('叫 default 才是 default:名字沾边的不算', () => {
    expect(choosePort('default-2')).toEqual({ port: 0, fallback: false })
    expect(choosePort('Default')).toEqual({ port: 0, fallback: false })
  })

  it('配置写坏了当没给', () => {
    expect(choosePort('probe', Number.NaN)).toEqual({ port: 0, fallback: false })
  })
})

describe('endpointUrl', () => {
  it('主机名固定是 127.0.0.1——入口只服务本机', () => {
    expect(endpointUrl(2870)).toBe('http://127.0.0.1:2870/mcp')
  })
})

describe('mcpServers', () => {
  it('形状照 .mcp.json 标准,键是 gwb,带 Authorization 请求头', () => {
    expect(mcpServers(endpointUrl(2870), 'tok-abc')).toEqual({
      gwb: {
        type: 'http',
        url: 'http://127.0.0.1:2870/mcp',
        headers: { Authorization: 'Bearer tok-abc' },
      },
    })
  })

  it('url 原样写进片段——报的端口与片段里的端口必须一致', () => {
    const entry = mcpServers(endpointUrl(51234), 'tok-abc').gwb as McpServerEntry
    expect(entry.url).toBe(endpointUrl(51234))
  })
})

describe('connectionInfo：mcp.info 的回执', () => {
  it('片段里带 Authorization: Bearer <当前 token>,贴进客户端就能连', () => {
    const info = connectionInfo(2870, 'tok-abc', '/h/mcp/secret.json')
    expect(info.url).toBe('http://127.0.0.1:2870/mcp')
    expect(info.port).toBe(2870)
    expect(info.mcpServers).toEqual({
      gwb: { type: 'http', url: 'http://127.0.0.1:2870/mcp', headers: { Authorization: 'Bearer tok-abc' } },
    })
  })

  it('片段与 mcp.token 给的那份逐字一致——两条命令不许各拼各的', () => {
    expect(connectionInfo(51234, 'tok-abc', '/h/mcp/secret.json').mcpServers).toEqual(mcpServers(endpointUrl(51234), 'tok-abc'))
  })

  it('auth 指出凭据文件在哪、怎么换,但不重复 token 本体', () => {
    const info = connectionInfo(2870, 'tok-abc', '/h/mcp/secret.json')
    expect(info.auth).toContain('/h/mcp/secret.json')
    expect(info.auth).toContain('mcp.token {"rotate":true}')
    expect(info.auth).not.toContain('tok-abc')
  })
})

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOME_PORT,
  choosePort,
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

  it('末尾的分隔符先剥掉——不然末段是空串,default 就认不出来了', () => {
    expect(homeNameOf('C:\\gwb\\homes\\default\\')).toBe('default')
    expect(homeNameOf('/gwb/homes/default//')).toBe('default')
  })

  it('没有分隔符时整串就是名字', () => {
    expect(homeNameOf('default')).toBe('default')
  })
})

describe('choosePort：default home', () => {
  it('不给配置就是 2870,而且不退让', () => {
    expect(choosePort('default')).toEqual({ port: DEFAULT_HOME_PORT, fallback: false })
    expect(DEFAULT_HOME_PORT).toBe(2870)
  })

  it('显式给了口就用那个,照样不退让——退让就是把会话送给占口的那个 home', () => {
    expect(choosePort('default', 3999)).toEqual({ port: 3999, fallback: false })
  })

  it('配置写坏了当没给,回到 2870', () => {
    expect(choosePort('default', 2870.5)).toEqual({ port: DEFAULT_HOME_PORT, fallback: false })
    expect(choosePort('default', -1)).toEqual({ port: DEFAULT_HOME_PORT, fallback: false })
    expect(choosePort('default', 70000)).toEqual({ port: DEFAULT_HOME_PORT, fallback: false })
    expect(choosePort('default', Number.NaN)).toEqual({ port: DEFAULT_HOME_PORT, fallback: false })
    // 设置件不做运行时校验,什么形状都可能进来
    expect(choosePort('default', 'abc')).toEqual({ port: DEFAULT_HOME_PORT, fallback: false })
    expect(choosePort('default', null)).toEqual({ port: DEFAULT_HOME_PORT, fallback: false })
    expect(choosePort('default', { port: 1 })).toEqual({ port: DEFAULT_HOME_PORT, fallback: false })
  })

  it('数字串也认——界面上一格文本框写进来的就是串', () => {
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
  it('不给配置就是系统随机口——多 home 同开是常态,没有哪个串是它的契约', () => {
    expect(choosePort('probe')).toEqual({ port: 0, fallback: false })
    expect(choosePort('probe', 0)).toEqual({ port: 0, fallback: false })
  })

  it('显式给了口就试那个,被占许退让', () => {
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
  it('钉死 127.0.0.1——这道口只服务本机', () => {
    expect(endpointUrl(2870)).toBe('http://127.0.0.1:2870/mcp')
  })
})

describe('mcpServers', () => {
  it('形状照 .mcp.json 标准,键是 gwb', () => {
    expect(mcpServers(endpointUrl(2870), 'T0KEN')).toEqual({
      gwb: {
        type: 'http',
        url: 'http://127.0.0.1:2870/mcp',
        headers: { Authorization: 'Bearer T0KEN' },
      },
    })
  })

  it('url 原样搬进片段——报的口与片段里的口不许各是各的', () => {
    const entry = mcpServers(endpointUrl(51234), 'x'.repeat(43)).gwb as McpServerEntry
    expect(entry.url).toBe(endpointUrl(51234))
  })
})

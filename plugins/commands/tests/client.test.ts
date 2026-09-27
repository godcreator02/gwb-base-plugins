import { afterEach, describe, expect, it, vi } from 'vitest'
import { command } from '../src/client.js'

afterEach(() => vi.unstubAllGlobals())

describe('命令浏览器客户端', () => {
  it('通过请求通道传递名字和参数，原样返回成功与失败回执', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, data: 42 })
    vi.stubGlobal('window', { gwb: { request } })
    expect(await command<number>('sample', { a: 1 })).toEqual({ ok: true, data: 42 })
    expect(request).toHaveBeenCalledWith('commands.run', { name: 'sample', args: { a: 1 } })
    request.mockResolvedValue({ ok: false, error: 'failed' })
    expect(await command('sample')).toEqual({ ok: false, error: 'failed' })
  })

  it('只有命令通道不可用才转失败回执；其他传输异常保留拒绝', async () => {
    const request = vi.fn().mockRejectedValue(new Error('GWB_REQUEST_UNAVAILABLE: commands.run'))
    vi.stubGlobal('window', { gwb: { request } })
    expect(await command('sample')).toEqual({ ok: false, error: '没有命令服务，无法执行 sample' })
    request.mockRejectedValue(new Error('connection closed'))
    await expect(command('sample')).rejects.toThrow('connection closed')
    request.mockRejectedValue(new Error('GWB_REQUEST_UNAVAILABLE: another.channel'))
    await expect(command('sample')).rejects.toThrow('another.channel')
  })

  it('不把畸形回执当成成功', async () => {
    const request = vi.fn().mockResolvedValue({ ok: 'true' })
    vi.stubGlobal('window', { gwb: { request } })
    await expect(command('sample')).rejects.toThrow(/回执/)
    request.mockResolvedValue({ ok: false, error: 42 })
    await expect(command('sample')).rejects.toThrow(/回执/)
  })
})

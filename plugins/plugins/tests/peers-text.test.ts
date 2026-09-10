import { describe, expect, it } from 'vitest'
import { describePeers } from '../src/client/peers.js'

describe('装机回执里 peer 那一行', () => {
  it('一条 peer 都没声明就没有这一行', () => {
    expect(describePeers({ ok: true, pkg: 'x' })).toEqual({ line: '', ok: true })
    expect(describePeers(undefined)).toEqual({ line: '', ok: true })
    expect(describePeers({ peers: 'nope' })).toEqual({ line: '', ok: true })
  })

  it('装上的点名，本来就在与跳过的只报数', () => {
    const view = describePeers({
      peers: [
        { pkg: '@godcreator02/live-doc-cli', range: '>=0.4.0', action: 'installed' },
        { pkg: 'cordis', range: '^4', action: 'skipped' },
        { pkg: '@godcreator02/gwb-commands', range: '>=0.2.0', action: 'present' },
      ],
    })
    expect(view.ok).toBe(true)
    expect(view.line).toBe('\nPeer：装了 @godcreator02/live-doc-cli；2 条本来就在或用不着装')
  })

  it('有没装上的就点名，并把整条提示压成红的', () => {
    const view = describePeers({
      peers: [
        { pkg: 'good-lib', range: '>=1', action: 'installed' },
        { pkg: 'gone-lib', range: '>=1', action: 'failed', note: 'pnpm add gone-lib 没成' },
      ],
    })
    expect(view.ok).toBe(false)
    expect(view.line).toBe('\nPeer：装了 good-lib；没装上 gone-lib')
  })

  it('认不出的条目跳过，不因为一条坏格丢掉整行', () => {
    const view = describePeers({ peers: [null, { action: 'installed' }, { pkg: 'a', action: 'installed' }] })
    expect(view.line).toBe('\nPeer：装了 a')
  })
})

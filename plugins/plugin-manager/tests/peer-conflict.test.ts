import { describe, expect, it } from 'vitest'
import { describeAddFailure, peerConflictOf, UNTOUCHED } from '../src/peer-conflict.js'

/** pnpm 12.4.2 严格失败的原样输出（probes/2609181305_strict-peer/runs/a-flag.stdout.txt） */
const CONFLICT_OUTPUT = [
  '✓ Lockfile passes supply-chain policies (verified 908ms ago)',
  'Packages: +2',
  '++',
  'Progress: resolved 2, reused 10, downloaded 0, added 2, done',
  '[ERR_PNPM_PEER_DEP_ISSUES] Unmet peer dependencies',
  '',
  '✕ unmet peer @godcreator/gwb-shell',
  '  Installed: 0.7.2',
  '  Wanted:',
  '    >=0.8.0:',
  '      @godcreator/gwb-glm-quota@0.1.2',
  'hint: To disable failing on peer dependency issues, add the following to pnpm-workspace.yaml in your project root:',
  '',
  '  strictPeerDependencies: false',
  '',
].join('\r\n')

describe('认出 peer 冲突、截出说明', () => {
  it('截错误码之后、hint 之前，hint 那段不带', () => {
    expect(peerConflictOf(CONFLICT_OUTPUT)).toBe(
      ['✕ unmet peer @godcreator/gwb-shell', '  Installed: 0.7.2', '  Wanted:', '    >=0.8.0:', '      @godcreator/gwb-glm-quota@0.1.2'].join('\n'),
    )
  })

  it('带颜色码也认', () => {
    expect(peerConflictOf('\x1b[31m[ERR_PNPM_PEER_DEP_ISSUES]\x1b[39m Unmet\n✕ unmet peer a\nhint: x')).toBe('✕ unmet peer a')
  })

  it('别的失败不认', () => {
    expect(peerConflictOf('[ERR_PNPM_FETCH_404] GET https://x/nope: Not Found - 404')).toBeUndefined()
    expect(peerConflictOf('')).toBeUndefined()
  })

  it('只有错误码一行时回那一行', () => {
    expect(peerConflictOf('[ERR_PNPM_PEER_DEP_ISSUES] Unmet peer dependencies\nhint: x')).toBe('[ERR_PNPM_PEER_DEP_ISSUES] Unmet peer dependencies')
  })
})

describe('没成时的回执', () => {
  it('peer 冲突：说下一步、说 home 原样，尾巴换成冲突说明', () => {
    const conflict = peerConflictOf(CONFLICT_OUTPUT)
    const out = describeAddFailure('pnpm add @godcreator/gwb-glm-quota', { exitCode: 1, tail: 'hint: …', peerConflict: conflict, untouched: true })
    expect(out.error).toContain('被拒')
    expect(out.error).toContain('ERR_PNPM_PEER_DEP_ISSUES')
    expect(out.error).toContain('先把那个下游升上来')
    expect(out.error).toContain('plugin-manager.update-all {"only":[…]}')
    expect(out.error).toContain(UNTOUCHED)
    expect(out.tail).toBe(conflict)
    expect(out.peerConflict).toBe(conflict)
  })

  it('预检别的原因没成：照报退出码，也说 home 原样', () => {
    const out = describeAddFailure('pnpm add x', { exitCode: 1, tail: '404', untouched: true })
    expect(out).toEqual({ error: `pnpm add x 没成（预检，退出码 1）。${UNTOUCHED}`, tail: '404' })
  })

  it('过了预检、在 home 里真装才没成：不说 home 原样', () => {
    expect(describeAddFailure('pnpm add x', { exitCode: 1 })).toEqual({ error: 'pnpm add x 没成（退出码 1）' })
  })
})

import { describe, expect, it } from 'vitest'
import { findPnpmCjs, pnpmCjsIn, type Lookup } from '../src/pnpm-path.js'
import { tailLines } from '../src/pnpm.js'

/** 这台机器上的典型布局：npm 全局装的 pnpm */
const NPM_GLOBAL = 'C:\\Users\\me\\AppData\\Roaming\\npm'
const NPM_GLOBAL_CJS = `${NPM_GLOBAL}\\node_modules\\pnpm\\bin\\pnpm.cjs`

function win(files: readonly string[], extra: Partial<Lookup> = {}): Lookup {
  const set = new Set(files)
  return {
    delimiter: ';',
    sep: '\\',
    platform: 'win32',
    exists: (file) => set.has(file),
    ...extra,
  }
}

describe('从 PATH 里找 pnpm', () => {
  it('垫片旁边推出 pnpm.cjs', () => {
    const lookup = win([`${NPM_GLOBAL}\\pnpm.cmd`, NPM_GLOBAL_CJS], {
      pathEnv: `C:\\Windows\\system32;${NPM_GLOBAL}`,
    })
    expect(findPnpmCjs(lookup)).toEqual({ ok: true, cjs: NPM_GLOBAL_CJS, from: 'path' })
  })

  it('第一个命中的垫片推不出 cjs 时继续往后扫——corepack/volta 的垫片不是这个布局', () => {
    const lookup = win([`C:\\volta\\bin\\pnpm.cmd`, `${NPM_GLOBAL}\\pnpm.cmd`, NPM_GLOBAL_CJS], {
      pathEnv: `C:\\volta\\bin;${NPM_GLOBAL}`,
    })
    expect(findPnpmCjs(lookup)).toEqual({ ok: true, cjs: NPM_GLOBAL_CJS, from: 'path' })
  })

  it('PATH 里带引号的目录也认——Windows 上很常见', () => {
    const lookup = win([`${NPM_GLOBAL}\\pnpm.cmd`, NPM_GLOBAL_CJS], { pathEnv: `"${NPM_GLOBAL}"` })
    expect(findPnpmCjs(lookup)).toMatchObject({ ok: true, cjs: NPM_GLOBAL_CJS })
  })

  it('非 Windows 上找的是没扩展名的那个垫片', () => {
    const lookup: Lookup = {
      delimiter: ':',
      sep: '/',
      platform: 'linux',
      pathEnv: '/usr/local/bin',
      exists: (f) => new Set(['/usr/local/bin/pnpm', '/usr/local/bin/node_modules/pnpm/bin/pnpm.cjs']).has(f),
    }
    expect(findPnpmCjs(lookup)).toMatchObject({ ok: true, cjs: '/usr/local/bin/node_modules/pnpm/bin/pnpm.cjs' })
  })

  it('一条都不命中就回一句明确的错,指向设置项——不静默失败', () => {
    const result = findPnpmCjs(win([], { pathEnv: 'C:\\Windows\\system32' }))
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toMatch(/pnpm-path/)
  })

  it('PATH 整个没有也不炸', () => {
    expect(findPnpmCjs(win([])).ok).toBe(false)
  })
})

describe('设置项那一路', () => {
  it('直接填 pnpm.cjs', () => {
    const lookup = win([NPM_GLOBAL_CJS], { configured: NPM_GLOBAL_CJS })
    expect(findPnpmCjs(lookup)).toEqual({ ok: true, cjs: NPM_GLOBAL_CJS, from: 'setting' })
  })

  it('填 pnpm.cmd 那个垫片,从它旁边推', () => {
    const lookup = win([NPM_GLOBAL_CJS], { configured: `${NPM_GLOBAL}\\pnpm.cmd` })
    expect(findPnpmCjs(lookup)).toMatchObject({ ok: true, cjs: NPM_GLOBAL_CJS })
  })

  it('填垫片所在的那个目录也认', () => {
    const lookup = win([NPM_GLOBAL_CJS], { configured: NPM_GLOBAL })
    expect(findPnpmCjs(lookup)).toMatchObject({ ok: true, cjs: NPM_GLOBAL_CJS })
  })

  it('填了就不再回退去扫 PATH——填错了要当场看见,不是悄悄用了另一份', () => {
    const lookup = win([`${NPM_GLOBAL}\\pnpm.cmd`, NPM_GLOBAL_CJS], {
      configured: 'D:\\nope\\pnpm.cjs',
      pathEnv: NPM_GLOBAL,
    })
    const result = findPnpmCjs(lookup)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toMatch(/pnpm-path/)
  })

  it('空串当没填,照样走 PATH', () => {
    const lookup = win([`${NPM_GLOBAL}\\pnpm.cmd`, NPM_GLOBAL_CJS], { configured: '', pathEnv: NPM_GLOBAL })
    expect(findPnpmCjs(lookup)).toMatchObject({ from: 'path' })
  })
})

describe('推路径', () => {
  it('npm 全局那种布局', () => {
    expect(pnpmCjsIn(NPM_GLOBAL, '\\')).toBe(NPM_GLOBAL_CJS)
  })
})

describe('pnpm 输出留尾巴', () => {
  it('只留最后几行——pnpm 把原因放在最后', () => {
    const text = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
    expect(tailLines(text, 3)).toBe('line 37\nline 38\nline 39')
  })

  it('两头的空行削掉', () => {
    expect(tailLines('\n\na\nb\n\n\n', 10)).toBe('a\nb')
  })

  it('CRLF 归一', () => {
    expect(tailLines('a\r\nb\r\n', 10)).toBe('a\nb')
  })

  it('短的原样', () => {
    expect(tailLines('boom', 12)).toBe('boom')
  })

  it('全是空白时回空串', () => {
    expect(tailLines('\n \n', 12)).toBe('')
  })
})

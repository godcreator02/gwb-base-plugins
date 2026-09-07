import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasDist, normalizeDistName, STAMP_NAME, venvPaths, venvStaleReason } from '../src/bootstrap.js'

/**
 * 守卫的纯逻辑那一半。真去建 venv 的那半要起 uv 子进程,按件仓的分界线归实机验证。
 *
 * 用例里的目录名不是编的——是本件那个 py 项目真跑一趟 `uv sync` 之后
 * `site-packages` 下的样子。
 */

const ROOT = path.resolve('/tmp/some-plugin')

describe('包名归一化', () => {
  it('连字符、下划线、点一律折成下划线再小写', () => {
    expect(normalizeDistName('gwb-pycli-selftest')).toBe('gwb_pycli_selftest')
    expect(normalizeDistName('Foo.Bar_baz')).toBe('foo_bar_baz')
    // 连着几个分隔符折成一个,照 PyPA 那条规矩
    expect(normalizeDistName('a--b')).toBe('a_b')
  })
})

describe('site-packages 里装没装对', () => {
  // 实测:uv sync 之后就是这个名字
  const REAL = ['gwb_pycli_selftest-0.0.1.dist-info', '_editable_impl_gwb_pycli_selftest.pth', '_virtualenv.pth']

  it('认得出装着的那一个——包名带连字符,目录名带下划线', () => {
    expect(hasDist(REAL, 'gwb-pycli-selftest', '0.0.1')).toBe(true)
  })

  it('版本对不上就是没装对', () => {
    expect(hasDist(REAL, 'gwb-pycli-selftest', '0.0.2')).toBe(false)
  })

  it('名字对不上也是', () => {
    expect(hasDist(REAL, 'another-thing', '0.0.1')).toBe(false)
  })

  it('空表就是没装', () => {
    expect(hasDist([], 'gwb-pycli-selftest', '0.0.1')).toBe(false)
  })

  it('不是 dist-info 的目录不当数', () => {
    expect(hasDist(['gwb_pycli_selftest-0.0.1.egg-info'], 'gwb-pycli-selftest', '0.0.1')).toBe(false)
  })
})

describe('venv 新不新鲜', () => {
  const fresh = {
    venvExists: true,
    stamp: ROOT,
    packageRoot: ROOT,
    distInfoNames: ['gwb_pycli_selftest-0.0.1.dist-info'],
    distName: 'gwb-pycli-selftest',
    version: '0.0.1',
  }

  it('四条都对就是新鲜的', () => {
    expect(venvStaleReason(fresh)).toBeUndefined()
  })

  it('venv 不在', () => {
    expect(venvStaleReason({ ...fresh, venvExists: false })).toMatch(/还没建/)
  })

  it('没有出身记号——多半是连着包目录从别处拷来的', () => {
    expect(venvStaleReason({ ...fresh, stamp: undefined })).toContain(STAMP_NAME)
  })

  it('记号指着别处的包根', () => {
    const other = path.resolve('/tmp/another-plugin')
    expect(venvStaleReason({ ...fresh, stamp: other })).toMatch(/别处的包根/)
  })

  it('记号只是写法不同（尾斜杠之类）不算串门', () => {
    expect(venvStaleReason({ ...fresh, stamp: `${ROOT}${path.sep}` })).toBeUndefined()
  })

  it('版本对不上', () => {
    expect(venvStaleReason({ ...fresh, version: '0.0.2' })).toMatch(/装的不是/)
  })

  it('先判 venv 在不在——venv 都没有的时候不该去说版本不对', () => {
    expect(venvStaleReason({ ...fresh, venvExists: false, distInfoNames: [], stamp: undefined })).toMatch(/还没建/)
  })
})

describe('venv 的几个位置', () => {
  const p = venvPaths(ROOT)

  it('venv 落在包根的 py/ 底下——件装进 node_modules,venv 也就在 node_modules 里', () => {
    expect(p.projectDir).toBe(path.join(ROOT, 'py'))
    expect(p.venvDir).toBe(path.join(ROOT, 'py', '.venv'))
  })

  it('可执行文件在 Scripts,包在 Lib/site-packages——Windows 专属的两段', () => {
    expect(p.scriptsDir).toBe(path.join(p.venvDir, 'Scripts'))
    expect(p.sitePackages).toBe(path.join(p.venvDir, 'Lib', 'site-packages'))
  })

  it('出身记号在 venv 里面——跟 venv 同生共死,不留半状态', () => {
    expect(p.stampPath).toBe(path.join(p.venvDir, STAMP_NAME))
  })
})

// 用法：node run-seq.mjs <launcher: exe 或 .cjs> <空目录当 home> <输出 json>
// 照 plugin-manager 的调用序列跑一遍 pnpm，每步记退出码、stdout、stderr
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [launcher, home, outFile] = process.argv.slice(2)
fs.mkdirSync(home, { recursive: true })
fs.writeFileSync(path.join(home, 'package.json'), JSON.stringify({ name: 'gwb-home', private: true }, null, 2))

const steps = [
  ['--version'],
  ['config', 'get', '@godcreator:registry'],
  ['config', 'get', 'registry'],
  ['add', '@godcreator/gwb-plugin-manager@0.3.0'],
  ['add', '@godcreator/gwb-mcp@0.5.0'],
  ['outdated', '--json'],
  ['add', '@godcreator/gwb-plugin-manager@latest'],
  ['outdated', '--json'],
  ['add', '@godcreator/gwb-mcp@0.6.0'],
  ['outdated', '--json'],
  ['remove', '@godcreator/gwb-mcp'],
]

const isScript = /\.(c|m)?js$/.test(launcher)
const results = []
for (const args of steps) {
  const cmd = isScript ? process.execPath : launcher
  const argv = isScript ? [launcher, ...args] : args
  const t0 = Date.now()
  const r = spawnSync(cmd, argv, { cwd: home, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  results.push({ args: args.join(' '), exitCode: r.status, error: r.error ? String(r.error) : undefined, ms: Date.now() - t0, stdout: r.stdout, stderr: r.stderr })
  console.log(`${args.join(' ')} -> ${r.status}`)
}
results.push({ packageJson: fs.readFileSync(path.join(home, 'package.json'), 'utf8') })
fs.writeFileSync(outFile, JSON.stringify(results, null, 2))

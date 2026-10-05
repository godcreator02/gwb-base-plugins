import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const home = process.argv[2] ?? 'default'
if (!/^[a-z0-9][a-z0-9._-]*$/i.test(home)) throw new Error('Expected a home name')
const directory = path.join(process.env.APPDATA ?? path.join(os.homedir(), '.config'), 'gwb-kernel', 'homes', home)
const cli = fileURLToPath(new URL('../../plugins/mcp/bin/client.mjs', import.meta.url))
const command = (name) => {
  const value = JSON.parse(execFileSync(process.execPath, [cli, '--home', home, 'run', name], { encoding: 'utf8', windowsHide: true }))
  if (!value.ok) throw new Error(`${name} failed`)
  return value.data
}
const plugins = command('plugin-manager.list')
const credentials = command('credentials.list')
const settings = JSON.parse(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8'))
const checks = {
  allActive: plugins.every((plugin) => plugin.entries.every((entry) => entry.disabled || entry.active)),
  peersCompatible: plugins.every((plugin) => plugin.unmetPeers.length === 0),
  metadataOnly: !/"(?:value|default)"\s*:/.test(JSON.stringify(credentials)),
  ordinaryFileHasNoSecretValues: Object.values(settings).every((rows) => typeof rows !== 'object' || rows === null || Object.values(rows).every((slot) => typeof slot !== 'object' || slot === null || (slot.type !== 'secret' && slot.secret !== true) || (!Object.hasOwn(slot, 'value') && !Object.hasOwn(slot, 'default')))),
  credentialStoreExists: fs.existsSync(path.join(directory, 'credentials.json')),
}
console.log(JSON.stringify({ home, pluginCount: plugins.length, checks }, null, 2))
if (!Object.values(checks).every(Boolean)) process.exitCode = 1

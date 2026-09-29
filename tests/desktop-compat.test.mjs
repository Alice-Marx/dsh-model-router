import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'
import { OFFICIAL_TOOLS_REMOTE_DESCRIPTORS } from '../.dsh-plugin/shared/official-tools-remote.mjs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('published manifest passes the official 0.2.0-rc.1 Desktop compatibility gate', () => {
  assert.equal(evaluatePluginCompatibility(manifest, {}, '0.2.0-rc.1'), undefined)
  const oldPeers = Object.fromEntries(Object.keys(manifest.peerDependencies)
    .filter(name => name.startsWith('@deepseek-ai/dsh-'))
    .map(name => [name, '0.1.7-rc.2']))
  assert.ok(evaluatePluginCompatibility({ ...manifest, peerDependencies: oldPeers }, {}, '0.2.0-rc.1'))
})

test('typed remote methods avoid 0.2 client namespace service members', () => {
  const reserved = new Set(['ctx', 'empty', 'invokeRemote', 'methods', 'name',
    'namespace', 'install', 'installDirect', 'installScoped', 'has', 'assertMethodAvailable'])
  assert.ok(OFFICIAL_TOOLS_REMOTE_DESCRIPTORS.every(item => !reserved.has(item.method)))
  assert.ok(OFFICIAL_TOOLS_REMOTE_DESCRIPTORS.some(item => item.method === 'installTool'))
})

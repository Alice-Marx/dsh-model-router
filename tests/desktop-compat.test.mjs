import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'
import { OFFICIAL_TOOLS_REMOTE_DESCRIPTORS } from '../.dsh-plugin/shared/official-tools-remote.mjs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const appBootManifest = JSON.parse(readFileSync(
  new URL('../node_modules/@deepseek-ai/dsh-app-boot/package.json', import.meta.url),
  'utf8',
))
const DSH_PEER_PREFIX = '@deepseek-ai/dsh-'
const SUPPORTED_DESKTOP_PEERS = '0.2.0-rc.1 || 0.2.0-rc.2'
const dshPeerNames = Object.keys(manifest.peerDependencies)
  .filter(name => name.startsWith(DSH_PEER_PREFIX))

function withDshPeers(version, range) {
  return {
    ...manifest,
    version,
    peerDependencies: {
      ...manifest.peerDependencies,
      ...Object.fromEntries(dshPeerNames.map(name => [name, range])),
    },
  }
}

function assertRejected(candidate, runtimeVersion) {
  const issue = evaluatePluginCompatibility(candidate, {}, runtimeVersion)
  assert.ok(issue, `${candidate.version} must be rejected by Desktop ${runtimeVersion}`)
  assert.equal(issue.exempted, false)
  return issue
}

test('0.12.0 declares exactly the two supported 0.2 release candidates', () => {
  assert.equal(manifest.version, '0.13.0')
  assert.ok(dshPeerNames.length > 0)
  for (const name of dshPeerNames) {
    assert.equal(manifest.peerDependencies[name], SUPPORTED_DESKTOP_PEERS)
  }

  for (const runtimeVersion of ['0.2.0-rc.1', '0.2.0-rc.2']) {
    assert.equal(evaluatePluginCompatibility(manifest, {}, runtimeVersion), undefined)
  }

  for (const runtimeVersion of ['0.2.0-rc.3', '0.2.0', '0.3.0', '1.0.0']) {
    assertRejected(manifest, runtimeVersion)
  }
})

test('the installed rc.2 app-boot gate accepts the release manifest', () => {
  assert.equal(appBootManifest.version, '0.2.0-rc.2')
  assert.equal(evaluatePluginCompatibility(manifest, {}, appBootManifest.version), undefined)
})

test('the 0.10.1 rc.1-only manifest is rejected by Desktop rc.2 without an exemption', () => {
  const oldManifest = withDshPeers('0.10.1', '0.2.0-rc.1')
  const issue = assertRejected(oldManifest, '0.2.0-rc.2')
  assert.deepEqual(Object.keys(issue.peers).sort(), [...dshPeerNames].sort())
})

test('the 0.8 0.1.7-rc.2-only manifest is rejected by both 0.2 Desktop hosts', () => {
  const legacyManifest = withDshPeers('0.8.0', '0.1.7-rc.2')
  for (const runtimeVersion of ['0.2.0-rc.1', '0.2.0-rc.2']) {
    const issue = assertRejected(legacyManifest, runtimeVersion)
    assert.deepEqual(Object.keys(issue.peers).sort(), [...dshPeerNames].sort())
  }
})

test('typed remote methods avoid 0.2 client namespace service members', () => {
  const reserved = new Set(['ctx', 'empty', 'invokeRemote', 'methods', 'name',
    'namespace', 'install', 'installDirect', 'installScoped', 'has', 'assertMethodAvailable'])
  assert.ok(OFFICIAL_TOOLS_REMOTE_DESCRIPTORS.every(item => !reserved.has(item.method)))
  assert.ok(OFFICIAL_TOOLS_REMOTE_DESCRIPTORS.some(item => item.method === 'installTool'))
})

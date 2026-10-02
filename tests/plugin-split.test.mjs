import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { OFFICIAL_TOOLS_REMOTE_DESCRIPTORS, OFFICIAL_TOOLS_REMOTE_NAMESPACE } from '../.dsh-plugin/shared/official-tools-remote.mjs'
import { OfficialToolsRemoteService } from '../.dsh-plugin/official-tools-remote-service.mjs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const manifest = JSON.parse(read('package.json'))

test('router upgrade retains its package identity and contains no GAL payload', () => {
  assert.equal(manifest.name, '@ljwei-stak/model-router-galgame')
  assert.equal(manifest.version, '0.12.0')
  assert.ok(manifest.files.every(file => !/gal-story|gal-module|GAL_|ECHO_CITY|aipicture|gal-.*preview/.test(file)))
  const client = read('.dsh-plugin/client/official-harness.jsx')
  assert.match(client, /export const ROUTER_NAMESPACE = 'model-router-galgame'/)
  assert.doesNotMatch(client, /GalModulePage|GAL_PANEL|cancelGalReply|galReply/)
  const bundle = read('.dsh-plugin/client.js')
  assert.ok(Buffer.byteLength(bundle) < 1_000_000, 'router must not embed GAL art')
  assert.doesNotMatch(bundle, /data:image\/(?:png|webp)|echo-chronicle|model-router:gal-story:v1/)
})

test('router remote retains installer methods and owns no GAL endpoints', () => {
  assert.equal(OFFICIAL_TOOLS_REMOTE_NAMESPACE, 'modelRouterOfficialTools')
  assert.deepEqual(OFFICIAL_TOOLS_REMOTE_DESCRIPTORS.map(item => item.method), ['list', 'installTool', 'cancel', 'status'])
  assert.equal(OfficialToolsRemoteService.prototype.galReply, undefined)
  assert.equal(OfficialToolsRemoteService.prototype.cancelGalReply, undefined)
})

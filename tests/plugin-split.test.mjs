import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { OFFICIAL_TOOLS_REMOTE_DESCRIPTORS, OFFICIAL_TOOLS_REMOTE_NAMESPACE } from '../.dsh-plugin/shared/official-tools-remote.mjs'
import { OfficialToolsRemoteService } from '../.dsh-plugin/official-tools-remote-service.mjs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const manifest = JSON.parse(read('package.json'))

test('router upgrade retains its package identity and contains no GAL payload', () => {
  assert.equal(manifest.name, '@ljwei-stak/dsh-model-router')
  assert.equal(manifest.version, '0.16.2')
  assert.ok(manifest.files.every(file => !/gal-story|gal-module|GAL_|ECHO_CITY|aipicture|gal-.*preview/.test(file)))
  const client = read('.dsh-plugin/client/official-harness.jsx')
  assert.match(client, /export const ROUTER_NAMESPACE = 'model-router-galgame'/)
  assert.doesNotMatch(client, /GalModulePage|GAL_PANEL|cancelGalReply|galReply/)
  const bundle = read('.dsh-plugin/client.js')
  assert.ok(Buffer.byteLength(bundle) < 1_000_000, 'router must not embed GAL art')
  assert.doesNotMatch(bundle, /data:image\/(?:png|webp)|echo-chronicle|model-router:gal-story:v1/)
})

test('0.13.0 package rename: the loader imports the new name, the profile entry id stays for existing settings', async () => {
  const patch = read('cordis.patch.yml')
  assert.match(patch, /^\s+- id: model-router-galgame$/m, 'entry id kept so saved settings and panel state still apply')
  assert.match(patch, new RegExp(`^\\s+name: '${manifest.name.replace('/', '\\/')}'$`, 'm'), 'inserted row must import this package')
  assert.doesNotMatch(patch, /name: '@ljwei-stak\/model-router-galgame'/)
  const client = read('.dsh-plugin/client/official-harness.jsx')
  assert.match(client, new RegExp(`export const ROUTER_PACKAGE = '${manifest.name}'`))
  assert.match(client, /export const ROUTER_PANEL = 'model-router-galgame'/)
  const { OFFICIAL_TOOLS_REMOTE_PACKAGE } = await import('../.dsh-plugin/shared/official-tools-remote.mjs')
  const { ROUTER_PACKAGE_NAME } = await import('../.dsh-plugin/shared/npm-update.mjs')
  assert.equal(OFFICIAL_TOOLS_REMOTE_PACKAGE, manifest.name)
  assert.equal(ROUTER_PACKAGE_NAME, manifest.name, 'update checks query the renamed package')
  const host = await import('../.dsh-plugin/index.mjs')
  assert.equal(host.name, 'model-router-galgame')
})

test('router remote retains installer methods and owns no GAL endpoints', () => {
  assert.equal(OFFICIAL_TOOLS_REMOTE_NAMESPACE, 'modelRouterOfficialTools')
  assert.deepEqual(OFFICIAL_TOOLS_REMOTE_DESCRIPTORS.map(item => item.method), [
    'list', 'installTool', 'cancel', 'status',
    'health', 'completeOnboarding', 'ledger', 'rateResult', 'rerunStep', 'boundaries', 'previewRun', 'startRun',
    'terminalInfo', 'terminalStart', 'terminalRead', 'terminalWrite', 'terminalResize', 'terminalStop',
  ])
  for (const method of ['terminalInfo', 'terminalStart', 'terminalRead', 'terminalWrite', 'terminalResize', 'terminalStop']) {
    assert.equal(typeof OfficialToolsRemoteService.prototype[method], 'function', method)
  }
  assert.equal(OfficialToolsRemoteService.prototype.galReply, undefined)
  assert.equal(OfficialToolsRemoteService.prototype.cancelGalReply, undefined)
})

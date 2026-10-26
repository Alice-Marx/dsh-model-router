import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve, join } from 'node:path'
import { combinedOverlay, isolatedHostEnvironment } from '../scripts/integration-combined-host.mjs'

test('integration: launched host cannot inherit model credentials or the user profile', () => {
  const home = resolve('tmp/integration/environment-fixture')
  const env = isolatedHostEnvironment(home, resolve('tmp/integration/resolver-fixture'), {
    PATH: '/fixture/bin', SystemRoot: 'C:/Windows', HOME: '/real-home', USERPROFILE: 'C:/real-profile',
    APPDATA: 'C:/real-profile/appdata', OPENAI_API_KEY: 'fixture-sentinel', ANTHROPIC_API_KEY: 'fixture-sentinel',
    NODE_OPTIONS: '--require /untrusted-preload', GH_TOKEN: 'fixture-sentinel',
  })
  for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'NODE_OPTIONS', 'GH_TOKEN']) assert.equal(key in env, false)
  assert.equal(env.HOME, home)
  assert.equal(env.USERPROFILE, home)
  assert.equal(env.DSH_HOME, home)
  assert.equal(env.APPDATA, join(home, 'appdata'))
  assert.equal(env.PATH, '/fixture/bin')
})

test('integration: combined profile keeps model selection offline and telemetry disabled', () => {
  const overlay = combinedOverlay(resolve('tmp/integration/offline-model.mjs'))
  const selected = overlay.find(entry => entry.id === 'agent-default-model').config
  assert.equal(`${selected.provider}/${selected.model}`, 'integration-gpt-fixture/gpt-fixture')
  for (const id of ['llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai', 'session-telemetry-otel', 'session-title-llm']) {
    assert.equal(overlay.find(entry => entry.id === id)?.disabled, true)
  }
  assert.equal(overlay.find(entry => entry.id === 'bot').config.updateCheck, false)
  assert.match(overlay.at(-1).insert[0].name, /^file:/)
})

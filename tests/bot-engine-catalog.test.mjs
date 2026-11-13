// Closed-catalog tests for the 26 upstream OpenMausBot bot-engine drivers.
// Pure module tests: no child processes, no network, no filesystem writes.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BOT_ENGINE_DRIVERS, BOT_ENGINE_DRIVER_IDS, UPSTREAM_SOURCE,
  assertNoAdHocDriverInput, getBotEngineDriver, listBotEngineDrivers, resolveBotEngine,
} from '../packages/bot-engines/src/driver-catalog.mjs'

const EXPECTED_IDS = [
  'grok', 'groq', 'mistral', 'cerebras', 'greenference', 'meta', 'minimax', 'openai-compat',
  'claude', 'codex', 'museCode', 'pi', 'antigravityAgent', 'grokAgent', 'geminiAgent',
  'kimiAgent', 'droidAgent', 'cursorAgent', 'opencodeGo', 'qwenAgent', 'hermesAgent',
  'clineAgent', 'copilotAgent', 'commandCodeAgent', 'customAcp', 'deepseekAgent',
]

describe('bot-engine driver catalog', () => {

  test('is exactly the 26 upstream built-in drivers', () => {
    assert.equal(BOT_ENGINE_DRIVERS.length, 26)
    assert.equal(BOT_ENGINE_DRIVER_IDS.length, 26)
    assert.deepEqual([...BOT_ENGINE_DRIVER_IDS], EXPECTED_IDS)
    assert.equal(new Set(BOT_ENGINE_DRIVER_IDS).size, 26, 'ids must be unique')
  })

  test('records the upstream pin it was verified against', () => {
    assert.equal(UPSTREAM_SOURCE.project, 'OpenMausBot')
    assert.equal(UPSTREAM_SOURCE.pin, '1bc4749aa8307d7d6998bf86de4ef6478460dd93')
    assert.equal(UPSTREAM_SOURCE.license, 'Apache-2.0')
    assert.match(UPSTREAM_SOURCE.builtInList, /server\/drivers\/builtIn\.ts/)
  })

  test('every driver carries verifiable upstream evidence', () => {
    for (const driver of BOT_ENGINE_DRIVERS) {
      assert.equal(typeof driver.id, 'string', `${driver.id}: id`)
      assert.equal(typeof driver.name, 'string', `${driver.id}: name`)
      assert.ok(driver.kind === 'api-provider' || driver.kind === 'conversation-engine', `${driver.id}: kind`)
      const evidence = driver.evidence
      assert.equal(typeof evidence.file, 'string', `${driver.id}: evidence.file`)
      assert.match(evidence.file, /^server\/drivers\//, `${driver.id}: evidence file must live under server/drivers`)
      for (const key of ['modelSelection', 'credentials', 'session', 'permissions', 'usage']) {
        assert.equal(typeof evidence[key], 'string', `${driver.id}: evidence.${key}`)
        assert.notEqual(evidence[key].trim(), '', `${driver.id}: evidence.${key} must not be empty`)
      }
      assert.ok(['implemented', 'unavailable'].includes(driver.availability), `${driver.id}: availability`)
      if (driver.availability === 'unavailable') {
        assert.equal(typeof driver.availabilityReason, 'string', `${driver.id}: reason`)
        assert.ok(driver.availabilityReason.length > 40, `${driver.id}: reason must be explicit, not a label`)
        assert.equal(typeof driver.targetCapability, 'string', `${driver.id}: targetCapability`)
        assert.notEqual(driver.targetCapability, '', `${driver.id}: targetCapability non-empty`)
      } else {
        assert.equal(driver.availabilityReason, null)
        assert.equal(typeof driver.implementation, 'string')
      }
      assert.ok(Object.isFrozen(driver), `${driver.id}: entry frozen`)
    }
  })

  test('sixteen concrete native drivers are implemented and special constraints stay explicit', () => {
    const implemented = BOT_ENGINE_DRIVERS.filter(driver => driver.availability === 'implemented')
    assert.equal(implemented.length, 16)
    for (const id of ['codex', 'pi', 'museCode', 'cursorAgent', 'kimiAgent', 'opencodeGo', 'hermesAgent']) assert.ok(implemented.some(driver => driver.id === id), id)
    assert.equal(implemented[0].implementation, 'src/claude-engine.mjs')
    assert.match(implemented[0].transport, /stream-json/)
    assert.equal(implemented[0].evidence.file, 'server/drivers/claude.ts')
  })

  test('classifies the 8 stateless API providers separately from conversation engines', () => {
    const apiProviders = BOT_ENGINE_DRIVERS.filter(driver => driver.kind === 'api-provider')
    assert.deepEqual(apiProviders.map(driver => driver.id).sort(),
      ['cerebras', 'greenference', 'grok', 'groq', 'meta', 'minimax', 'mistral', 'openai-compat'])
    for (const driver of apiProviders) {
      assert.match(driver.availabilityReason, /API provider channel/, `${driver.id}: routed to the Host model channel`)
      assert.match(driver.availabilityReason, /Host model-routing/i, `${driver.id}: no session process`)
      assert.equal(driver.targetCapability, 'api-provider-channel', `${driver.id}: target capability`)
    }
    const engines = BOT_ENGINE_DRIVERS.filter(driver => driver.kind === 'conversation-engine')
    assert.equal(engines.length, 18)
  })

  test('ACP engines resolve through the retained protocol adapter', () => {
    for (const id of ['grokAgent', 'geminiAgent', 'kimiAgent', 'droidAgent', 'cursorAgent', 'opencodeGo', 'qwenAgent', 'hermesAgent', 'clineAgent', 'copilotAgent', 'commandCodeAgent', 'customAcp']) {
      const driver = getBotEngineDriver(id)
      assert.equal(driver.availability, 'implemented', id)
      assert.equal(driver.implementation, 'src/acp-chat-engine.mjs', id)
    }
  })

  test('codex, museCode and pi each have a concrete native protocol implementation', () => {
    for (const id of ['codex', 'museCode', 'pi']) {
      const driver = getBotEngineDriver(id)
      assert.equal(driver.availability, 'implemented', id)
      assert.equal(driver.targetCapability, 'native-chat-engine', id)
    }
    assert.match(getBotEngineDriver('codex').implementation, /codex-engine/)
    assert.match(getBotEngineDriver('museCode').implementation, /muse-engine/)
  })

  test('customAcp is implemented but managed runtime and API-only funding constraints remain unavailable', () => {
    const driver = getBotEngineDriver('customAcp')
    assert.equal(driver.availability, 'implemented')
    assert.match(getBotEngineDriver('antigravityAgent').availabilityReason, /harness/)
    assert.match(getBotEngineDriver('deepseekAgent').availabilityReason, /API/)
  })

  test('geminiAgent records the consumer-login retirement', () => {
    assert.match(getBotEngineDriver('geminiAgent').evidence.credentials, /2026-06-18/)
  })

  test('unknown ids do not resolve', () => {
    assert.equal(getBotEngineDriver('gpt4direct'), undefined)
    assert.equal(getBotEngineDriver(''), undefined)
    assert.equal(getBotEngineDriver(null), undefined)
    assert.equal(getBotEngineDriver('CLAUDE'), undefined, 'case sensitive')
  })

  test('listBotEngineDrivers returns defensive copies', () => {
    const listing = listBotEngineDrivers()
    assert.equal(listing.length, 26)
    const copy = listing.find(driver => driver.id === 'claude')
    assert.ok(Object.isFrozen(copy))
    assert.throws(() => { copy.id = 'mutated' }, TypeError, 'frozen copies refuse writes')
    assert.equal(getBotEngineDriver('claude').id, 'claude', 'catalog itself never mutated')
  })
})

describe('assertNoAdHocDriverInput', () => {

  test('refuses every Host-owned key outright', () => {
    for (const key of ['executable', 'path', 'command', 'cmd', 'endpoint', 'url', 'baseUrl', 'args', 'argv',
      'env', 'environment', 'credentials', 'apiKey', 'token', 'autoApprove', 'alwaysAllow', 'bypassPermissions']) {
      assert.throws(() => assertNoAdHocDriverInput({ driver: 'claude', [key]: 'x' }),
        { name: 'TypeError', message: new RegExp(`HOST_OWNED_ENGINE_INPUT: ${key}`) }, key)
    }
  })

  test('accepts a plain driver id request', () => {
    assert.equal(assertNoAdHocDriverInput({ driver: 'claude' }), true)
  })
})

describe('resolveBotEngine', () => {

  test('claude resolves to the engine factory', async () => {
    const resolved = await resolveBotEngine({ driver: 'claude' })
    assert.equal(resolved.status, 'ready')
    assert.equal(resolved.driver, 'claude')
    assert.equal(typeof resolved.createEngine, 'function')
  })

  test('unimplemented drivers return explicit unavailable verdicts', async () => {
    for (const id of ['antigravityAgent', 'deepseekAgent', 'grok']) {
      const resolved = await resolveBotEngine({ driver: id })
      assert.equal(resolved.status, 'unavailable', id)
      assert.equal(typeof resolved.reason, 'string', id)
      assert.ok(resolved.reason.length > 40, `${id}: reason must be substantive`)
    }
  })

  test('unknown driver ids are an error, not a silent fallback', async () => {
    await assert.rejects(() => resolveBotEngine({ driver: 'myOwnCli' }), /UNKNOWN_BOT_ENGINE_DRIVER/)
    await assert.rejects(() => resolveBotEngine(null), TypeError)
    await assert.rejects(() => resolveBotEngine('claude'), TypeError)
    await assert.rejects(() => resolveBotEngine([]), TypeError)
  })

  test('requests carrying executables or credentials are refused before any lookup', async () => {
    await assert.rejects(() => resolveBotEngine({ driver: 'claude', executable: 'C:/tools/cli.exe' }), /HOST_OWNED_ENGINE_INPUT: executable/)
    await assert.rejects(() => resolveBotEngine({ driver: 'claude', apiKey: 'sk-x' }), /HOST_OWNED_ENGINE_INPUT: apiKey/)
  })
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { resolve, join } from 'node:path'
import Database from 'better-sqlite3'
import { openBotRoutingSettings } from '../packages/orchestration/src/bot-routing-settings.mjs'

test('owner routing switch persists and stale writes cannot silently replace a newer choice', () => {
  const parent = resolve('tmp/integration/routing-settings'); mkdirSync(parent, { recursive: true })
  const file = join(mkdtempSync(join(parent, 'case-')), 'host.sqlite')
  const first = openBotRoutingSettings({ Database, file, initial: { enabled: false } })
  const second = openBotRoutingSettings({ Database, file })
  try {
    assert.equal(first.get().settings.enabled, false)
    const saved = first.save({ expectedRevision: 0, settings: { enabled: true, preset: 'quality' } }, { kind: 'owner' })
    assert.equal(saved.revision, 1); assert.equal(second.get().settings.preset, 'quality')
    assert.throws(() => second.save({ expectedRevision: 0, settings: { enabled: false } }, { kind: 'owner' }), { code: 'BOT_ROUTING_SETTINGS_CONFLICT' })
    assert.throws(() => first.save({ expectedRevision: 1, settings: { enabled: false } }, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
    assert.equal(second.get().settings.enabled, true)
  } finally { first.close(); second.close() }
  const restored = openBotRoutingSettings({ Database, file })
  try { assert.equal(restored.get().settings.enabled, true); assert.equal(restored.get().revision, 1) } finally { restored.close() }
})

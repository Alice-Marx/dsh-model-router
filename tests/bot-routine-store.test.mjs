import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBotRoutineStore } from '../packages/orchestration/src/bot-routine-store.mjs'

const make = () => createBotRoutineStore({ dir: mkdtempSync(join(tmpdir(), 'routine-store-')) })
const code = expected => error => { assert.equal(error.code, expected, error.message); return true }
const routine = { name: '打开设置', steps: [{ action: 'click', x: 1, y: 2 }] }

test('store: a saved routine comes back with steps intact', () => {
  const store = make()
  const saved = store.save('bot-a', routine)
  assert.match(saved.id, /^routine-/)
  const rows = store.list('bot-a')
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].steps, routine.steps)
  assert.equal(store.get('bot-a', saved.id).name, '打开设置')
})

test('store: each Bot keeps its own routines', () => {
  const store = make()
  store.save('bot-a', routine)
  assert.equal(store.list('bot-b').length, 0)
  store.save('bot-b', { name: 'b', steps: [{ action: 'type', text: 'x' }] })
  assert.equal(store.list('bot-a').length, 1)
  assert.equal(store.list('bot-b').length, 1)
})

test('store: an invalid routine or bot id is refused before anything is written', () => {
  const store = make()
  assert.throws(() => store.save('bot-a', { name: '', steps: [] }), code('ROUTINE_NAME_INVALID'))
  assert.throws(() => store.save('bot-a', { name: 'x', steps: [{ action: 'shell' }] }), code('ROUTINE_ACTION_UNKNOWN'))
  assert.throws(() => store.save('../evil', routine), code('ROUTINE_BOT_ID_INVALID'))
  assert.equal(store.list('bot-a').length, 0)
})

test('store: removal is explicit and a missing id says so', () => {
  const store = make()
  const saved = store.save('bot-a', routine)
  store.remove('bot-a', saved.id)
  assert.equal(store.list('bot-a').length, 0)
  assert.throws(() => store.remove('bot-a', saved.id), code('ROUTINE_NOT_FOUND'))
  assert.throws(() => store.get('bot-a', 'ghost'), code('ROUTINE_NOT_FOUND'))
})

test('store: a corrupt file reads as empty and the next save repairs it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'routine-store-'))
  const store = createBotRoutineStore({ dir })
  writeFileSync(store.file, '{ not json')
  assert.deepEqual(store.list('bot-a'), [])
  store.save('bot-a', routine)
  const parsed = JSON.parse(readFileSync(store.file, 'utf8'))
  assert.equal(parsed.schemaVersion, 1)
  assert.equal(parsed.bots['bot-a'].length, 1)
})

test('store: inspect reports validity and step counts without handing out a bad routine', () => {
  const store = make()
  store.save('bot-a', routine)
  const [row] = store.inspect('bot-a')
  assert.equal(row.steps, 1)
  assert.equal(row.valid, true)
  assert.equal(row.withinLimit, true)
})

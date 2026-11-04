import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBotLibrary } from '../packages/orchestration/src/bot-library.mjs'
import { libraryRoot, registerLibraryTools } from '../.dsh-plugin/shared/library-tools.mjs'

const jsonOutput = { schema: { type: 'json' }, render: () => [] }
const jsonValue = value => JSON.parse(JSON.stringify(value))

function harness({ callerBotId = null, passthrough = undefined } = {}) {
  const registered = new Map()
  const ctx = {
    get: name => (name === 'botIdForAgent' ? () => callerBotId : undefined),
    tools: { register: definition => { registered.set(definition.name, definition); return definition } },
  }
  const config = passthrough === undefined ? {} : { operatorPassthrough: { enabled: passthrough } }
  const registerPolicyTool = (_ctx, _config, definition) => ctx.tools.register(definition)
  const root = mkdtempSync(join(tmpdir(), 'lib-tools-'))
  const library = createBotLibrary({ root, fs })
  registerLibraryTools({ ctx, config, defineTool: definition => definition, registerPolicyTool, library, jsonOutput, jsonValue, stateDir: root })
  const call = async (name, args) => {
    const definition = registered.get(name)
    assert.ok(definition, `${name} registered`)
    return definition.execute(args, { agent: { id: 'agent-1' } })
  }
  return { call, registered, root, library }
}

test('tools: list, write and read one Bot library through the tool surface', async () => {
  const { call } = harness()
  await call('bot_library_write', { botId: 'bot-a', relativePath: 'notes/a.md', content: 'hello' })
  const listed = await call('bot_library_list', { botId: 'bot-a', relativePath: 'notes' })
  assert.deepEqual(listed.entries.map(row => row.name), ['a.md'])
  const read = await call('bot_library_read', { botId: 'bot-a', relativePath: 'notes/a.md' })
  assert.equal(read.content, 'hello')
})

test('tools: a Bot that can be identified may only touch its own library', async () => {
  const { call } = harness({ callerBotId: 'bot-a' })
  await call('bot_library_write', { botId: 'bot-a', relativePath: 'x.md', content: 'ok' })
  await assert.rejects(call('bot_library_read', { botId: 'bot-b', relativePath: 'x.md' }), error => error.code === 'LIBRARY_BOT_MISMATCH')
})

test('tools: an unidentifiable session is refused when the operator passthrough is off', async () => {
  const { call } = harness({ passthrough: false })
  await assert.rejects(call('bot_library_list', { botId: 'bot-a' }), error => error.code === 'LIBRARY_OPERATOR_DISABLED')
})

test('tools: an invalid bot id is refused before the library is touched', async () => {
  const { call } = harness()
  return assert.rejects(async () => call('bot_library_list', { botId: '../etc' }), error => error.code === 'LIBRARY_BOT_ID_INVALID')
})

test('tools: the library root sits beside the router state', () => {
  assert.equal(libraryRoot('/state'), join('/state', 'bot-library'))
})

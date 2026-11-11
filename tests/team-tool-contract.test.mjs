import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTeamToolArgs, projectCoordinateArgs, teamToolEntry, TEAM_TOOL_NAMES, threadReferenceOk,
  TEAM_CODES, MAX_MESSAGE_CHARS, MAX_DONE_WHEN_CHARS, MAX_TARGETS,
} from '../packages/orchestration/src/team-tool-contract.mjs'

const coded = fn => { try { fn() } catch (error) { return error } return null }

test('the contract names exactly the four team tools with both schema shapes', () => {
  assert.deepEqual([...TEAM_TOOL_NAMES], ['coordinate_bots', 'assignment_status', 'list_bots', 'list_threads'])
  for (const name of TEAM_TOOL_NAMES) {
    const entry = teamToolEntry(name)
    assert.equal(entry.inputSchema.type, 'object')
    assert.equal(entry.inputSchema.additionalProperties, false)
    assert.equal(typeof entry.description, 'string')
    assert.ok(entry.description.length > 0)
  }
  // bot_ids is a bounded unique array in the SDK map and a real array schema for MCP.
  const coordinate = teamToolEntry('coordinate_bots')
  assert.equal(coordinate.parameters.bot_ids.type, 'array')
  assert.equal(coordinate.inputSchema.properties.bot_ids.maxItems, MAX_TARGETS)
  assert.equal(coordinate.inputSchema.properties.bot_ids.minItems, 1)
})

test('coordinate_bots accepts a valid call and projects business args only', () => {
  const parsed = parseTeamToolArgs('coordinate_bots', { bot_ids: ['a', 'b'], message: 'do it', reply: 'none', consult: true })
  assert.deepEqual(parsed.bot_ids, ['a', 'b'])
  const projected = projectCoordinateArgs({ bot_ids: ['a'], message: '  hi\r\nthere  ', reply: 'none' })
  assert.deepEqual(projected, { targets: ['a'], message: 'hi\nthere', thread: 'standing', reply: 'none', consult: false, rework: false })
})

test('coordinate_bots refuses authority keys, wrong types, bad enums, over-bounds and duplicates', () => {
  assert.equal(coded(() => parseTeamToolArgs('coordinate_bots', { bot_ids: ['a'], message: 'x', botId: 'a' }))?.code, TEAM_CODES.INVALID_ARGS)
  assert.equal(coded(() => parseTeamToolArgs('coordinate_bots', { bot_ids: ['a'], message: 'x', owner: true }))?.code, TEAM_CODES.INVALID_ARGS)
  assert.equal(coded(() => parseTeamToolArgs('coordinate_bots', { message: 'x' }))?.code, TEAM_CODES.INVALID_ARGS)
  assert.equal(coded(() => parseTeamToolArgs('coordinate_bots', { bot_ids: [], message: 'x' }))?.code, TEAM_CODES.INVALID_ARGS)
  assert.equal(coded(() => parseTeamToolArgs('coordinate_bots', { bot_ids: ['a', 'a'], message: 'x' }))?.code, TEAM_CODES.INVALID_ARGS)
  assert.equal(coded(() => parseTeamToolArgs('coordinate_bots', { bot_ids: ['a', 'b', 'c', 'd', 'e'], message: 'x' }))?.code, TEAM_CODES.INVALID_ARGS)
  assert.equal(coded(() => parseTeamToolArgs('coordinate_bots', { bot_ids: ['a'], message: 'x'.repeat(MAX_MESSAGE_CHARS + 1) }))?.code, TEAM_CODES.INVALID_ARGS)
  assert.equal(coded(() => parseTeamToolArgs('coordinate_bots', { bot_ids: ['a'], message: 'x', reply: 'later' }))?.code, TEAM_CODES.INVALID_ARGS)
  assert.equal(coded(() => parseTeamToolArgs('coordinate_bots', { bot_ids: ['a'], message: 'x', done_when: 'y'.repeat(MAX_DONE_WHEN_CHARS + 1) }))?.code, TEAM_CODES.INVALID_ARGS)
  assert.equal(coded(() => parseTeamToolArgs('coordinate_bots', { bot_ids: ['a'], message: 'x', thread: 'bad thread!' }))?.code, TEAM_CODES.INVALID_ARGS)
  assert.equal(coded(() => parseTeamToolArgs('coordinate_bots', { bot_ids: 'a', message: 'x' }))?.code, TEAM_CODES.INVALID_ARGS)
})

test('assignment_status accepts an optional id and list tools take no arguments', () => {
  assert.deepEqual(parseTeamToolArgs('assignment_status', {}), {})
  assert.deepEqual(parseTeamToolArgs('assignment_status', { id: 'assign_1' }), { id: 'assign_1' })
  assert.equal(coded(() => parseTeamToolArgs('assignment_status', { wait_ms: 10 }))?.code, TEAM_CODES.INVALID_ARGS)
  assert.deepEqual(parseTeamToolArgs('list_bots', {}), {})
  assert.deepEqual(parseTeamToolArgs('list_threads', {}), {})
  assert.equal(coded(() => parseTeamToolArgs('list_bots', { botId: 'a' }))?.code, TEAM_CODES.INVALID_ARGS)
  assert.equal(coded(() => parseTeamToolArgs('unknown_tool', {})) instanceof TypeError, true)
})

test('thread references accept the two keywords and a bounded id, nothing else', () => {
  assert.equal(threadReferenceOk('standing'), true)
  assert.equal(threadReferenceOk('new'), true)
  assert.equal(threadReferenceOk('launch-reddit-42'), true)
  assert.equal(threadReferenceOk('has space'), false)
  assert.equal(threadReferenceOk('x'.repeat(129)), false)
  assert.equal(threadReferenceOk(5), false)
})

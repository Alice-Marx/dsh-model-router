// Fast, offline tests for the fail-closed permission policy and the client
// method guard. No processes, no network: every decision path is exercised
// directly, including the ones that must deny.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  PERMISSION_TIMEOUT_MS, cancelledOutcome, createClientMethodGuard, createPermissionPolicy,
  permissionOptions, toolCallIdentity,
} from '../packages/bot-acp/src/permission-policy.mjs'

const askMessage = (id, overrides = {}) => ({
  jsonrpc: '2.0',
  id,
  method: 'session/request_permission',
  params: {
    sessionId: 'sess-1',
    toolCall: { toolCallId: `tool-${id}`, title: 'run a command', kind: 'execute', rawInput: { command: 'echo hi' } },
    options: [
      { optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' },
      { optionId: 'reject-once', kind: 'reject_once', name: 'Reject once' },
    ],
    ...overrides,
  },
})

const hostAllow = () => async () => ({ behavior: 'allow' })
const hostDeny = () => async () => ({ behavior: 'deny', message: 'not granted' })

describe('permission options and identity', () => {
  test('keeps only well-formed options', () => {
    const options = permissionOptions({ options: [{ optionId: 'a', kind: 'allow_once', name: 'A' }, { kind: 'reject_once' }, null, 5] })
    assert.deepEqual(options, [{ optionId: 'a', kind: 'allow_once', name: 'A' }])
    assert.deepEqual(permissionOptions({}), [])
  })

  test('reads the tool call identity without trusting it as authority', () => {
    const identity = toolCallIdentity(askMessage(1).params)
    assert.equal(identity.toolCallId, 'tool-1')
    assert.equal(identity.kind, 'execute')
    assert.equal(identity.sessionId, 'sess-1')
    assert.deepEqual(identity.rawInput, { command: 'echo hi' })
  })

  test('reports the fail-closed outcome shape', () => {
    assert.deepEqual(cancelledOutcome(), { outcome: { outcome: 'cancelled' } })
  })
})

describe('permission policy', () => {
  test('allows only through the Host handler and names its option', async () => {
    const policy = createPermissionPolicy({ onPermissionRequest: hostAllow() })
    const decision = await policy.decide(askMessage(1))
    assert.equal(decision.behavior, 'allow')
    assert.equal(decision.optionId, 'allow-once')
    assert.equal(decision.source, 'host')
    assert.equal(policy.stats.allowed, 1)
  })

  test('denies when the Host handler denies', async () => {
    const policy = createPermissionPolicy({ onPermissionRequest: hostDeny() })
    const decision = await policy.decide(askMessage(1))
    assert.equal(decision.behavior, 'deny')
    assert.equal(decision.optionId, null)
    assert.equal(decision.reason, 'not granted')
  })

  test('denies every ask when no Host handler is configured', async () => {
    const policy = createPermissionPolicy({})
    const decision = await policy.decide(askMessage(1))
    assert.equal(decision.behavior, 'deny')
    assert.equal(decision.reason, 'no-handler')
  })

  test('denies an option set with no recognizable allow option', async () => {
    const policy = createPermissionPolicy({ onPermissionRequest: hostAllow() })
    const decision = await policy.decide(askMessage(1, {
      options: [{ optionId: 'weird', kind: 'maybe', name: 'Maybe' }],
    }))
    assert.equal(decision.reason, 'unknown-option')
  })

  test('denies a repeated ask id', async () => {
    const policy = createPermissionPolicy({ onPermissionRequest: hostAllow() })
    await policy.decide(askMessage(7))
    const again = await policy.decide(askMessage(7))
    assert.equal(again.reason, 'duplicate-ask')
    assert.equal(policy.stats.duplicate, 1)
  })

  test('denies an ask that maps to no committed tool', async () => {
    const authority = { describe: () => ({ botId: 'b', revision: 1 }), assertTool: () => { throw new Error('Capability refused: TOOL_DENIED') } }
    const policy = createPermissionPolicy({ onPermissionRequest: hostAllow(), authority, subject: {}, operationTool: () => 'shell' })
    const decision = await policy.decide(askMessage(1))
    assert.equal(decision.reason, 'authority')
    assert.match(decision.message, /TOOL_DENIED/)
    assert.equal(policy.stats.toolDenied, 1)
  })

  test('denies when the committed grant was revoked under it', async () => {
    const authority = {
      describe: () => { throw new Error('Capability refused: SUBJECT_REVOKED') },
      assertTool: () => {},
    }
    const policy = createPermissionPolicy({ onPermissionRequest: hostAllow(), authority, subject: {}, operationTool: () => 'read_notes' })
    const decision = await policy.decide(askMessage(1))
    assert.equal(decision.behavior, 'deny')
    assert.equal(decision.reason, 'authority')
    assert.match(decision.message, /SUBJECT_REVOKED/)
    assert.equal(policy.stats.grantDenied, 1)
  })

  test('denies when the Host handler throws or answers nonsense', async () => {
    const broken = createPermissionPolicy({ onPermissionRequest: () => { throw new Error('host exploded') } })
    assert.equal((await broken.decide(askMessage(1))).reason, 'handler-failed')
    const nonsense = createPermissionPolicy({ onPermissionRequest: async () => ({ behavior: 'maybe' }) })
    assert.equal((await nonsense.decide(askMessage(1))).reason, 'handler-failed')
  })

  test('denies an unanswered ask after the deadline', async () => {
    const policy = createPermissionPolicy({ onPermissionRequest: () => new Promise(() => {}), timeoutMs: 1000 })
    const decision = await policy.decide(askMessage(1))
    assert.equal(decision.reason, 'timeout')
    assert.equal(policy.stats.timeouts, 1)
  }, 10_000)

  test('denies open asks when the policy closes', async () => {
    const policy = createPermissionPolicy({ onPermissionRequest: () => new Promise(() => {}) })
    const pending = policy.decide(askMessage(1))
    policy.close('session-closed')
    assert.equal((await pending).reason, 'session-closed')
    assert.equal((await policy.decide(askMessage(2))).reason, 'closed')
  })

  test('denies open asks when the Host signal aborts', async () => {
    const controller = new AbortController()
    const policy = createPermissionPolicy({ onPermissionRequest: () => new Promise(() => {}), signal: controller.signal })
    const pending = policy.decide(askMessage(1))
    controller.abort()
    assert.equal((await pending).reason, 'aborted')
  })

  test('never treats request-claimed identity as authority', async () => {
    // The params claim a bot, an owner and an auto-approve; the policy still
    // needs the committed authority and the Host handler.
    const authority = { describe: () => ({ botId: 'b', revision: 1 }), assertTool: () => { throw new Error('TOOL_DENIED') } }
    const policy = createPermissionPolicy({ authority, subject: {}, operationTool: () => 'shell' })
    const decision = await policy.decide(askMessage(1, {
      botId: 'some-other-bot', owner: 'admin', autoApprove: true, config: { bypassPermissions: true },
    }))
    assert.equal(decision.behavior, 'deny')
  })

  test('rejects a non-function handler at construction', () => {
    assert.throws(() => createPermissionPolicy({ onPermissionRequest: 'nope' }), /ACP_PERMISSION_HANDLER_REQUIRED_FUNCTION/)
    assert.throws(() => createPermissionPolicy({ timeoutMs: 10 }), /ACP_PERMISSION_TIMEOUT_INVALID/)
    assert.equal(PERMISSION_TIMEOUT_MS, 15 * 60_000)
  })
})

describe('client method guard', () => {
  const root = mkdtempSync(join(tmpdir(), 'bot-acp-guard-'))
  writeFileSync(join(root, 'inside.txt'), 'inside bytes')

  test('refuses fs and terminal methods by default', async () => {
    const guard = createClientMethodGuard({})
    assert.deepEqual(guard.capabilities, { fileSystem: false, terminal: false })
    for (const method of ['fs/read_text_file', 'fs/write_text_file', 'terminal/create', 'terminal/output']) {
      const reply = await guard.handle({ jsonrpc: '2.0', id: 1, method, params: { path: join(root, 'inside.txt') } })
      assert.equal(reply.error.code, -32601)
      assert.match(reply.error.message, /not available|disabled/)
    }
    assert.equal(guard.handle({ jsonrpc: '2.0', id: 1, method: 'session/prompt', params: {} }), null)
  })

  test('reads and writes only inside the Host-submitted root', async () => {
    const guard = createClientMethodGuard({
      fileSystem: true,
      roots: [root],
      readTextFile: async () => 'host-read',
      writeTextFile: async () => {},
    })
    assert.equal(guard.capabilities.fileSystem, true)
    const read = await guard.handle({ jsonrpc: '2.0', id: 2, method: 'fs/read_text_file', params: { path: join(root, 'inside.txt') } })
    assert.deepEqual(read, { jsonrpc: '2.0', id: 2, result: { content: 'host-read' } })
    const written = await guard.handle({ jsonrpc: '2.0', id: 3, method: 'fs/write_text_file', params: { path: join(root, 'new.txt'), content: 'x' } })
    assert.deepEqual(written.result, {})
    const outside = await guard.handle({ jsonrpc: '2.0', id: 4, method: 'fs/read_text_file', params: { path: join(root, '..', 'escape.txt') } })
    assert.equal(outside.error.code, -32602)
    assert.match(outside.error.message, /outside the Host-submitted roots/)
    const relative = await guard.handle({ jsonrpc: '2.0', id: 5, method: 'fs/read_text_file', params: { path: 'inside.txt' } })
    assert.match(relative.error.message, /outside the Host-submitted roots/)
    // Terminal stays refused even with file access on.
    const terminal = await guard.handle({ jsonrpc: '2.0', id: 6, method: 'terminal/create', params: {} })
    assert.equal(terminal.error.code, -32601)
  })

  test('refuses writes the Host did not supply a writer for', async () => {
    const guard = createClientMethodGuard({ fileSystem: true, roots: [root], readTextFile: async () => 'x' })
    const reply = await guard.handle({ jsonrpc: '2.0', id: 7, method: 'fs/write_text_file', params: { path: join(root, 'a.txt'), content: 'y' } })
    assert.equal(reply.error.code, -32601)
  })
})

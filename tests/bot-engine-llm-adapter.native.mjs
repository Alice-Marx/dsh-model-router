// Native verification for the Claude retained-session LLM bridge.
//
// Everything real that can be real, is real here:
//   - the installed `@deepseek-ai/cordis` Context and the installed
//     `@deepseek-ai/dsh-llm` `LlmRuntime`, with the bridge registered through the public
//     `registerAdapter` and dispatched through the public `prepareCall`;
//   - the real `createClaudeEngine` (no engine factory seam) with the real native-peer
//     supervisor on Windows, driving a REAL child process — the offline Node fixture at
//     tests/fixtures/bot-engine-claude-fixture.mjs, which speaks the Claude Code
//     stream-json wire and records the argv, MCP config and every stdin turn it received;
//   - the real capability-broker authority and the real `createModelAccounting` over a
//     real SQLite router state for the one money case.
//
// Offline: no claude CLI, no network, no credentials, no user profile. The child process
// is a fixture, so these tests prove the bridge's wiring and fences, not that a real
// subscription CLI is installed.
//
// Run serially: node --test --test-concurrency=1 (the machine has memory limits and each
// native supervisor run costs real process time).

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createClaudeLlmAdapter } from '../packages/bot-engines/src/claude-llm-adapter.mjs'
import {
  attachLlmRuntime, bridgeOptions, createBridgeHost, ownAssistant, systemMessage, userMessage, withClaudeAccounting,
} from './fixtures/bot-engine-llm-host.mjs'
const PROVIDER = 'claude-session'
const MODEL = 'fixture-model-a'
const PERSONA = 'You are Fixture Bot.'

const drain = async iterable => { const chunks = []; for await (const chunk of iterable) chunks.push(chunk); return chunks }
const evidenceOf = async workspace => JSON.parse(await readFile(join(workspace, 'fixture-evidence.json'), 'utf8'))
const finishOf = chunks => { const last = chunks.at(-1); assert.equal(last?.type, 'finish', 'a turn always ends with exactly one finish chunk'); return last }
const textOf = chunks => chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')

/** One real Host + one real runtime + the bridge registered on it. */
async function boot({ overrides = {}, host: hostOptions = {} } = {}) {
  const host = await createBridgeHost({ persona: PERSONA, ...hostOptions })
  const runtime = await attachLlmRuntime()
  const adapter = createClaudeLlmAdapter(bridgeOptions(host, overrides))
  const release = runtime.service.registerAdapter([PROVIDER], adapter)
  return { host, runtime, adapter, release }
}

/** One turn through the public prepared dispatch, as the product's independent path does. */
async function turn(adapter, messages, { sessionId = 's-1', signal } = {}) {
  const prepared = await adapter.prepareCall(PROVIDER, MODEL)
  return drain(prepared.stream({ provider: PROVIDER, model: MODEL, sessionId, messages, ...(signal ? { signal } : {}) }))
}

/** The bridge's observable "the retained process is gone" signal: the session pid. */
async function waitNoRetainedProcess(adapter, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const session = adapter.snapshot().sessions[0]
    if (!session || session.pid === null) return true
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return adapter.snapshot().sessions[0]?.pid === null
}

describe('claude llm bridge native session', () => {
  test('two turns on one retained native CLI session; only the new input reaches the CLI', async () => {
    const order = []
    const { host, runtime, adapter, release } = await boot({
      overrides: { hooks: { onSettle: value => { order.push(`settle:${value.turnId}`) } } },
    })
    try {
      const first = await turn(adapter, [systemMessage(PERSONA), userMessage('hello turn one', 'm1')])
      assert.equal(finishOf(first).reason.kind, 'stop')
      assert.equal(textOf(first), 'echo: hello turn one')
      assert.equal(first.some(chunk => chunk.type === 'usage'), true, 'the CLI reported usage and it reaches the SDK')
      assert.equal(first.at(-1).replayState.response.usageStatus, 'reported')
      const pidAfterFirst = adapter.snapshot().sessions[0].pid
      assert.ok(pidAfterFirst > 0, 'a real child process is retained')

      const second = await turn(adapter, [
        systemMessage(PERSONA), userMessage('hello turn one', 'm1'), ownAssistant('echo: hello turn one', 'a1', PROVIDER, MODEL), userMessage('hello turn two', 'm2'),
      ])
      assert.equal(finishOf(second).reason.kind, 'stop')
      assert.equal(textOf(second), 'echo: hello turn two')
      const snapshot = adapter.snapshot()
      assert.equal(snapshot.sessions.length, 1, 'one retained session per conversation')
      assert.equal(snapshot.sessions[0].turns, 2)
      assert.equal(snapshot.sessions[0].pid, pidAfterFirst, 'the same native process serves both turns')
      assert.equal(snapshot.sessions[0].lastSessionId, snapshot.sessions[0].lastSessionId)
      assert.match(snapshot.sessions[0].lastSessionId, /^fx-/)

      const evidence = await evidenceOf(host.workspace)
      assert.equal(evidence.turns.length, 2, 'the CLI received exactly two user messages')
      assert.deepEqual(evidence.turns.map(entry => entry.text), ['hello turn one', 'hello turn two'], 'no history was replayed into the retained session')
      assert.equal(evidence.argv.resume, null, 'the first launch was not a resume')
      assert.equal(evidence.argv.systemPrompt, PERSONA, 'the actual child reads the Host-confirmed persona through the native system-prompt file')
      assert.ok(evidence.argv.systemPromptFile.startsWith(host.runtimeRoot))
      // The engine's fences survive the bridge: built-in tools off, strict MCP, no user settings.
      assert.equal(evidence.argv.builtinTools, '')
      assert.equal(evidence.argv.settingSources, '')
      assert.equal(evidence.argv.settings?.disableAllHooks, true)
      assert.equal(evidence.argv.slashCommandsDisabled, true)
      assert.equal(evidence.argv.model, MODEL)
      assert.equal(evidence.mcp.proxyMounted, true)
      assert.equal(evidence.mcp.permissionPromptToolIsProxy, true)
      assert.equal(evidence.mcp.disallowedBash, true)
      assert.equal(order.length, 2, 'the engine settlement ran for both turns')
    } finally {
      await adapter.close()
      release()
      await runtime.dispose()
    }
  }, { timeout: 120_000 })

  test('a concurrent second turn is refused by the engine fence and reaches the CLI once', async () => {
    const { host, runtime, adapter, release } = await boot()
    try {
      const prepared = await adapter.prepareCall(PROVIDER, MODEL)
      const request = { provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(PERSONA), userMessage('slow turn please', 'm1')] }
      const iterator = prepared.stream(request)[Symbol.asyncIterator]()
      const opened = await iterator.next()
      assert.equal(opened.value.type, 'block-start')
      const busy = await turn(adapter, request.messages)
      assert.equal(finishOf(busy).reason.kind, 'error')
      assert.equal(finishOf(busy).reason.failure.code, 'ENGINE_TURN_IN_PROGRESS')
      const evidence = await evidenceOf(host.workspace)
      assert.equal(evidence.turns.length, 1, 'the busy turn dispatched nothing')
      await adapter.close()
      await iterator.return()
    } finally {
      release()
      await runtime.dispose()
    }
  }, { timeout: 120_000 })

  test('a refused resume is never a replay: the session is retired and the CLI saw only the new text', async () => {
    const { host, runtime, adapter, release } = await boot()
    try {
      // The fixture exits right after its result, so the next turn relaunches with --resume;
      // that resumed process then refuses (error result before init), as a real CLI does
      // when the conversation no longer exists upstream.
      const first = await turn(adapter, [systemMessage(PERSONA), userMessage('exit-after-result please', 'm1')])
      assert.equal(finishOf(first).reason.kind, 'stop')
      const nativeSession = first.at(-1).replayState.response.sessionId
      assert.match(nativeSession, /^fx-/)
      // The fixture exits right after its result. The Host sees the engine's own signal that
      // the retained process is gone before it continues the conversation, exactly as the
      // engine's own suite does; a dispatch that races that exit is covered by the
      // process-lost case below.
      assert.equal(await waitNoRetainedProcess(adapter), true, 'the engine noticed the process exit')
      const refused = await turn(adapter, [
        systemMessage(PERSONA), userMessage('exit-after-result please', 'm1'), ownAssistant('echo: exit-after-result please', 'a1', PROVIDER, MODEL), userMessage('resume-refuse now', 'm2'),
      ])
      assert.equal(finishOf(refused).reason.kind, 'error')
      assert.equal(finishOf(refused).reason.failure.code, 'CLAUDE_TURN_OUTCOME_UNKNOWN')
      assert.match(finishOf(refused).reason.failure.message, /resume-refused/)
      const after = await turn(adapter, [
        systemMessage(PERSONA), userMessage('exit-after-result please', 'm1'), userMessage('resume-refuse now', 'm2'),
      ])
      assert.equal(finishOf(after).reason.failure.code, 'CLAUDE_SESSION_RETIRED')

      // The fixture records the scenario before its terminal frame: the Host
      // may immediately stop the process after receiving that frame. Native
      // tree accounting, rather than a later diagnostic write, proves its stop.
      const evidence = await evidenceOf(host.workspace)
      assert.equal(evidence.argv.resume, nativeSession, 'the relaunch really carried --resume with the confirmed id')
      assert.equal(evidence.turns.length, 1, 'the resumed process received only the new turn')
      assert.equal(evidence.turns[0].text, 'resume-refuse now')
      assert.equal(evidence.turns[0].resumed, true)
      assert.equal(evidence.terminalScenario, 'resume-refused')
      assert.equal(adapter.snapshot().sessions[0].stopEvidence.treeStopped, true)
      assert.equal(adapter.snapshot().sessions[0].retired.reason, 'native-resume-refused')
    } finally {
      await adapter.close()
      release()
      await runtime.dispose()
    }
  }, { timeout: 120_000 })

  test('a turn dispatched into a process that died without settling is refused as unknown, never replayed', async () => {
    // The fixture exits immediately after its result, so the next turn can reach the engine
    // before the supervisor has reported the exit. The bridge must not lose that turn: it
    // stops the tree, settles the turn as the unknown outcome it is, retires the session and
    // offers nothing again.
    const { host, runtime, adapter, release } = await boot()
    try {
      const first = await turn(adapter, [systemMessage(PERSONA), userMessage('exit-after-result please', 'm1')])
      assert.equal(finishOf(first).reason.kind, 'stop')
      const lost = await turn(adapter, [
        systemMessage(PERSONA), userMessage('exit-after-result please', 'm1'), ownAssistant('echo: exit-after-result please', 'a1', PROVIDER, MODEL), userMessage('continue please', 'm2'),
      ])
      assert.equal(finishOf(lost).reason.kind, 'error')
      const failure = finishOf(lost).reason.failure
      assert.ok(['CLAUDE_SESSION_PROCESS_LOST', 'CLAUDE_TURN_OUTCOME_UNKNOWN'].includes(failure.code), `unexpected refusal: ${failure.code}`)
      assert.equal(adapter.snapshot().sessions[0].retired.reason.startsWith('native-'), true)
      const after = await turn(adapter, [
        systemMessage(PERSONA), userMessage('exit-after-result please', 'm1'), userMessage('continue please', 'm2'),
      ])
      assert.equal(finishOf(after).reason.failure.code, 'CLAUDE_SESSION_RETIRED')
      const evidence = await evidenceOf(host.workspace)
      assert.equal(evidence.turns.length, 1, 'the CLI received the first turn only: nothing was replayed')
    } finally {
      await adapter.close()
      release()
      await runtime.dispose()
    }
  }, { timeout: 120_000 })

  test('cancelling a turn stops the native tree, settles, and never replays the cancelled text', async () => {    const { host, runtime, adapter, release } = await boot()
    try {
      const controller = new AbortController()
      const iterator = (await adapter.prepareCall(PROVIDER, MODEL))
        .stream({ provider: PROVIDER, model: MODEL, sessionId: 's-1', signal: controller.signal, messages: [systemMessage(PERSONA), userMessage('slow turn please', 'm1')] })[Symbol.asyncIterator]()
      const first = await iterator.next()
      assert.equal(first.value.type, 'block-start')
      const pid = adapter.snapshot().sessions[0].pid
      controller.abort()
      let next = await iterator.next()
      const chunks = [first.value]
      while (!next.done) { chunks.push(next.value); next = await iterator.next() }
      assert.equal(chunks.at(-1).type, 'finish')
      assert.equal(chunks.at(-1).reason.kind, 'aborted')
      assert.equal(chunks.at(-1).reason.failure.code, 'CLAUDE_TURN_CANCELLED')
      assert.equal(adapter.snapshot().sessions[0].stopEvidence.treeStopped, true, 'the supervisor confirms the whole tree ended')

      const after = await turn(adapter, [systemMessage(PERSONA), userMessage('slow turn please', 'm1'), userMessage('next turn', 'm2')])
      assert.equal(finishOf(after).reason.failure.code, 'CLAUDE_SESSION_RETIRED')
      const evidence = await evidenceOf(host.workspace)
      assert.equal(evidence.turns.length, 1, 'the cancelled text was never re-sent')
      assert.equal(evidence.turns[0].text, 'slow turn please')
      let alive = true
      try { process.kill(pid, 0) } catch { alive = false }
      assert.equal(alive, false, 'the native child process is really gone')
    } finally {
      await adapter.close()
      release()
      await runtime.dispose()
    }
  }, { timeout: 120_000 })

  test('a call prepared before a Host re-registration is refused, and the new generation dispatches', async () => {
    const { host, runtime, adapter, release } = await boot()
    try {
      const prepared = await adapter.prepareCall(PROVIDER, MODEL)
      const nextPersona = 'A different committed persona.'
      const replaced = adapter.replaceRoute({ persona: nextPersona })
      assert.equal(replaced.generation, 2)
      host.setIdentity({ ...host.identity, persona: nextPersona })
      const stale = await drain(prepared.stream({ provider: PROVIDER, model: MODEL, sessionId: 's-1', messages: [systemMessage(PERSONA), userMessage('stale turn', 'm1')] }))
      assert.equal(finishOf(stale).reason.kind, 'error')
      assert.equal(finishOf(stale).reason.failure.code, 'CLAUDE_ROUTE_GENERATION_CHANGED')
      assert.equal(adapter.snapshot().sessions.length, 0, 'the stale generation created no session at all')
      // The persona the Host now confirms is the new one, so the old request persona is refused.
      const fresh = await turn(adapter, [systemMessage(PERSONA), userMessage('fresh turn', 'm1')])
      assert.equal(finishOf(fresh).reason.failure.code, 'CLAUDE_PERSONA_MISMATCH')
      const confirmed = await turn(adapter, [systemMessage(nextPersona), userMessage('fresh turn', 'm1')])
      assert.equal(finishOf(confirmed).reason.kind, 'stop')
      const evidence = await evidenceOf(host.workspace)
      assert.equal(evidence.turns.length, 1, 'only the confirmed generation dispatched')
    } finally {
      await adapter.close()
      release()
      await runtime.dispose()
    }
  }, { timeout: 120_000 })

  test('a revoked grant retires the native session instead of continuing it', async () => {
    const { host, runtime, adapter, release } = await boot()
    try {
      await turn(adapter, [systemMessage(PERSONA), userMessage('turn one', 'm1')])
      const pid = adapter.snapshot().sessions[0].pid
      host.authority.replaceGrant(host.subject, { tools: ['read_notes'], modelRoutes: [{ provider: PROVIDER, model: MODEL }] })
      const refused = await turn(adapter, [
        systemMessage(PERSONA), userMessage('turn one', 'm1'), ownAssistant('echo: turn one', 'a1', PROVIDER, MODEL), userMessage('turn two', 'm2'),
      ])
      assert.equal(finishOf(refused).reason.kind, 'error')
      assert.equal(finishOf(refused).reason.failure.code, 'CLAUDE_SESSION_BINDING_CHANGED')
      let alive = true
      try { process.kill(pid, 0) } catch { alive = false }
      assert.equal(alive, false, 'the old native tree was stopped')
      const evidence = await evidenceOf(host.workspace)
      assert.equal(evidence.turns.length, 1)
    } finally {
      await adapter.close()
      release()
      await runtime.dispose()
    }
  }, { timeout: 120_000 })

  test('an API-funded committed route is refused before anything is launched', async () => {
    const { host, runtime, adapter, release } = await boot({ host: { fundingFor: async () => 'api' } })
    try {
      await assert.rejects(() => adapter.prepareCall(PROVIDER, MODEL), { code: 'CLAUDE_ROUTE_FUNDING_REFUSED' })
      assert.equal(adapter.snapshot().sessions.length, 0)
      let evidence = null
      try { evidence = await evidenceOf(host.workspace) } catch { evidence = null }
      assert.equal(evidence, null, 'no child process was ever launched')
    } finally {
      release()
      await runtime.dispose()
    }
  }, { timeout: 60_000 })
})

describe('claude llm bridge native money path', () => {
  test('the parent accounting records exactly one receipt; the bridge invents no money', async () => {
    const { host, runtime, adapter, release } = await boot({ host: { botId: 'bot-money', tools: ['model/infer'] } })
    try {
      await withClaudeAccounting(async (harness) => {
        harness.llm = runtime.service
        const chunks = await harness.call({
          provider: PROVIDER, model: MODEL, sessionId: 's-1',
          messages: [systemMessage(PERSONA), userMessage('money turn', 'm1')],
        })
        assert.equal(chunks.at(-1).type, 'finish')
        assert.equal(chunks.at(-1).reason.kind, 'stop')
        assert.equal(textOf(chunks), 'echo: money turn')
        const receipts = await harness.receipts()
        assert.equal(receipts.length, 1, 'exactly one receipt: the bridge issues none of its own')
        assert.equal(receipts[0].state, 'settled')
        assert.equal(receipts[0].provider, PROVIDER)
        assert.equal(receipts[0].model, MODEL)
        assert.equal(receipts[0].finishKind, 'stop')
        assert.equal(receipts[0].outcome, 'succeeded')
        assert.equal(receipts[0].reportedCostUsd, null, 'no CLI dollar figure is invented')
        assert.equal(receipts[0].usageComplete, true, 'the CLI-reported usage reached the ledger')
        assert.equal(receipts[0].usage?.inputTokens > 0, true)
        const runs = harness.runs()
        assert.equal(runs.length, 1)
        assert.equal(runs[0].packages[0].billing, 'subscription')
        assert.equal(runs[0].packages[0].costSource, 'subscription')
        assert.equal(runs[0].packages[0].ran, true)
        assert.equal(runs[0].packages[0].costUsd, 0)
      })
      const evidence = await evidenceOf(host.workspace)
      assert.equal(evidence.turns.length, 1, 'one model call dispatched one native turn')
    } finally {
      await adapter.close()
      release()
      await runtime.dispose()
    }
  }, { timeout: 120_000 })
})

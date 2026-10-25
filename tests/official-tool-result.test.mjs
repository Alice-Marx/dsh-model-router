import test from 'node:test'
import assert from 'node:assert/strict'
import { createOfficialToolEvidenceCollector, finalizeOfficialProcessResult, officialToolTerminalEvidence, resolveZCodeLaunch, executionEnvironment,
  parseClaudeProcessOutput } from '../.dsh-plugin/shared/official-tool-executor.mjs'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const failure = { type: 'result', subtype: 'error_during_execution', is_error: true,
  errors: ['Cannot connect to the configured endpoint'], usage, total_cost_usd: 0 }

test('standalone ZCode launches the verified runner with bounded noninteractive arguments and its configured model', async () => {
  const workspace = process.cwd(), root = (await import('node:os')).tmpdir()
  const cliEntry = (await import('node:path')).join(root, 'zcode-cli', 'bin', 'zcode.mjs')
  const requests = []
  const options = { installDir: root, modelId: 'suggested-model',
    discoverBundle: async request => { requests.push(request); return { root, cliEntry, source: 'github-release-sha256' } },
    findNode: async (directory, minimum, accepted) => {
      assert.equal(directory, workspace)
      assert.deepEqual(minimum, [24, 14, 0])
      assert.equal(accepted('24.20.0'), true)
      assert.equal(accepted('25.0.0'), false)
      return '/trusted/node'
    } }
  const spec = await resolveZCodeLaunch(workspace, 'workspace-write', 'offline task', options)
  assert.deepEqual(requests, [{ installDir: root }])
  assert.equal(spec.file, '/trusted/node')
  assert.deepEqual(spec.args, [cliEntry, '--prompt', 'offline task', '--cwd', workspace,
    '--mode', 'yolo', '--workflow-mode', 'disabled', '--disallowed-tools', 'AskUserQuestion EnterPlanMode ExitPlanMode',
    '--output-format', 'stream-json', '--no-color'])
  assert.equal(spec.format, 'zcode-stream-json')
  assert.equal(spec.requestedModel, null)
  assert.match(spec.modelNotice, /默认模型/)
  assert.equal(spec.stdinTask, false)
  assert.match((await resolveZCodeLaunch(workspace, 'workspace-write', 'task', { ...options, findNode: async () => null })).unsupported, /Node.js 24.14.0/)
  assert.match((await resolveZCodeLaunch(workspace, 'workspace-write', 'task', { ...options, discoverBundle: async () => null })).unsupported, /SHA256/)
  assert.match((await resolveZCodeLaunch(workspace, 'workspace-write', 'a'.repeat(16_001), options)).unsupported, /16 KB/)
  assert.match((await resolveZCodeLaunch(workspace, 'workspace-write', 'task', { ...options,
    discoverBundle: async () => ({ root: workspace, cliEntry: `${workspace}/bin/zcode.mjs` }) })).unsupported, /工作区之外/)
})

test('standalone ZCode retains its provider locations and proxy without undocumented key-based authentication', () => {
  const env = executionEnvironment('zcode', { env: { PATH: '/bin', ZCODE_DATA_BASE_DIR: '/data/zcode',
    ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: '/data/provider_config.json', ZCODE_HTTP_PROXY: 'http://proxy.test',
    NODE_OPTIONS: '--import=untrusted', ZAI_API_KEY: 'fixture', OPENAI_API_KEY: 'other' } })
  assert.equal(env.ZCODE_DATA_BASE_DIR, '/data/zcode')
  assert.equal(env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, '/data/provider_config.json')
  assert.equal(env.ZCODE_HTTP_PROXY, 'http://proxy.test')
  assert.equal(env.ZAI_API_KEY, undefined)
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.NODE_OPTIONS, undefined)
})

test('Claude nonzero terminal JSON retains its failure and explicit zero usage/cost', () => {
  const actual = parseClaudeProcessOutput(JSON.stringify(failure), 1)
  assert.equal(actual.status, 'failed')
  assert.equal(actual.exitCode, 1)
  assert.equal(actual.terminalEvent, 'failed')
  assert.match(actual.error, /退出码非零.*Cannot connect/)
  assert.equal(actual.detail, failure.errors[0])
  assert.equal(actual.reportedCostUsd, 0)
  assert.deepEqual(actual.usage, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
  assert.equal(actual.finalText, undefined)
})

test('Claude failure diagnostic collects vendor error shapes, deduplicates, and redacts secrets', () => {
  const actual = parseClaudeProcessOutput(JSON.stringify({ ...failure,
    errors: ['network failure', { message: 'network failure' }, { error: { message: 'token opaque-secret-123 failed' } }],
    error: { message: 'Bearer abcdefghijklmnop rejected' }, result: 'api_key=private-value rejected',
  }), 1, { secrets: ['opaque-secret-123'] })
  assert.equal(actual.detail,
    'network failure | token [redacted] failed | Bearer [redacted] rejected | api_key=[redacted] rejected')
  assert.doesNotMatch(actual.error, /opaque-secret|abcdefghijklmnop|private-value/)
})

test('Claude full result diagnostics preserve the final cause after verbose details', () => {
  const actual = parseClaudeProcessOutput(JSON.stringify({ ...failure,
    errors: [`Connection diagnostics ${'x'.repeat(4_000)} final cause: certificate rejected`],
  }), 1)
  assert.ok(actual.detail.length <= 2_000)
  assert.match(actual.detail, /^Connection diagnostics/)
  assert.match(actual.detail, /final cause: certificate rejected$/)
})

test('Claude invalid/truncated JSON and nonterminal objects never establish usage/cost', () => {
  for (const stdout of [JSON.stringify(failure).slice(0, -1), '', 'null', '[]',
    JSON.stringify({ usage, total_cost_usd: 0 }),
    JSON.stringify({ ...failure, type: 'progress' }),
    JSON.stringify({ type: 'result', subtype: 'pending', usage, total_cost_usd: 0 }),
    JSON.stringify({ ...failure, is_error: 'true' }),
  ]) {
    const actual = parseClaudeProcessOutput(stdout, 1)
    assert.equal(actual.status, 'failed')
    assert.equal(actual.usage, undefined)
    assert.equal(actual.reportedCostUsd, undefined)
  }
})

test('Claude missing or invalid counters stay unknown and are not converted into zero', () => {
  for (const invalidUsage of [undefined, null, [], {}, { input_tokens: 0 },
    { ...usage, input_tokens: null }, { ...usage, output_tokens: '0' },
    { ...usage, input_tokens: -1 }, { ...usage, output_tokens: 0.5 },
    { ...usage, cache_read_input_tokens: null },
  ]) {
    const actual = parseClaudeProcessOutput(JSON.stringify({ ...failure, usage: invalidUsage, total_cost_usd: null }), 1)
    assert.equal(actual.usage, undefined)
    assert.equal(actual.reportedCostUsd, undefined)
  }
  const actual = parseClaudeProcessOutput(JSON.stringify({ ...failure, usage: undefined }), 1)
  assert.equal(actual.usage, undefined)
  assert.equal(actual.reportedCostUsd, 0, 'an explicit terminal result cost is independent evidence')
})

test('Claude successful-looking output cannot override a nonzero exit', () => {
  const result = { ...failure, subtype: 'success', is_error: false, errors: undefined, result: 'completed answer' }
  const actual = parseClaudeProcessOutput(JSON.stringify(result), 1)
  assert.equal(actual.status, 'failed')
  assert.equal(actual.finalText, undefined)
  assert.match(actual.error, /退出码非零/)
  assert.equal(actual.reportedCostUsd, 0)
})

test('Claude zero exit still requires a successful nonempty terminal answer', () => {
  for (const result of [failure, { ...failure, subtype: 'success', is_error: true, result: 'error' },
    { ...failure, subtype: 'success', is_error: false, result: '  ' },
  ]) assert.equal(parseClaudeProcessOutput(JSON.stringify(result), 0).status, 'failed')
  const actual = parseClaudeProcessOutput(JSON.stringify({ type: 'result', subtype: 'success', is_error: false,
    result: 'the answer', usage: { input_tokens: 2, output_tokens: 3 }, total_cost_usd: 0.01,
    modelUsage: { 'claude-reported': {} },
  }), 0)
  assert.deepEqual(actual, { status: 'succeeded', exitCode: 0, terminalEvent: 'completed', finalText: 'the answer',
    usage: { inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 },
    reportedCostUsd: 0.01, reportedModel: 'claude-reported' })
})

test('Claude error fields remain diagnostic evidence when older terminal JSON omits a subtype', () => {
  const actual = parseClaudeProcessOutput(JSON.stringify({ type: 'result', is_error: true,
    error: { error: { message: 'Authentication unavailable' } }, usage, total_cost_usd: 0 }), 1)
  assert.match(actual.error, /Authentication unavailable/)
  assert.equal(actual.status, 'failed')
  assert.equal(actual.reportedCostUsd, 0)
})

const normalizedUsage = { inputTokens: 8, outputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 0 }
const codexCompleted = { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 3, cached_input_tokens: 2 } }

test('nonzero, cancelled, timeout and output-limit results retain verified terminal accounting without changing status', () => {
  for (const status of ['failed', 'cancelled', 'timed-out', 'output-limit']) {
    for (const reportedCostUsd of [0, 0.02]) {
      const result = finalizeOfficialProcessResult({ status, exitCode: status === 'failed' ? 1 : null,
        error: 'process stopped', finalText: '' }, { usage: normalizedUsage, reportedCostUsd })
      assert.equal(result.status, status)
      assert.equal(result.error, 'process stopped')
      assert.equal(result.finalText, '')
      assert.equal(result.reportedCostUsd, reportedCostUsd)
      assert.deepEqual(result.usage, normalizedUsage)
    }
  }
})

test('process finalizer rejects incomplete counters and absent costs rather than trusting unverified outcome fields', () => {
  const result = finalizeOfficialProcessResult({ status: 'failed', usage: normalizedUsage,
    reportedCostUsd: 0, usageIncomplete: true }, { usage: { inputTokens: 0, outputTokens: 0 }, reportedCostUsd: null })
  assert.deepEqual(result, { status: 'failed' })
  const valid = finalizeOfficialProcessResult({ status: 'timed-out' }, { usage: normalizedUsage, usageIncomplete: true })
  assert.equal(valid.usageIncomplete, true)
  assert.equal(valid.reportedCostUsd, undefined)
})

test('Codex complete turn usage survives a failed process but incomplete or contradictory counts do not', () => {
  const collector = createOfficialToolEvidenceCollector('codex-jsonl')
  collector.push({ type: 'turn.started' })
  collector.push(codexCompleted)
  assert.deepEqual(finalizeOfficialProcessResult({ status: 'failed', exitCode: 1 }, collector.snapshot()),
    { status: 'failed', exitCode: 1, usage: normalizedUsage })
  for (const raw of [{}, { input_tokens: 0 }, { input_tokens: null, output_tokens: 0 },
    { input_tokens: 2, output_tokens: 0, cached_input_tokens: 3 },
    { input_tokens: 2, output_tokens: 0, cached_input_tokens: '0' },
  ]) assert.deepEqual(officialToolTerminalEvidence('codex-jsonl', { type: 'turn.completed', usage: raw }), {})
  assert.deepEqual(officialToolTerminalEvidence('codex-jsonl', { ...codexCompleted, type: 'turn.started' }), {})
})

test('Codex interrupted later turns retain completed usage as incomplete, and duplicate terminals cannot double-count', () => {
  const collector = createOfficialToolEvidenceCollector('codex-jsonl')
  collector.push(codexCompleted)
  collector.push(codexCompleted)
  assert.deepEqual(collector.snapshot().usage, normalizedUsage)
  collector.push({ type: 'turn.started' })
  collector.push({ type: 'turn.failed' })
  const stopped = finalizeOfficialProcessResult({ status: 'cancelled' }, collector.snapshot())
  assert.equal(stopped.usageIncomplete, true)
  assert.deepEqual(stopped.usage, normalizedUsage)
  assert.equal(stopped.reportedCostUsd, undefined)
})

test('Grok complete end preserves reported zero cost on interrupted cleanup while partial totals remain unknown', () => {
  const end = { type: 'end', stopReason: 'end_turn', sessionId: 'session',
    usage: { input_tokens: 4, output_tokens: 2 }, total_cost_usd: 0 }
  const collector = createOfficialToolEvidenceCollector('grok-jsonl')
  collector.push(end)
  const result = finalizeOfficialProcessResult({ status: 'timed-out' }, collector.snapshot())
  assert.equal(result.status, 'timed-out')
  assert.equal(result.reportedCostUsd, 0)
  assert.deepEqual(result.usage, { inputTokens: 4, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 })
  assert.equal(officialToolTerminalEvidence('grok-jsonl', { ...end, cost_is_partial: true }).reportedCostUsd, undefined)
  assert.equal(officialToolTerminalEvidence('grok-jsonl', { ...end, total_cost_usd: null }).reportedCostUsd, undefined)
  assert.equal(officialToolTerminalEvidence('grok-jsonl', { ...end, usage: {} }).usage, undefined)
  assert.deepEqual(officialToolTerminalEvidence('grok-jsonl', { ...end, sessionId: undefined }), {})
  collector.push(end)
  assert.deepEqual(collector.snapshot(), {}, 'conflicting duplicate terminal totals are not trusted')
})

test('MiMo completed steps retain verified usage, but a later interruption cannot turn partial spend into a total', () => {
  const step = { type: 'step_finish', sessionID: 'session', part: { type: 'step-finish', reason: 'stop',
    tokens: { input: 4, output: 2, reasoning: 1, cache: { read: 3, write: 1 } }, cost: 0.02 } }
  const collector = createOfficialToolEvidenceCollector('mimo-jsonl')
  collector.push(step)
  assert.equal(collector.snapshot().reportedCostUsd, 0.02)
  collector.push({ type: 'step_start', sessionID: 'session' })
  const interrupted = finalizeOfficialProcessResult({ status: 'cancelled' }, collector.snapshot())
  assert.deepEqual(interrupted.usage, { inputTokens: 4, outputTokens: 3, cacheReadTokens: 3, cacheWriteTokens: 1 })
  assert.equal(interrupted.usageIncomplete, true)
  assert.equal(interrupted.reportedCostUsd, undefined)
  collector.push({ ...step, part: { ...step.part, cost: 0 } })
  assert.equal(collector.snapshot().reportedCostUsd, 0.02)
  assert.equal(collector.snapshot().usage.outputTokens, 6)
  assert.equal(collector.snapshot().usageIncomplete, undefined)
  collector.push({ type: 'step_start', sessionID: 'different-session' })
  assert.deepEqual(collector.snapshot(), {})
  assert.deepEqual(officialToolTerminalEvidence('mimo-jsonl', { ...step,
    part: { ...step.part, tokens: { input: 0 } } }), {})
})

test('MiniMax only retains schema-validated terminal counters with available usage, including explicit zero', () => {
  const terminal = { terminalEvent: 'turn.failed', vendorStatus: 'failed', runId: 'run', sessionId: 'session', turnId: 'turn',
    usage: { inputTokens: 0, outputTokens: 0 }, usageSource: 'completed_responses', usageIncomplete: true }
  const evidence = officialToolTerminalEvidence('minimax-stream-json', terminal)
  const result = finalizeOfficialProcessResult({ status: 'failed', exitCode: 1 }, evidence)
  assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
  assert.equal(result.usageIncomplete, true)
  for (const invalid of [{ ...terminal, turnId: null }, { ...terminal, terminalEvent: null },
    { ...terminal, usageSource: 'unavailable' }, { ...terminal, usage: {} },
  ]) assert.deepEqual(officialToolTerminalEvidence('minimax-stream-json', invalid), {})
})

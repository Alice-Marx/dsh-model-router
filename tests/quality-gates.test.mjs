import test from 'node:test'
import assert from 'node:assert/strict'
import { parseQualityGateJson as parse, validateAnswer, runQualityCascade as run } from '../.dsh-plugin/shared/quality-gates.mjs'

const gate = parse('{"kind":"json-object","requiredKeys":["answer"],"fieldTypes":{"answer":"string"}}')
const route = { provider: 'p', model: 'small', pricing: { input: 1, output: 2 } }
const large = { provider: 'p', model: 'large', pricing: { input: 3, output: 4 } }
const paid = (answer, tokens = 3) => ({ ok: true, answer, provider: 'p', model: 'small', usage: { inputTokens: tokens, outputTokens: 2 } })
const request = extra => ({ route, task: 'Return JSON', gate, alternatives: [large], ...extra })

test('strict parser accepts empty gates and a bounded structural JSON contract', () => {
  assert.equal(parse(''), null)
  assert.equal(parse('  \n '), null)
  assert.equal(parse('{}'), null)
  assert.deepEqual(parse('{"kind":"json-object"}'), { kind: 'json-object', requiredKeys: [], fieldTypes: {} })
  assert.deepEqual(gate.requiredKeys, ['answer'])
  for (const input of ['null', '[]', '1', 'true', '"json"', '{bad', '{"kind":"schema"}',
    '{"kind":"json-object","extra":1}', '{"kind":"json-object","requiredKeys":null}',
    '{"kind":"json-object","requiredKeys":["__proto__"]}', '{"kind":"json-object","fieldTypes":null}',
    '{"kind":"json-object","fieldTypes":{"x":"integer"}}']) assert.throws(() => parse(input), TypeError, input)
  assert.throws(() => parse(JSON.stringify({ kind: 'json-object', requiredKeys: Array(33).fill('x') })), TypeError)
  assert.throws(() => parse(JSON.stringify({ kind: 'json-object', requiredKeys: ['x'.repeat(129)] })), TypeError)
  assert.throws(() => parse(JSON.stringify({ kind: 'json-object', requiredKeys: ['bad\nkey'] })), TypeError)
})

test('validation requires a complete JSON object and own fields, and checks JSON types only', () => {
  assert.equal(validateAnswer('arbitrary text', null).ok, true)
  assert.equal(validateAnswer(' {"answer":"anything"} \n', gate).ok, true)
  for (const answer of ['[]', 'null', '42', '{}', '{"answer":4}', 'text {"answer":"x"}',
    '```json\n{"answer":"x"}\n```', '{"answer":"x"} trailing']) assert.equal(validateAnswer(answer, gate).ok, false, answer)
  const ownGate = parse('{"kind":"json-object","requiredKeys":["toString"]}')
  assert.equal(validateAnswer('{}', ownGate).ok, false)
  assert.equal(validateAnswer('{"toString":"own"}', ownGate).ok, true)
  const typed = parse('{"kind":"json-object","fieldTypes":{"n":"number","b":"boolean","o":"object","a":"array","z":"null"}}')
  assert.equal(validateAnswer('{"n":2,"b":false,"o":{},"a":[],"z":null}', typed).ok, true)
  assert.equal(validateAnswer('{}', typed).ok, true) // Optional fields use requiredKeys separately.
  for (const answer of ['{"n":1e999}', '{"o":[]}', '{"o":null}', '{"a":{}}', '{"z":false}', '{"nested":[1e999]}']) {
    assert.equal(validateAnswer(answer, typed).ok, false, answer)
  }
})

test('a passing answer and no-gate answers each incur exactly one call', async () => {
  for (const selectedGate of [gate, null]) {
    let calls = 0
    const original = paid(selectedGate ? '{"answer":"x"}' : 'free form')
    const result = await run(request({ gate: selectedGate, call: async () => { calls++; return original },
      approveUpgrade: () => assert.fail('approval not needed') }))
    assert.equal(calls, 1)
    assert.equal(result.result.ok, true)
    assert.equal(result.attempts.length, 1)
    if (!selectedGate) assert.equal(result.result, original)
    assert.equal(Object.hasOwn(original, 'qualityValidation'), false)
  }
})

test('upgrade requires literal true approval and picks the first different configured model', async () => {
  const seen = []
  const original = paid('{}')
  const outcome = await run(request({ alternatives: [route, { provider: 'p' }, large, { provider: 'q', model: 'other' }],
    call: async input => {
      seen.push(input)
      return seen.length === 1 ? original : { ...paid('{"answer":"done"}', 5), model: 'large' }
    }, approveUpgrade: ({ from, to, attempts }) => {
      assert.equal(from.model, 'small')
      assert.equal(to.model, 'large')
      assert.equal(attempts.length, 1)
      return true
    } }))
  assert.deepEqual(seen.map(input => input.route.model), ['small', 'large'])
  assert.equal(outcome.result.ok, true)
  assert.equal(outcome.result.qualityValidation.escalated, true)
  assert.equal(outcome.attempts[0].usage.inputTokens, 3)
  assert.equal(outcome.attempts[1].usage.inputTokens, 5)
  assert.equal(outcome.result.usage.inputTokens, 5) // No mixed-model token total or invented bill.
  assert.equal(Object.hasOwn(outcome.result, 'reportedCostUsd'), false)
  assert.deepEqual(outcome.attempts.map(item => item.pricingSnapshot), [route.pricing, large.pricing])
  for (const attempt of outcome.attempts) {
    assert.ok(Number.isFinite(attempt.startedAt) && Number.isFinite(attempt.finishedAt))
    assert.ok(attempt.finishedAt >= attempt.startedAt)
    assert.ok(attempt.durationMs >= 0)
  }
})

test('missing, false, truthy, or throwing approval cannot trigger a paid upgrade', async () => {
  for (const approveUpgrade of [undefined, () => false, () => 'true', () => { throw new Error('budget unavailable') }]) {
    let calls = 0
    const result = await run(request({ call: async () => { calls++; return paid('{}') }, approveUpgrade }))
    assert.equal(calls, 1)
    assert.equal(result.result.ok, false)
    assert.equal(result.result.answer, '{}')
    assert.equal(result.result.usage.inputTokens, 3)
    assert.equal(result.attempts.length, 1)
    assert.match(result.result.qualityValidation.upgradeReason, /^approval-/)
  }
})

test('a failed second output stops after two attempts even with additional alternatives', async () => {
  let calls = 0
  let approvals = 0
  const result = await run(request({ alternatives: [large, { provider: 'q', model: 'largest' }],
    call: async () => { calls++; return paid('{}', calls) }, approveUpgrade: () => { approvals++; return true } }))
  assert.equal(calls, 2)
  assert.equal(approvals, 1)
  assert.equal(result.result.ok, false)
  assert.equal(result.attempts.length, 2)
  assert.equal(result.attempts[0].usage.inputTokens, 1)
  assert.equal(result.attempts[1].usage.inputTokens, 2)
  assert.equal(result.result.qualityValidation.upgradeReason, 'upgrade-failed')
})

test('second-call exceptions retain first paid usage and leave unknown usage unknown', async () => {
  let calls = 0
  const result = await run(request({ call: async () => {
    if (++calls === 1) return paid('{}', 11)
    throw new Error('network uncertain')
  }, approveUpgrade: () => true }))
  assert.equal(calls, 2)
  assert.equal(result.result.ok, false)
  assert.equal(result.attempts[0].usage.inputTokens, 11)
  assert.equal(result.attempts[1].ran, 'unknown')
  assert.equal(result.attempts[1].usageIncomplete, true)
  assert.equal(Object.hasOwn(result.attempts[1], 'usage'), false)
})

test('first-call exceptions produce one unknown attempt and never request an upgrade', async () => {
  let calls = 0
  const result = await run(request({ call: async () => { calls++; throw new Error('unknown request state') },
    approveUpgrade: () => assert.fail('failed first transport cannot upgrade') }))
  assert.equal(calls, 1)
  assert.equal(result.result.ok, false)
  assert.equal(result.attempts.length, 1)
  assert.equal(result.attempts[0].ran, 'unknown')
  assert.equal(Object.hasOwn(result.attempts[0], 'usage'), false)
  assert.equal(Object.hasOwn(result.attempts[0], 'reportedCostUsd'), false)
})

test('second transport failure preserves first reported spend without synthesizing a total', async () => {
  let calls = 0
  const result = await run(request({ call: async () => ++calls === 1
    ? { ...paid('{}'), reportedCostUsd: 0.01 }
    : { ok: false, error: 'provider rejected', usage: { inputTokens: 1 } }, approveUpgrade: () => true }))
  assert.equal(result.result.ok, false)
  assert.equal(result.attempts.length, 2)
  assert.equal(result.attempts[0].reportedCostUsd, 0.01)
  assert.equal(result.attempts[1].usage.inputTokens, 1)
  assert.equal(Object.hasOwn(result.result, 'reportedCostUsd'), false)
})

test('cancellation before or between attempts preserves incurred evidence without a second call', async () => {
  const before = new AbortController()
  before.abort()
  const notStarted = await run(request({ signal: before.signal, call: () => assert.fail('already aborted') }))
  assert.equal(notStarted.attempts.length, 0)
  assert.equal(notStarted.result.cancelled, true)
  for (const duringApproval of [false, true]) {
    const controller = new AbortController()
    let calls = 0
    const result = await run(request({ signal: controller.signal,
      call: async () => { calls++; if (!duringApproval) controller.abort(); return paid('{}', 9) },
      approveUpgrade: async () => { controller.abort(); return true } }))
    assert.equal(calls, 1)
    assert.equal(result.result.cancelled, true)
    assert.equal(result.attempts[0].usage.inputTokens, 9)
  }
})

test('transport failures and stopped/truncated results never escalate', async () => {
  for (const flags of [{ ok: false, error: 'transport' }, { truncated: true }, { blocked: true }, { paused: true }, { cancelled: true }]) {
    let calls = 0
    const original = { ...paid('{}'), ...flags }
    const result = await run(request({ call: async () => { calls++; return original },
      approveUpgrade: () => assert.fail('stopped result cannot upgrade') }))
    assert.equal(calls, 1)
    assert.equal(result.attempts.length, 1)
    if (original.ok === false) assert.equal(result.result, original)
  }
})

test('approval receives copies, attempts exclude nested attempts/request secrets, and inputs remain unchanged', async () => {
  const original = { ...paid('{}'), attempts: [{ usage: { inputTokens: 999 } }], request: { apiKey: 'not stored' } }
  const baseline = JSON.stringify({ route, large, original })
  const result = await run(request({ call: async () => original, approveUpgrade: evidence => {
    evidence.attempts[0].usage.inputTokens = 999
    evidence.attempts[0].pricingSnapshot.input = 999
    evidence.from.pricing.input = 999
    return false
  } }))
  assert.equal(JSON.stringify({ route, large, original }), baseline)
  assert.equal(result.attempts[0].usage.inputTokens, 3)
  assert.equal(result.attempts[0].pricingSnapshot.input, 1)
  assert.equal(Object.hasOwn(result.attempts[0], 'attempts'), false)
  assert.equal(Object.hasOwn(result.attempts[0], 'request'), false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { routeBot } from '../packages/orchestration/src/bot-routing.mjs'

const bot = (over = {}) => ({ botId: 'b1', enabled: true, model: { provider: 'p', model: 'm' }, quality: 0.8, pricePerMTokUsd: 1, tools: [], machineOnline: false, load: 0, capabilities: [], ...over })

test('bot routing: hard requirements reject before scoring', () => {
  const result = routeBot({ task: { requiredTools: ['shell_exec'], requiresMachine: true }, candidates: [
    bot({ botId: 'no-tool' }),
    bot({ botId: 'offline', tools: ['shell_exec'] }),
    bot({ botId: 'ok', tools: ['shell_exec'], machineOnline: true }),
    bot({ botId: 'off', enabled: false, tools: ['shell_exec'], machineOnline: true }),
  ] })
  assert.equal(result.chosen.botId, 'ok')
  assert.deepEqual(result.rejected.map(row => row.reason).sort(), ['BOT_DISABLED', 'BOT_MACHINE_OFFLINE', 'BOT_MISSING_TOOL:shell_exec'])
})

test('bot routing: the preset decides between the same two Bots', () => {
  const candidates = [
    bot({ botId: 'cheap', pricePerMTokUsd: 0.2, quality: 0.3 }),
    bot({ botId: 'smart', pricePerMTokUsd: 5, quality: 0.95 }),
  ]
  assert.equal(routeBot({ candidates, preset: 'economy' }).chosen.botId, 'cheap')
  assert.equal(routeBot({ candidates, preset: 'quality' }).chosen.botId, 'smart')
  assert.equal(routeBot({ candidates, preset: 'balanced' }).chosen.botId, 'cheap')
})

test('bot routing: unknown price is not free and unknown quality is not worst', () => {
  const result = routeBot({ preset: 'economy', candidates: [
    bot({ botId: 'unknown-price', pricePerMTokUsd: null, quality: 0.9 }),
    bot({ botId: 'priced', pricePerMTokUsd: 0.5, quality: 0.9 }),
  ] })
  assert.equal(result.chosen.botId, 'priced')
  const unknownQuality = routeBot({ preset: 'quality', candidates: [bot({ botId: 'q', quality: null })] })
  assert.equal(unknownQuality.chosen.botId, 'q')
})

test('bot routing: equal scores prefer known prices before Bot identity in every preset', () => {
  const candidates = [bot({ botId: 'a-unknown', pricePerMTokUsd: null }), bot({ botId: 'z-priced' })]
  for (const preset of ['economy', 'balanced', 'quality']) {
    for (const rows of [candidates, [...candidates].reverse()]) {
      const result = routeBot({ candidates: rows, preset })
      assert.equal(result.chosen.botId, 'z-priced', preset)
      assert.deepEqual(result.ranked.map(row => row.botId), ['z-priced', 'a-unknown'])
    }
  }
  assert.equal(routeBot({ preset: 'quality', candidates: [
    bot({ botId: 'unknown', pricePerMTokUsd: null, quality: 1 }),
    bot({ botId: 'priced', quality: 0.1 }),
  ] }).chosen.botId, 'unknown', 'unknown price remains a scoring penalty, not an eligibility veto')
})

test('bot routing: invalid prices and out-of-range quality cannot earn a scoring advantage', () => {
  for (const price of [-1, Number.NaN, Infinity, '0']) {
    const result = routeBot({ preset: 'economy', candidates: [
      bot({ botId: 'a-invalid', pricePerMTokUsd: price }), bot({ botId: 'z-valid' }),
    ] })
    assert.equal(result.chosen.botId, 'z-valid', String(price))
    assert.equal(result.ranked.find(row => row.botId === 'a-invalid').pricePerMTokUsd, null)
  }
  for (const quality of [-1, 80, Number.NaN, Infinity, '0.9']) {
    const result = routeBot({ preset: 'quality', candidates: [
      bot({ botId: 'invalid', quality }), bot({ botId: 'valid', quality: 0.95 }),
    ] })
    assert.equal(result.chosen.botId, 'valid', String(quality))
    assert.equal(result.ranked.find(row => row.botId === 'invalid').quality, null)
    assert.ok(result.ranked.every(row => Number.isFinite(row.score) && row.score >= 0))
  }
  for (const quality of [0, 1]) {
    assert.equal(routeBot({ candidates: [bot({ quality, pricePerMTokUsd: 0 })] }).chosen.quality, quality)
  }
  const invalidLoad = routeBot({ candidates: [bot({ load: -100 })] })
  assert.equal(invalidLoad.chosen.score, routeBot({ candidates: [bot()] }).chosen.score)
})

test('bot routing: a busy Bot is skipped unless the task allows it, and ties break by id', () => {
  const busy = routeBot({ candidates: [bot({ botId: 'busy', busy: true })] })
  assert.equal(busy.reason, 'NO_BOT_ELIGIBLE')
  assert.equal(busy.chosen, null)
  assert.equal(routeBot({ task: { allowBusy: true }, candidates: [bot({ botId: 'busy', busy: true })] }).chosen.botId, 'busy')
  const tie = routeBot({ candidates: [bot({ botId: 'z' }), bot({ botId: 'a' })] })
  assert.equal(tie.chosen.botId, 'a')
})

test('bot routing: an empty candidate list is reported, not fabricated', () => {
  const empty = routeBot({ candidates: [] })
  assert.equal(empty.chosen, null)
  assert.equal(empty.reason, 'NO_BOT_CANDIDATES')
  assert.throws(() => routeBot({ preset: 'fastest', candidates: [] }), /INVALID_BOT_ROUTING_PRESET/)
})

test('bot routing: a Bot without a bound model never wins', () => {
  const result = routeBot({ candidates: [bot({ botId: 'unbound', model: null }), bot({ botId: 'bound' })] })
  assert.equal(result.chosen.botId, 'bound')
  assert.deepEqual(result.rejected, [{ botId: 'unbound', reason: 'BOT_MODEL_UNBOUND' }])
})

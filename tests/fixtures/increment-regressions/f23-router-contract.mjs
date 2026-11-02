// Controlled F23 (router/harness-plan) regression. It really reads and parses the materialized
// candidate product bytes and asserts the deterministic planning surface that harness-plan.mjs
// consumes. It never trusts the dirty governance root: every byte comes from --candidate-root.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

function value(name) {
  const index = process.argv.indexOf(`--${name}`)
  assert.ok(index > 0 && process.argv[index + 1] !== undefined, `missing --${name}`)
  return process.argv[index + 1]
}

const source = value('source').toUpperCase()
const baseline = value('baseline')
const candidate = value('candidate')
const incrementId = value('increment-id')
const candidateRoot = value('candidate-root')

assert.match(baseline, /^[0-9a-f]{40}$/, 'baseline must be a complete SHA')
assert.match(candidate, /^[0-9a-f]{40}$/, 'candidate must be a complete SHA')
assert.equal(incrementId, `${source}:${candidate}`, 'increment-id must be exactly SOURCE:candidate')

const routerPath = join(candidateRoot, '.dsh-plugin/shared/router.mjs')
const planPath = join(candidateRoot, '.dsh-plugin/shared/harness-plan.mjs')
const { buildPlan, detectTaskTypes } = await import(pathToFileURL(routerPath).href)
const { createPlanFromRoutes, channelForProvider } = await import(pathToFileURL(planPath).href)
const route = { provider: 'increment-offline', model: 'increment-model', quality: 0.9,
  pricing: { input: 1, output: 2, currency: 'USD' } }
assert.ok(detectTaskTypes('Implement code with tests').includes('code'))
const plan = buildPlan({ text: 'Implement code with tests', available: [route] })
assert.equal(plan.selected.provider, route.provider)
assert.equal(plan.selected.model, route.model)
assert.ok(Number.isFinite(plan.estimatedCost) && plan.estimatedCost >= 0)
const direct = createPlanFromRoutes('Explain caching', [route], {
  mode: 'direct', directProvider: route.provider, directModel: route.model,
})
assert.equal(direct.routingBypassed, true)
assert.equal(direct.selected.model, route.model)
assert.throws(() => createPlanFromRoutes('Explain caching', [route], {
  mode: 'direct', directProvider: route.provider, directModel: 'not-configured',
}))
assert.equal(channelForProvider(route.provider).kind, 'harness-llm')

process.stdout.write(`${JSON.stringify({
  regression: 'F23-router-contract',
  candidateRoot,
  candidate,
  checks: ['candidate-routing', 'candidate-price', 'exact-direct-model', 'unconfigured-model-rejection', 'api-channel'],
})}\n`)

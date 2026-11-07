import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The workbench dispatches panel actions through the product channel, not through the owner RPC and
// not through model tools. A UI test with a stub dispatch cannot see the difference, so this reads
// the composition source and checks that every action the panels call is registered there.
const source = readFileSync(new URL('../packages/orchestration/src/product-composition.mjs', import.meta.url), 'utf8')
const panel = ['panels.jsx', 'tasks-panel.jsx'].map(name => readFileSync(new URL(`../apps/integration-client/${name}`, import.meta.url), 'utf8')).join('\n')

/** Action names the panels dispatch, in call order, de-duplicated. */
const dispatched = [...new Set([...panel.matchAll(/dispatch\('([a-zA-Z][\w.]*)'/g)].map(match => match[1]))]

test('product channel: every action a panel dispatches is registered in the composition', () => {
  // `machine.*` actions are built from a name list rather than written out one by one.
  const dynamic = action => action.startsWith('machine.') && source.includes(".map(name=>[`machine.${name}`")
  const missing = dispatched.filter(action => !dynamic(action) && !source.includes(`'${action}'`) && !source.includes(`\`${action}\``))
  assert.deepEqual(missing, [], `these actions are dispatched by the UI but registered nowhere: ${missing.join(', ')}`)
})

test('product channel: the routing actions exist on both doors', () => {
  for (const action of ['botRoutingInspect', 'botRoutingDecide']) {
    assert.ok(source.includes(`'${action}'`), `${action} must be a product-channel action`)
  }
  // Same service behind the owner RPC, so a preview cannot disagree with a dispatch.
  assert.ok(source.includes("'botRouting.dispatch'"), 'dispatch action is registered')
  assert.ok(source.includes("'botRouting.status'"), 'the owner-only submission lookup is registered')
})

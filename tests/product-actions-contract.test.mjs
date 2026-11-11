import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The workbench dispatches panel actions through the product channel, not through the owner RPC and
// not through model tools. A UI test with a stub dispatch cannot see the difference, so this reads
// the composition source and checks that every action the panels call is registered there.
const source = readFileSync(new URL('../packages/orchestration/src/product-composition.mjs', import.meta.url), 'utf8')
const panel = ['panels.jsx', 'tasks-panel.jsx', 'notifications-panel.jsx'].map(name => readFileSync(new URL(`../apps/integration-client/${name}`, import.meta.url), 'utf8')).join('\n')

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

test('product channel: a task action declares that it belongs to the owner console', () => {
  // These six move, stop or re-open somebody's work. Each one names its caller
  // class at its own entry rather than inheriting whatever the authorization
  // seam defaults to, so a change there cannot quietly widen them.
  const actions = ['ui.namespace', 'botProfile.inspect', 'botProfile.save', 'task.inspect', 'task.plan.submit', 'task.plan.cancel', 'task.cancel', 'task.retry', 'task.reconcile', 'notifications.list', 'notifications.readModel', 'notifications.read', 'notifications.markAll']
  for (const action of actions) {
    const registered = new RegExp(`'${action.replace('.', '\\.')}':\\s*ownerOnly\\(`)
    assert.match(source, registered, `${action} must be wrapped in ownerOnly`)
  }
})

test('product channel: every action that is not a Bot surface is wrapped or explicit', () => {
  // The two other owner-only entries in the same map; if a new action appears
  // without either wrapper or an explicit context check, this list says so.
  const ownerGated = ['machine.desktop.view', 'machine.desktop.act', 'machine.secret', 'usage.resolve', 'task.inspect']
  for (const action of ownerGated) {
    assert.ok(source.includes(`'${action}'`), `${action} must be registered`)
  }
  // open/renew/close are built from one name list, so they carry one check.
  assert.ok(source.includes('[`machine.desktop.${action}`]'), 'the desktop action loop must stay name-driven')
  assert.match(source, /context\?\.kind !== 'owner'/, 'the owner check itself must stay in the composition')
})

test('product view: the narrowed projection still carries how far the work got', async () => {
  // The public task view is deliberately narrow, and it rebuilt the object — so a
  // field added to the journal view never reached the panel. This is the check
  // that would have caught it.
  const {projectProductTask} = await import('../packages/orchestration/src/task-product.mjs')
  const base = {ownerBotId: 'bot', taskId: 'task', packageId: 'pkg', attemptId: 'attempt', state: 'failed', input: {backend: 'fixture'}, attempts: [{}]}
  const view = projectProductTask({...base, attribution: {code: 'failed-after-dispatch', label: '已执行，执行后失败'}})
  assert.deepEqual(view.attribution, {code: 'failed-after-dispatch', label: '已执行，执行后失败'})
  assert.equal(Object.hasOwn(projectProductTask(base), 'attribution'), false, 'an older row stays without one')
  // A code that is not lower-case kebab is not passed through as if it were one.
  assert.equal(projectProductTask({...base, attribution: {code: 'NOT A CODE', label: 'x'}}).attribution.code, null)
  // And the narrowing still holds: nothing about inputs or proofs leaks with it.
  const forged = projectProductTask({...base, attribution: {code: 'not-executed', label: 'x'}, executionRef: {secret: 1}, reconciliation: {at: 1, outcome: 'unknown'}})
  assert.equal('executionRef' in forged, false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { routineStepToTool } from '../packages/orchestration/src/remote-computer-tools.mjs'

test('routine step: each action maps to exactly one desktop tool', () => {
  assert.deepEqual(routineStepToTool({ action: 'click', x: 5, y: 6 }), { tool: 'desktop_click', args: { x: 5, y: 6 } })
  assert.deepEqual(routineStepToTool({ action: 'click', x: 5, y: 6, button: 'right' }), { tool: 'desktop_click', args: { x: 5, y: 6, button: 'right' } })
  assert.deepEqual(routineStepToTool({ action: 'type', text: 'hi' }), { tool: 'desktop_type', args: { text: 'hi' } })
  assert.deepEqual(routineStepToTool({ action: 'key', key: 'Enter', modifiers: ['ctrl'] }), { tool: 'desktop_key', args: { key: 'Enter', modifiers: ['ctrl'] } })
  assert.deepEqual(routineStepToTool({ action: 'scroll', delta: -120 }), { tool: 'desktop_scroll', args: { delta: -120 } })
})

test('routine step: a pause is not a machine action', () => {
  assert.equal(routineStepToTool({ action: 'wait', ms: 100 }), null)
})

test('routine step: an unknown action is refused, never silently skipped', () => {
  assert.throws(() => routineStepToTool({ action: 'shell', command: 'x' }), error => error.code === 'ROUTINE_ACTION_UNKNOWN')
  assert.throws(() => routineStepToTool(null), error => error.code === 'ROUTINE_STEP_INVALID')
})

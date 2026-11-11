// The whole chain from a journal view to the line a person reads, for every
// attribution code. The running app only ever had a cancelled and a succeeded
// task, so the failure rows were never seen; this closes that gap at the level
// the panel actually uses instead of inventing a failure on the owner's machine.
//
// The expectations below were read off taskAttribution rather than guessed: the
// first draft of this test asserted '已执行，执行后失败' for a failure with no
// checkpoint evidence, and the code correctly refused to claim the work ran.
import assert from 'node:assert/strict'
import test from 'node:test'

const { taskAttribution } = await import('../packages/orchestration/src/task-stage.mjs')
const { projectProductTask } = await import('../packages/orchestration/src/task-product.mjs')
const { progressNote } = await import('../apps/integration-client/task-progress.mjs')
const { TASK_STATES } = await import('../apps/integration-client/api.mjs')

const row = (overrides) => ({
  ownerBotId: 'bot', taskId: 'task', packageId: 'pkg', attemptId: 'attempt', attempts: [{}],
  input: { backend: 'fixture' }, ...overrides,
})

// view state → what the journal view attaches, then what the panel renders.
const chain = (view) => {
  const withAttribution = { ...view, attribution: taskAttribution(view) }
  const projected = projectProductTask(withAttribution)
  const tag = TASK_STATES[projected.state] ?? projected.state
  return { tag, label: projected.attribution?.label ?? '', code: projected.attribution?.code ?? '', note: progressNote(projected, tag) }
}

test('attribution chain: every code survives the projection and reaches the panel', () => {
  const cases = [
    // [name, view, tag, label, note under the tag]
    ['failed before dispatch', row({ state: 'failed', result: { notStarted: true } }), '失败', '未执行：执行前失败', '未执行：执行前失败'],
    // A failure with no checkpoint behind it must not claim the work ran.
    ['failed, no evidence', row({ state: 'failed', result: { clientError: 'boom' } }), '失败', '失败，是否执行过未确认', '失败，是否执行过未确认'],
    ['failed after dispatch', row({ state: 'failed', result: { clientError: 'boom', authorization: { carriedOut: true } } }), '失败', '已执行，执行后失败', '已执行，执行后失败'],
    ['needs reconciliation', row({ state: 'needs-reconciliation' }), '等待收据核对', '已执行，结果未确认', '已执行，结果未确认'],
    ['cancelled, nothing ran', row({ state: 'cancelled', result: { notStarted: true } }), '已停止', '已取消，未执行', '已取消，未执行'],
    ['cancelled after dispatch', row({ state: 'cancelled', result: { authorization: { carriedOut: true } } }), '已停止', '已取消，执行已开始', '已取消，执行已开始'],
    ['blocked', row({ state: 'blocked' }), '受阻', '被拦下', '被拦下'],
    // These two carry nothing beyond the tag, so the note stays silent.
    ['succeeded', row({ state: 'succeeded' }), '已完成', '已完成', ''],
    ['skipped', row({ state: 'skipped' }), '未执行', '已取消，未执行', '已取消，未执行'],
  ]
  for (const [name, view, tag, label, note] of cases) {
    const got = chain(view)
    assert.equal(got.tag, tag, `${name}: tag`)
    assert.equal(got.label, label, `${name}: label`)
    assert.equal(got.note, note, `${name}: note`)
  }
})

test('attribution chain: the code reaches the panel as the same word the view produced', () => {
  // A code that changes shape in transit means the panel is reading a different
  // fact than the journal recorded, which is how the 0.66.2 defect happened.
  const views = [
    row({ state: 'failed', result: { notStarted: true } }),
    row({ state: 'failed', result: { authorization: { carriedOut: true } } }),
    row({ state: 'needs-reconciliation' }),
    row({ state: 'cancelled', result: { authorization: { carriedOut: true } } }),
    row({ state: 'succeeded' }),
  ]
  for (const view of views) {
    const produced = taskAttribution(view)
    const projected = projectProductTask({ ...view, attribution: produced })
    assert.equal(projected.attribution.code, produced.code, `${view.state}: code`)
  }
})

test('attribution chain: a row with no attribution renders no note and no crash', () => {
  const projected = projectProductTask(row({ state: 'failed' }))
  assert.equal(projected.attribution, undefined)
  assert.equal(progressNote(projected, '失败'), '')
})

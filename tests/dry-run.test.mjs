import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRunRequest } from '../.dsh-plugin/shared/official-tools-remote.mjs'
import { launchRequest } from '../.dsh-plugin/client/insights-state.mjs'
import { dryRunOutcome } from '../.dsh-plugin/index.mjs'

test('dry run: the RPC accepts an explicit boolean and refuses anything else', () => {
  assert.equal(parseRunRequest({ task: '整理文档', planMode: 'team', dryRun: true }).dryRun, true)
  assert.equal('dryRun' in parseRunRequest({ task: '整理文档' }), false)
  assert.throws(() => parseRunRequest({ task: 'x', dryRun: 'yes' }), /dryRun must be a boolean/)
  assert.throws(() => parseRunRequest({ task: 'x', dryRun: 1 }), /dryRun must be a boolean/)
})

test('dry run: the client request carries the flag through unchanged', () => {
  const request = launchRequest({ task: '整理文档', mode: 'team', dryRun: true })
  assert.equal(request.dryRun, true)
  assert.equal(request.executor, undefined, 'a rehearsal adds no executor of its own')
  assert.equal('dryRun' in launchRequest({ task: '整理文档', mode: 'team' }), false)
})

test('dry run: the outcome reports what would run, calls nothing, and says so', () => {
  const outcome = dryRunOutcome({
    preview: {
      workspace: 'D:/work/demo',
      budget: { exceeded: false },
      decision: {
        packages: [
          { id: 'p1', title: '读取项目结构', provider: 'deepseek', model: 'deepseek-v4', estimatedCostUsd: 0.02 },
          { id: 'p2', title: '核对测试命令', toolId: 'codex' },
          { id: 'p3', title: '未分配的工作包' },
        ],
      },
    },
  })
  assert.equal(outcome.status, 'planned')
  assert.equal(outcome.dryRun, true)
  assert.equal(outcome.runId, null)
  assert.equal(outcome.workspace, 'D:/work/demo')
  assert.equal(outcome.planned.length, 3)
  assert.equal(outcome.planned[0].wouldCall, 'deepseek/deepseek-v4')
  assert.equal(outcome.planned[0].order, 1)
  assert.equal(outcome.planned[1].wouldCall, 'codex')
  assert.equal(outcome.planned[2].wouldCall, '未分配')
  assert.equal(outcome.planned.every(item => item.dryRun === true), true)
  assert.match(outcome.notice, /本应执行 3 个工作包/)
  assert.match(outcome.notice, /没有调用任何模型或工具/)
})

test('dry run: an empty preview is still an honest rehearsal', () => {
  const outcome = dryRunOutcome({})
  assert.equal(outcome.planned.length, 0)
  assert.match(outcome.notice, /本应执行 0 个工作包/)
  assert.equal(outcome.decision, null)
})

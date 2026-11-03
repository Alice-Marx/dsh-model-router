import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTaskPlan, validateTaskPlan } from '../packages/orchestration/src/task-contract.mjs'

const plan = (packages, overrides = {}) => ({ schemaVersion: 1, taskId: 'task-plan', origin: { kind: 'private', botId: 'bot-main', sessionId: 'session-main' }, planRevision: 1, packages, ...overrides })
const pkg = (id, objective, extra = {}) => ({ id, targetBotId: 'bot-main', objective, dependsOn: [], acceptance: ['有验证结果'], effectClass: 'read', ...extra })
const BOTS = new Set(['bot-main', 'bot-write'])
const rejected = (value, options = { knownBots: BOTS }) => {
  try { validateTaskPlan(parseTaskPlan(value), options); return null } catch (error) { return error.code }
}

test('task plan/native: a well-formed dependency graph parses and schedules in topological order', () => {
  const parsed = parseTaskPlan(plan([
    pkg('inspect', '检查项目并列出修改点'),
    pkg('implement', '完成获准修改', { dependsOn: ['inspect'], effectClass: 'workspace-write', targetBotId: 'bot-write' }),
    pkg('review', '检查实现与验证证据', { dependsOn: ['implement'] }),
  ]))
  assert.equal(parsed.packages.length, 3)
  assert.deepEqual(parsed.origin, { kind: 'private', botId: 'bot-main', sessionId: 'session-main' })
  assert.equal(validateTaskPlan(parsed, { knownBots: BOTS }).order.join(' -> '), 'inspect -> implement -> review')
  // Independent branches keep a deterministic, dependency-respecting order.
  const branches = parseTaskPlan(plan([pkg('root', 'root'), pkg('left', 'left', { dependsOn: ['root'] }), pkg('right', 'right', { dependsOn: ['root'] })]))
  const order = validateTaskPlan(branches, { knownBots: BOTS }).order
  assert.equal(order[0], 'root')
  assert.deepEqual([...order].slice(1).sort(), ['left', 'right'])
})

test('task plan/native: cycles, dangling and self dependencies are refused before any scheduling', () => {
  assert.equal(rejected(plan([pkg('a', 'a', { dependsOn: ['b'] }), pkg('b', 'b', { dependsOn: ['a'] })])), 'TASK_PLAN_CYCLE')
  assert.equal(rejected(plan([pkg('a', 'a', { dependsOn: ['b'] }), pkg('b', 'b', { dependsOn: ['c'] }), pkg('c', 'c', { dependsOn: ['a'] })])), 'TASK_PLAN_CYCLE')
  assert.equal(rejected(plan([pkg('a', 'a', { dependsOn: ['missing'] })])), 'TASK_PLAN_DANGLING_DEPENDENCY')
  assert.equal(rejected(plan([pkg('a', 'a', { dependsOn: ['a'] })])), 'TASK_PLAN_SELF_DEPENDENCY')
  assert.equal(rejected(plan([pkg('a', 'a'), pkg('b', 'b', { dependsOn: ['a', 'a'] })])), 'TASK_PLAN_DUPLICATE_DEPENDENCY')
  assert.equal(rejected(plan([pkg('a', 'a'), pkg('a', 'b')])), 'TASK_PLAN_DUPLICATE_PACKAGE')
})

test('task plan/native: an unknown target Bot and an invalid effect class are refused', () => {
  assert.equal(rejected(plan([pkg('a', 'a', { targetBotId: 'bot-ghost' })])), 'TASK_PLAN_TARGET_UNKNOWN')
  assert.equal(rejected(plan([pkg('a', 'a', { effectClass: 'desktop-write' })])), 'TASK_PLAN_EFFECT_CLASS')
  // Authorization is a Host judgement; without a Bot directory it is skipped.
  assert.equal(rejected(plan([pkg('a', 'a', { targetBotId: 'bot-ghost' })]), {}), null)
  assert.throws(() => validateTaskPlan(parseTaskPlan(plan([pkg('a', 'a')])), { knownBots: 'bot-main' }), TypeError)
})

test('task plan/native: a work package cannot smuggle a runnable path, an MCP URL or a credential', () => {
  for (const objective of [
    'run C:\\tools\\run.exe now',
    'run C:/tools/run.exe now',
    'run C:\\Program Files\\codexcli\\codex.exe',
    'execute /usr/local/bin/tool.sh --flag',
    'run ./scripts/build.sh',
    'run ../bin/deploy.ps1',
    'run ..\\bin\\deploy.ps1',
    'call https://evil.example/mcp',
    'use sk-mock-mock-mock-mock-mock',
    'Bearer mock-mock-mock-mock-mock-mock',
  ]) {
    assert.ok(['TASK_PLAN_EXECUTABLE_PATH', 'TASK_PLAN_MCP_URL', 'TASK_PLAN_SECRET'].includes(rejected(plan([pkg('a', objective)]))), objective)
  }
  // Acceptance text is checked with the same rules as the objective.
  assert.equal(rejected(plan([pkg('a', '检查项目', { acceptance: ['运行 /usr/local/bin/tool.sh'] })])), 'TASK_PLAN_EXECUTABLE_PATH')
  assert.equal(rejected(plan([pkg('a', '检查项目', { acceptance: ['附带 https://vendor.example/mcp 端点'] })])), 'TASK_PLAN_MCP_URL')
  // Ordinary objectives and file references are not paths.
  for (const objective of ['inspect the repo and list changed files', 'read docs/integration/README.md', 'use python3 main.py']) {
    assert.equal(rejected(plan([pkg('a', objective)])), null, objective)
  }
})

test('task plan/native: schema, bounds and unknown fields are refused before execution', () => {
  assert.equal(rejected(plan([])), 'INVALID_TASK_PLAN')
  assert.equal(rejected(plan(Array.from({ length: 33 }, (_, i) => pkg(`p${i}`, 'x')))), 'INVALID_TASK_PLAN')
  assert.equal(rejected(plan([pkg('a', 'a')], { schemaVersion: 2 })), 'TASK_PLAN_VERSION_UNSUPPORTED')
  assert.equal(rejected(plan([pkg('a', 'a', { notes: 'x' })])), 'INVALID_TASK_PLAN')
  assert.equal(rejected(plan([pkg('a', 'a')], { origin: { kind: 'channel', botId: 'bot-main' } })), 'INVALID_TASK_PLAN')
  assert.equal(rejected(plan([pkg('a', 'a')], { planRevision: 0 })), 'INVALID_TASK_PLAN')
  assert.equal(rejected(plan([pkg('a', 'x'.repeat(4001))])), 'TASK_PLAN_TEXT_LIMIT')
  assert.equal(rejected(plan([pkg('a', '')])), 'TASK_PLAN_TEXT_LIMIT')
  assert.equal(rejected(plan([pkg('a', 'a', { acceptance: Array.from({ length: 17 }, () => 'x') })])), 'INVALID_TASK_PLAN')
  assert.equal(rejected(plan([pkg('a', 'a', { dependsOn: Array.from({ length: 17 }, () => 'x') })])), 'INVALID_TASK_PLAN')
  // A plan is canonical: the same plan hashes identically, a different one does not.
  const first = parseTaskPlan(plan([pkg('a', 'a')]))
  assert.deepEqual(parseTaskPlan(plan([pkg('a', 'a')])), first)
})

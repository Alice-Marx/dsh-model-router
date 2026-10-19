import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import { initialPackageAssignments, launchRequest, manualAssignmentOptions } from '../.dsh-plugin/client/insights-state.mjs'
import { packagePlanKey } from '../.dsh-plugin/shared/package-assignments.mjs'

const task = 'fixture task'
const routes = [{ provider: 'vendor/api', model: 'exact/model:high' }, { provider: 'other', model: 'm' }]
const plan = { mode: 'single', selected: { provider: 'vendor/api', model: 'exact/model:high' },
  complexity: { band: 'simple', value: 0.2 }, preset: 'balanced', estimatedCost: 0.01, optimization: {},
  team: { workPackages: [{ id: 'p1', name: '独立工作包', recommendedProvider: 'vendor/api', recommendedModel: 'exact/model:high',
    objective: task, type: 'code', purpose: 'execution', dependsOn: [], verificationChecklist: ['fixture check'] },
  { id: 'p2', name: '结果整合', recommendedProvider: 'other', recommendedModel: 'm',
    type: 'reasoning', purpose: 'synthesis', dependsOn: ['p1'], verificationChecklist: [] }] } }
const request = { task, mode: 'team', budgetUsd: 1, preset: 'balanced', workspace: 'F:/fixture' }
const key = packagePlanKey(plan, task)

test('editable initial bindings preserve exact route identifiers without mutating the plan', () => {
  const before = JSON.stringify(plan)
  const one = initialPackageAssignments(plan)
  const two = initialPackageAssignments(plan)
  assert.deepEqual(one.p1, { kind: 'api', provider: 'vendor/api', model: 'exact/model:high' })
  one.p1.model = 'edited'
  assert.equal(two.p1.model, 'exact/model:high')
  assert.equal(JSON.stringify(plan), before)
  assert.deepEqual(initialPackageAssignments(null), {})
  assert.deepEqual(initialPackageAssignments({ ...plan, routingBypassed: true }), {})
})

test('algorithm launch ignores stale manual bindings and keeps its original request shape', () => {
  const expected = { task, planMode: 'team', preset: 'balanced', budgetUsd: 1, workspace: 'F:/fixture' }
  assert.deepEqual(launchRequest(request), expected)
  assert.deepEqual(launchRequest({ ...request, assignmentMode: 'algorithm', packageAssignments: { arbitrary: 'stale' }, packagePlanKey: 'stale' }), expected)
})

test('manual launch serializes mixed exact API and tool bindings with a decomposition key', () => {
  const bindings = { ...initialPackageAssignments(plan), p2: { kind: 'tool', toolId: 'codex' } }
  const result = launchRequest({ ...request, assignmentMode: 'manual', packageAssignments: bindings, packagePlanKey: key })
  assert.equal(result.assignmentMode, 'manual')
  assert.equal(result.packagePlanKey, key)
  assert.deepEqual(result.packageAssignments, bindings)
  bindings.p2.toolId = 'gemini'
  assert.equal(result.packageAssignments.p2.toolId, 'codex')
})

test('manual launch forces routed read-only execution even with stale editable team settings', () => {
  const result = launchRequest({ ...request, assignmentMode: 'manual', packagePlanKey: key,
    packageAssignments: initialPackageAssignments(plan), executor: 'official-team', executionMode: 'workspace-write', executionEnvironment: 'cli-native' })
  assert.equal(result.executor, undefined)
  assert.equal(result.executionMode, undefined)
  assert.equal(result.executionEnvironment, undefined)
  assert.equal(result.assignmentMode, 'manual')
})

test('manual launch rejects direct mode, missing keys and unexpected target fields', () => {
  const manual = { ...request, assignmentMode: 'manual', packagePlanKey: key, packageAssignments: initialPackageAssignments(plan) }
  assert.throws(() => launchRequest({ ...manual, mode: 'direct', directRoute: routes[0] }))
  assert.throws(() => launchRequest({ ...manual, packagePlanKey: '' }))
  assert.throws(() => launchRequest({ ...manual, packageAssignments: undefined }))
  assert.throws(() => launchRequest({ ...manual, packageAssignments: {} }))
  assert.throws(() => launchRequest({ ...manual, packageAssignments: { p1: { kind: 'tool', toolId: 'codex', command: 'arbitrary' } } }))
  assert.throws(() => launchRequest({ ...request, assignmentMode: 'unknown' }))
})

test('tool options use known installation, readiness and supported modes without inventing readiness', () => {
  const option = (snapshot, health) => manualAssignmentOptions(routes, snapshot, health).find(item => item.binding.toolId === 'codex')
  assert.equal(option(null, null).disabled, true)
  const installed = { probes: [{ id: 'codex', installed: true }] }
  assert.equal(option(installed).disabled, false)
  assert.match(option(installed).label, /待执行预览核验/)
  assert.equal(option({ ...installed, readiness: [{ id: 'codex', ready: false, reason: 'fixture blocked' }] }).disabled, true)
  assert.equal(option({ ...installed, readiness: [{ id: 'codex', ready: true, readyModes: ['workspace-write'] }] }).disabled, true)
  assert.equal(option({ ...installed, capabilities: [{ id: 'codex', supported: false }] }).disabled, true)
  assert.equal(option(installed, { tools: [{ id: 'codex', installed: true, login: { state: 'logged-out' } }] }).disabled, true)
  assert.equal(option({ probes: [{ id: 'codex', installed: false }] }, { tools: [{ id: 'codex', installed: true }] }).disabled, true)
  assert.equal(option({ ...installed, readiness: [{ id: 'codex', ready: true, readyModes: ['read-only'] }] }).disabled, false)
  const api = manualAssignmentOptions(routes).find(item => item.binding.kind === 'api')
  assert.equal(api.binding.provider, 'vendor/api')
  assert.equal(api.binding.model, 'exact/model:high')
})

let componentPromise
async function planResults() {
  componentPromise ??= build({ entryPoints: [fileURLToPath(new URL('../.dsh-plugin/client/router-main.jsx', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], loader: { '.css': 'text' }, logLevel: 'silent' })
    .then(result => {
      const module = { exports: {} }
      new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
      return module.exports.PlanResults
    })
  return componentPromise
}

test('single-plan rendering exposes labeled per-package choices and keeps recommendations visible', async () => {
  const Component = await planResults()
  const html = renderToStaticMarkup(React.createElement(Component, { plan, assignmentMode: 'manual',
    packageAssignments: initialPackageAssignments(plan), assignmentOptions: manualAssignmentOptions(routes) }))
  assert.match(html, /按算法推荐分配/)
  assert.match(html, /手动调整分配/)
  assert.match(html, /恢复推荐分配/)
  assert.match(html, /独立工作包 执行目标/)
  assert.match(html, /官方工具（默认模型）/)
  assert.match(html, /算法推荐：/)
  assert.match(html, /具体目标：fixture task/)
  assert.match(html, /依赖：独立工作包/)
})

test('direct plans hide manual controls and policy-disabled plans explain the unavailable switch', async () => {
  const Component = await planResults()
  const direct = renderToStaticMarkup(React.createElement(Component, { plan: { ...plan, mode: 'direct', routingBypassed: true } }))
  assert.doesNotMatch(direct, /手动调整分配/)
  const disabled = renderToStaticMarkup(React.createElement(Component, { plan, manualAllowed: false }))
  assert.match(disabled, /设置中已关闭手动改派/)
  assert.match(disabled, /disabled=""[^>]*title="设置中已关闭手动改派"/)
})

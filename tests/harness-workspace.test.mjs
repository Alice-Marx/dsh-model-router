import test from 'node:test'
import assert from 'node:assert/strict'
import { routesFromModelCatalog, createWorkspacePlan } from '../.dsh-plugin/client/catalog.mjs'

const catalog = {
  routableProviders: ['deepseek-account', 'other-provider'],
  groups: [
    { id: 'deepseek-account', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'low' } }] },
    { id: 'other-provider', name: 'Other', models: [{ id: 'other-model', name: 'Other Model' }] },
    { id: 'unroutable', name: 'Unroutable', models: [{ id: 'should-not-appear' }] },
  ],
  failures: [{ id: 'unroutable', name: 'Unroutable', message: 'offline' }],
}

test('workspace catalog includes only official routable provider/model pairs', () => {
  const routes = routesFromModelCatalog(catalog)
  assert.deepEqual(routes.map(route => `${route.provider}/${route.model}`), [
    'deepseek-account/deepseek-v4-flash',
    'other-provider/other-model',
  ])
  assert.deepEqual(routes[0].reasoningEfforts, ['low', 'high'])
  assert.equal(routes[0].defaultReasoningEffort, 'low')
  assert.deepEqual(routes[0].inputModalities, [])
})

test('workspace plan is local and emits Agent Teams work packages', () => {
  const plan = createWorkspacePlan('分析代码架构，修复接口问题并验收交付', catalog, { mode: 'team', budgetUsd: 1 })
  assert.equal(plan.mode, 'team')
  assert.equal(plan.availableRoutes.length, 2)
  assert.ok(plan.selected)
  assert.ok(plan.team.workPackages.length > 0)
  assert.ok(plan.team.workPackages.every(item => Array.isArray(item.verificationChecklist)))
  assert.equal(plan.optimization.budgetUsd, 1)
})

test('workspace catalog handles empty and malformed provider rows', () => {
  assert.deepEqual(routesFromModelCatalog(null), [])
  assert.deepEqual(routesFromModelCatalog({ groups: [{ id: '', models: [{ id: 'x' }] }], routableProviders: [''] }), [])
  assert.throws(() => createWorkspacePlan(' ', catalog), /task must contain text/)
})

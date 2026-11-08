import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ROUTER_CAPABILITY, apiEngines, brainSummary, engineMark, engineSetup, engineStatus, filterModels, initialEngine,
  officialEngines, pickModel, routerAccess, setRouterAccess, suggestedModels, toggleDelegation,
} from '../apps/integration-client/brain-catalog.mjs'
import { projectOfficialEngines } from '../.dsh-plugin/shared/official-engines.mjs'

const catalog = {
  models: [
    { provider: 'openai', model: 'gpt-exact', cliModels: [{ toolId: 'codex', model: 'gpt-exact' }, { toolId: 'codex', model: 'gpt-exact' }] },
    { provider: 'openai', model: 'gpt-mini', cliModels: [{ toolId: 'codex', model: 'gpt-mini' }] },
    { provider: 'deepseek', model: 'deepseek-chat', cliModels: [] },
  ],
  tools: [{ toolId: 'codex', modes: ['read-only'], grantTools: ['cli/codex'] }],
  capabilities: [{ id: 'model-inference' }, { id: ROUTER_CAPABILITY }],
}
const view = projectOfficialEngines({ now: 2_000, report: { checkedAt: 1_000, tools: [
  { id: 'codex', installed: true, version: '0.80.0', login: { state: 'logged-in', command: 'codex login' } },
  { id: 'claude-code', installed: true, version: '2.1.300', login: { state: 'logged-out', command: 'claude auth login', detail: '未登录' } },
  { id: 'gemini', installed: false, login: { state: 'unknown' } },
] }, capabilities: [{ id: 'codex', supported: true, modes: ['read-only'] }] })
const empty = { model: '', officialTools: [], capabilities: ['model-inference'] }

test('brain catalog: API engines group exact routes by provider and dedupe CLI mappings', () => {
  const engines = apiEngines(catalog)
  assert.deepEqual(engines.map(engine => [engine.id, engine.models.map(model => model.ref)]), [
    ['api:openai', ['openai/gpt-exact', 'openai/gpt-mini']], ['api:deepseek', ['deepseek/deepseek-chat']]])
  assert.deepEqual(engines[0].models[0].cliTools, ['codex'])
  assert.deepEqual(engineStatus(engines[1]), { tone: 'success', text: '1 个模型' })
  assert.equal(initialEngine(engines, 'deepseek/deepseek-chat'), 'api:deepseek')
  assert.equal(initialEngine(engines, ''), 'api:openai')
})

test('brain catalog: official engines show readiness and only the delegations the Host verified', () => {
  const engines = officialEngines(view, catalog)
  const codex = engines.find(engine => engine.toolId === 'codex')
  const claude = engines.find(engine => engine.toolId === 'claude-code')
  assert.deepEqual(codex.delegations, [
    { ref: 'openai/gpt-exact', cliModel: 'gpt-exact', modes: ['read-only'] }, { ref: 'openai/gpt-mini', cliModel: 'gpt-mini', modes: ['read-only'] }])
  assert.deepEqual(engineStatus(codex), { tone: 'success', text: 'v0.80.0' })
  assert.equal(engineSetup(codex), null)
  assert.deepEqual(claude.delegations, [], 'a tool the catalog does not offer has nothing to delegate')
  assert.deepEqual(engineStatus(claude), { tone: 'warning', text: '需要登录' })
  assert.equal(engineSetup(claude).command, 'claude auth login')
  assert.equal(engineStatus(engines.find(engine => engine.toolId === 'gemini')).text, '需要安装')
  assert.equal(engineStatus(engines.find(engine => engine.toolId === 'pi')).text, '尚未体检', 'a tool absent from the report is unchecked, not missing')
})

test('brain catalog: picking a brain keeps only delegations verified for that route', () => {
  let selection = pickModel(empty, 'openai/gpt-exact', catalog)
  selection = toggleDelegation(selection, { toolId: 'codex', cliModel: 'gpt-exact', ref: 'openai/gpt-exact', mode: 'read-only' }, catalog)
  assert.deepEqual(selection.officialTools, [{ toolId: 'codex', cliModel: 'gpt-exact', mode: 'read-only' }])
  assert.deepEqual(pickModel(selection, 'deepseek/deepseek-chat', catalog).officialTools, [])
  assert.equal(pickModel(selection, 'missing/model', catalog), selection, 'a route outside the catalog is not accepted')
  const detached = toggleDelegation(selection, { toolId: 'codex', cliModel: 'gpt-exact', ref: 'openai/gpt-exact' }, catalog)
  assert.deepEqual(detached.officialTools, [])
})

test('brain catalog: a delegation for another route moves the brain with it', () => {
  const start = pickModel(empty, 'deepseek/deepseek-chat', catalog)
  const moved = toggleDelegation(start, { toolId: 'codex', cliModel: 'gpt-mini', ref: 'openai/gpt-mini', mode: 'read-only' }, catalog)
  assert.equal(moved.model, 'openai/gpt-mini')
  assert.deepEqual(moved.officialTools, [{ toolId: 'codex', cliModel: 'gpt-mini', mode: 'read-only' }])
  assert.equal(toggleDelegation(start, { toolId: 'codex', cliModel: 'x', ref: 'gone/route' }, catalog), start)
})

test('brain catalog: router access is the one model-router capability, nothing else changes', () => {
  const on = setRouterAccess(empty, true)
  assert.deepEqual(on.capabilities, ['model-inference', ROUTER_CAPABILITY])
  assert.equal(routerAccess(on), true)
  assert.deepEqual(setRouterAccess(setRouterAccess(on, true), false).capabilities, ['model-inference'])
})

test('brain catalog: search, suggestions and the trigger summary', () => {
  const models = Array.from({ length: 8 }, (_, index) => ({ ref: `p/m${index}`, provider: 'p', label: `m${index}` }))
  assert.deepEqual(suggestedModels(models, 'p/m7').map(model => model.ref), ['p/m0', 'p/m1', 'p/m2', 'p/m3', 'p/m7'])
  assert.deepEqual(filterModels(models, 'M3').map(model => model.ref), ['p/m3'])
  const summary = brainSummary(setRouterAccess(pickModel(empty, 'openai/gpt-exact', catalog), true), catalog)
  assert.equal(summary.title, 'gpt-exact')
  assert.equal(summary.detail, 'openai · 可调用官方工具')
  assert.equal(brainSummary(empty, catalog).title, '选择大脑')
  assert.equal(engineMark('MiniMax Code', 'minimax-code').letters, 'MM')
  assert.equal(engineMark('MiMo Code', 'mimo-code').letters, 'Mi')
  assert.equal(engineMark('deepseek').letters, 'De')
})

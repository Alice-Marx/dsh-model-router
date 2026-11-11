import test from 'node:test'
import assert from 'node:assert/strict'
import {
  accountFor, bindingProblems, buildBinding, defaultMode, failureText, findModel, numberOrNull, providerGroups,
  routeOf, scopeAllows, seedForm, splitRoute, textOf, toolCards, workspaceOptions,
} from '../apps/integration-client/binding-model.mjs'

const catalog = {
  models: [
    { provider: 'openai', model: 'gpt-5', label: 'openai/gpt-5', cliModels: [{ toolId: 'codex', model: 'gpt-5-codex' }] },
    { provider: 'openai', model: 'gpt-5-mini', label: 'openai/gpt-5-mini', cliModels: [] },
    { provider: 'anthropic', model: 'claude-sonnet-4', label: 'anthropic/claude-sonnet-4', cliModels: [] },
  ],
  tools: [{ toolId: 'codex', label: 'Codex CLI', vendor: 'OpenAI', source: '厂商官方 CLI', modes: ['read-only'], grantTools: ['cli/codex', 'cli/cancel'] }],
  machines: [{ machineId: 'local-host', label: '本机', location: 'local', status: 'ready',
    roots: [{ rootId: 'default', label: '默认工作区', modes: ['read-only', 'workspace-write'], capabilities: [] }] }],
  capabilities: [{ id: 'model-inference', label: '模型推理', tools: ['model/infer'] }],
  fundingScopes: [{ id: 'scope-openai', label: 'openai', modes: ['api', 'subscription'] }],
}
const accounts = { status: 'available', items: [
  { id: 'scope-openai', provider: 'openai', revision: 4, enabled: true, dailyLimitUsd: 10, monthlyLimitUsd: 100 },
  { id: 'scope-anthropic', provider: 'anthropic', revision: 2, enabled: false, dailyLimitUsd: null, monthlyLimitUsd: null },
] }
const settings = (patch = {}) => ({ schemaVersion: 1, enabled: false, model: null, officialTools: [], machineGrants: [], capabilities: [], workspaceRef: null, routing: null,
  funding: { mode: 'api', scopeId: null, pricing: null, request: null, dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: null }, maxConcurrentTasks: 2, ...patch })
const record = (patch = {}) => ({ botId: 'writer', revision: 7, settings: settings(), catalog, status: 'blocked', blockedReason: '尚未配置。', nextAction: '选择模型。', ...patch })
const form = (patch = {}) => ({ ...seedForm(record()), ...patch })

test('binding state: providers and routes come only from the trusted catalog', () => {
  const groups = providerGroups(catalog)
  assert.deepEqual(groups.map(item => item.provider), ['anthropic', 'openai'])
  assert.deepEqual(groups.at(-1).models.map(item => item.route), ['openai/gpt-5', 'openai/gpt-5-mini'])
  assert.equal(findModel(catalog, 'openai/gpt-5').model, 'gpt-5')
  assert.equal(findModel(catalog, 'openai/gpt-4'), null)
  assert.equal(routeOf({ provider: 'a', model: 'b' }), 'a/b')
  assert.deepEqual(splitRoute('a/b'), { provider: 'a', model: 'b' })
  assert.deepEqual(workspaceOptions(catalog).flatMap(item => item.roots.map(root => root.modes)), [['read-only', 'workspace-write']])
  assert.equal(accountFor(accounts, 'openai').id, 'scope-openai')
  assert.equal(accountFor(accounts, 'gemini'), null)
})

test('binding state: a blank number stays null and a stored zero stays zero', () => {
  assert.equal(numberOrNull(''), null)
  assert.equal(numberOrNull('   '), null)
  assert.equal(numberOrNull(null), null)
  assert.equal(numberOrNull('0'), 0)
  assert.equal(numberOrNull('2.5'), 2.5)
  assert.equal(textOf(null), '')
  assert.equal(textOf(0), '0')
  assert.equal(textOf(12), '12')
})

test('binding state: a half-filled funding group is sent as null, never as zeros', () => {
  const built = buildBinding({ form: form({ fundingMode: 'api', input: '1.5', output: '', daily: '', monthly: '30' }),
    model: findModel(catalog, 'openai/gpt-5'), account: accounts.items[0], machine: catalog.machines[0], root: catalog.machines[0].roots[0] })
  assert.equal(built.funding.pricing, null)
  assert.equal(built.funding.request, null)
  assert.equal(built.funding.dailyBudgetUsd, null)
  assert.equal(built.funding.monthlyBudgetUsd, 30)
  assert.equal(built.funding.scopeId, 'scope-openai')
  const subscription = buildBinding({ form: form({ fundingMode: 'subscription', dailyCalls: '', monthlyCalls: '200' }),
    model: findModel(catalog, 'openai/gpt-5'), account: accounts.items[0], machine: null, root: null })
  assert.equal(subscription.funding.subscription, null)
  assert.equal(subscription.machineGrants.length, 0)
  assert.equal(subscription.workspaceRef, null)
})

test('binding state: the stored payload keeps the committed shape', () => {
  const built = buildBinding({ form: form({ enabled: true, provider: 'openai', model: 'openai/gpt-5', workspace: 'local-host/default', workspaceMode: 'workspace-write',
      fundingMode: 'api', input: '1', output: '2', maxInputTokens: '1000', maxOutputTokens: '4096', daily: '5', monthly: '50',
      capabilities: ['model-inference'], officialTools: [{ toolId: 'codex', cliModel: 'gpt-5-codex', mode: 'read-only' }],
      routing: { preset: 'balanced', dailyBudgetUsd: '', monthlyBudgetUsd: '' } }),
    model: findModel(catalog, 'openai/gpt-5'), account: accounts.items[0], machine: catalog.machines[0], root: catalog.machines[0].roots[0] })
  assert.equal(built.schemaVersion, 1)
  assert.deepEqual(built.model, { provider: 'openai', model: 'gpt-5' })
  assert.deepEqual(built.officialTools, [{ toolId: 'codex', cliModel: 'gpt-5-codex', mode: 'read-only' }])
  assert.deepEqual(built.machineGrants, [{ machineId: 'local-host', rootId: 'default', mode: 'workspace-write', capabilities: [] }])
  assert.deepEqual(built.workspaceRef, { kind: 'local', machineId: 'local-host', rootId: 'default' })
  assert.deepEqual(built.funding.pricing, { input: 1, output: 2 })
  assert.deepEqual(built.funding.request, { maxInputTokens: 1000, maxOutputTokens: 4096 })
  assert.deepEqual(built.routing, { preset: 'balanced', dailyBudgetUsd: null, monthlyBudgetUsd: null })
  assert.equal(built.maxConcurrentTasks, 2)
})

test('binding state: seeding reads committed values instead of inventing defaults', () => {
  const seeded = seedForm(record({ settings: settings({ model: { provider: 'openai', model: 'gpt-5' }, enabled: true,
    officialTools: [{ toolId: 'codex', cliModel: 'gpt-5-codex', mode: 'read-only' }],
    workspaceRef: { kind: 'local', machineId: 'local-host', rootId: 'default' },
    machineGrants: [{ machineId: 'local-host', rootId: 'default', mode: 'read-only', capabilities: [] }],
    funding: { mode: 'subscription', scopeId: 'scope-openai', pricing: null, request: null, dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: { dailyCalls: 20, monthlyCalls: 200 } },
    routing: { preset: null, dailyBudgetUsd: null, monthlyBudgetUsd: null } }) }), accounts)
  assert.equal(seeded.provider, 'openai')
  assert.equal(seeded.model, 'openai/gpt-5')
  assert.equal(seeded.workspace, 'local-host/default')
  assert.equal(seeded.workspaceMode, 'read-only')
  assert.deepEqual(seeded.officialTools, [{ toolId: 'codex', cliModel: 'gpt-5-codex', mode: 'read-only' }])
  assert.equal(seeded.fundingMode, 'subscription')
  assert.equal(seeded.dailyCalls, '20')
  assert.equal(seeded.input, '')
  assert.equal(seeded.daily, '')
  assert.equal(seeded.maxConcurrentTasks, '2')
  assert.deepEqual(seeded.capabilities, [])
  // The funding scope's own limits are shown, not a placeholder number.
  assert.equal(seeded.accountDaily, '10')
  assert.equal(seeded.accountMonthly, '100')
})

test('binding state: official tool cards only offer verified CLI identities and offered modes', () => {
  const cards = toolCards({ catalog, model: findModel(catalog, 'openai/gpt-5'), grants: [{ toolId: 'codex', cliModel: 'gpt-5-codex', mode: 'read-only' }] })
  assert.equal(cards.length, 1)
  assert.deepEqual(cards[0].identities.map(item => item.model), ['gpt-5-codex'])
  assert.equal(cards[0].stale, false)
  assert.deepEqual(cards[0].modes, ['read-only'])
  assert.equal(defaultMode(cards[0].modes), 'read-only')
  const unverified = toolCards({ catalog, model: findModel(catalog, 'openai/gpt-5-mini'), grants: [{ toolId: 'codex', cliModel: 'gpt-5-codex', mode: 'read-only' }] })
  assert.deepEqual(unverified[0].identities, [])
  assert.equal(unverified[0].stale, true)
  assert.equal(toolCards({ catalog: { ...catalog, tools: [] }, model: null, grants: [] }).length, 0)
})

test('binding state: a disabled funding scope or a withdrawn mode blocks the save with the real reason', () => {
  const base = { form: form({ enabled: true, provider: 'openai', model: 'openai/gpt-5', workspace: 'local-host/default',
      fundingMode: 'api', input: '1', output: '2', maxInputTokens: '10', maxOutputTokens: '20', daily: '5', monthly: '50' }),
    model: findModel(catalog, 'openai/gpt-5'), machine: catalog.machines[0], root: catalog.machines[0].roots[0], catalog }
  assert.deepEqual(bindingProblems({ ...base, account: accounts.items[0], scope: catalog.fundingScopes[0] }), [])
  assert.deepEqual(bindingProblems({ ...base, account: accounts.items[1], scope: null }), ['anthropic 资金范围尚未启用；它不是厂商余额，需要本地预算上限。'])
  assert.deepEqual(bindingProblems({ ...base, account: accounts.items[0], scope: { id: 'scope-openai', modes: ['subscription'] } }), ['资金范围不支持所选渠道或准确模型，请重新选择。'])
  const stale = bindingProblems({ ...base, account: accounts.items[0], scope: catalog.fundingScopes[0], form: { ...base.form, officialTools: [{ toolId: 'codex', cliModel: 'gpt-5-codex', mode: 'read-only' }] } })
  assert.equal(stale.length, 0)
  const unverified = bindingProblems({ ...base, account: accounts.items[0], scope: catalog.fundingScopes[0], form: { ...base.form, officialTools: [{ toolId: 'codex', cliModel: 'other-codex', mode: 'read-only' }] } })
  assert.deepEqual(unverified, ['codex / other-codex 的 CLI 执行身份尚未核验，请移除后重新授予。'])
  const wide = bindingProblems({ ...base, account: accounts.items[0], scope: catalog.fundingScopes[0], form: { ...base.form, officialTools: [{ toolId: 'codex', cliModel: 'gpt-5-codex', mode: 'workspace-write' }] } })
  assert.deepEqual(wide, ['codex 尚未获准使用该执行模式，请移除或改选宿主提供的模式。'])
})

test('binding state: a disabled binding only needs a usable concurrency', () => {
  const problems = bindingProblems({ form: form({ enabled: false }), model: null, account: null, machine: null, root: null, catalog, scope: null })
  assert.deepEqual(problems, [])
  assert.deepEqual(bindingProblems({ form: form({ enabled: false, maxConcurrentTasks: '' }), model: null, account: null, machine: null, root: null, catalog, scope: null }),
    ['最大并发任务数必须是 1 至 32 的整数。'])
})

test('binding state: funding scopes only cover the modes and routes the Host published', () => {
  assert.equal(scopeAllows({ modes: ['api'], models: [] }, 'api', 'openai/gpt-5'), true)
  assert.equal(scopeAllows({ modes: ['api'] }, 'subscription', 'openai/gpt-5'), false)
  assert.equal(scopeAllows({ modes: ['api', 'subscription'], models: [{ provider: 'openai', model: 'gpt-5' }] }, 'api', 'openai/gpt-5-mini'), false)
  assert.equal(scopeAllows(null, 'api', 'openai/gpt-5'), false)
})

test('binding state: Host failures are reported with their own reason', () => {
  assert.match(failureText({ code: 'BOT_SETTINGS_CONFLICT' }), /另一窗口/)
  assert.match(failureText({ code: 'REMOTE_OWNER_REQUIRED' }), /拥有者/)
  assert.match(failureText({ code: 'BOT_SETTINGS_SCOPE_DENIED', message: 'codex 与当前模型的 CLI 身份尚未核验。' }), /CLI 身份尚未核验/)
  assert.match(failureText({ message: '宿主离线' }), /宿主离线/)
  assert.match(failureText(null), /保存失败/)
})

test('official CLI identities belong to the tool, independent of the selected chat route', () => {
  const trusted = { ...catalog, tools: [{ ...catalog.tools[0], status: 'ready', installed: true, loginState: 'logged-in',
    identities: [{ model: 'vendor-default', label: '厂商默认模型（由 CLI 配置决定）' }, { model: 'legacy-codex', label: '已配置模型' }] }] }
  const chatModel = findModel(trusted, 'anthropic/claude-sonnet-4')
  const cards = toolCards({ catalog: trusted, model: chatModel, grants: [{ toolId: 'codex', cliModel: 'vendor-default', mode: 'read-only' }] })
  assert.equal(cards[0].available, true)
  assert.equal(cards[0].stale, false)
  assert.deepEqual(cards[0].identities.map(identity => identity.model), ['vendor-default', 'legacy-codex'])
  assert.equal(toolCards({ catalog: trusted, model: chatModel, grants: [{ toolId: 'codex', cliModel: 'legacy-codex', mode: 'read-only' }] })[0].stale, false,
    'a Host-preserved exact CLI configuration is valid across chat providers too')
  const current = form({ enabled: true, model: 'anthropic/claude-sonnet-4', workspace: 'local-host/default',
    fundingMode: 'subscription', dailyCalls: '1', monthlyCalls: '10', officialTools: [{ toolId: 'codex', cliModel: 'vendor-default', mode: 'read-only' }] })
  const account = { ...accounts.items[1], enabled: true }
  assert.deepEqual(bindingProblems({ form: current, model: chatModel, account, machine: trusted.machines[0], root: trusted.machines[0].roots[0], catalog: trusted,
    scope: { modes: ['subscription'] } }), [])
  const payload = buildBinding({ form: current, model: chatModel, account, machine: trusted.machines[0], root: trusted.machines[0].roots[0] })
  assert.deepEqual(payload.model, { provider: 'anthropic', model: 'claude-sonnet-4' })
  assert.deepEqual(payload.officialTools, [{ toolId: 'codex', cliModel: 'vendor-default', mode: 'read-only' }])
})

test('an explicit empty CLI identity catalog never falls back to a chat-model mapping', () => {
  for (const status of ['checking', 'not-installed', 'logged-out', 'login-unknown', 'terminal-only', 'unavailable']) {
    const trusted = { ...catalog, tools: [{ ...catalog.tools[0], identities: [], status, reason: `状态：${status}` }] }
    const [tool] = toolCards({ catalog: trusted, model: findModel(catalog, 'openai/gpt-5'), grants: [{ toolId: 'codex', cliModel: 'gpt-5-codex', mode: 'read-only' }] })
    assert.equal(tool.available, false, status)
    assert.deepEqual(tool.identities, [], status)
    assert.equal(tool.stale, true, status)
    assert.equal(tool.reason, `状态：${status}`)
  }
})

test('a tool that loses its offered mode is stale, and writable CLI grants require explicit workspace write access', () => {
  const trusted = { ...catalog, tools: [{ ...catalog.tools[0], status: 'ready', installed: true, loginState: 'logged-in', identities: [{ model: 'vendor-default' }], modes: ['read-only', 'workspace-write'] }] }
  const selected = { toolId: 'codex', cliModel: 'vendor-default', mode: 'workspace-write' }
  assert.equal(toolCards({ catalog: trusted, grants: [selected] })[0].stale, false)
  const current = form({ enabled: true, model: 'openai/gpt-5', workspace: 'local-host/default', workspaceMode: 'read-only', fundingMode: 'subscription', dailyCalls: '1', monthlyCalls: '10', officialTools: [selected] })
  const input = { form: current, model: findModel(trusted, 'openai/gpt-5'), account: accounts.items[0], machine: trusted.machines[0], root: trusted.machines[0].roots[0], catalog: trusted, scope: { modes: ['subscription'] } }
  assert.deepEqual(bindingProblems(input), ['Codex CLI 需要写入工作区，请先将工作区权限设为允许写入。'])
  assert.deepEqual(bindingProblems({ ...input, form: { ...current, workspaceMode: 'workspace-write' } }), [])
  assert.equal(toolCards({ catalog: { ...trusted, tools: [{ ...trusted.tools[0], modes: ['read-only'] }] }, grants: [selected] })[0].stale, true)
})

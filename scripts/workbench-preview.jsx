import React from 'react'
import { createRoot } from 'react-dom/client'
import { RouterMainPage } from '../.dsh-plugin/client/router-main.jsx'
import { createWorkspacePlan, routesFromModelCatalog } from '../.dsh-plugin/client/catalog.mjs'
import { OFFICIAL_TOOLS, defaultInstallMethod, installCommandLine, installMethodsFor, toolForProvider } from '../.dsh-plugin/shared/official-tool-registry.mjs'
import { applyModelProfiles, parseModelProfilesJson } from '../.dsh-plugin/shared/model-profiles.mjs'
import { billingOverview } from '../.dsh-plugin/shared/subscription-billing.mjs'
import { budgetCheck } from '../.dsh-plugin/shared/run-ledger.mjs'
import { buildFeedbackProfile } from '../.dsh-plugin/shared/adaptive-feedback.mjs'
import { ADAPTIVE_DEFAULTS } from '../.dsh-plugin/client/adaptive-state.mjs'

// Every figure below is a UI fixture, not a current vendor price or real bill.
const catalog = {
  groups: [
    { id: 'deepseek', name: 'DeepSeek', models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat · 示例' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner · 示例', reasoning: { efforts: ['high'], defaultEffort: 'high' } },
    ] },
    { id: 'anthropic', name: 'Anthropic', models: [
      { id: 'claude-sonnet-demo', name: 'Claude Sonnet · 示例', reasoning: { efforts: ['low', 'high'] } },
    ] },
    { id: 'openai', name: 'OpenAI', models: [
      { id: 'gpt-demo', name: 'GPT · 示例', reasoning: { efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' } },
    ] },
    { id: 'google', name: 'Google', models: [{ id: 'gemini-demo', name: 'Gemini · 示例' }] },
  ],
  routableProviders: ['deepseek', 'anthropic', 'openai', 'google'],
  failures: [],
}
const profiles = [
  { provider: 'deepseek', model: 'deepseek-chat', quality: 78, pricing: { input: 0.5, output: 1.5 }, specialties: ['summarization', 'writing'], execution: 'api' },
  { provider: 'deepseek', model: 'deepseek-reasoner', quality: 89, pricing: { input: 1, output: 3 }, specialties: ['reasoning', 'math'], execution: 'api' },
  { provider: 'anthropic', model: 'claude-sonnet-demo', quality: 92, pricing: { input: 3, output: 12 }, specialties: ['code', 'research'], subscription: 'cli-login' },
  { provider: 'openai', model: 'gpt-demo', quality: 95, pricing: { input: 4, output: 15 }, specialties: ['code', 'reasoning'], subscription: 'cli-login' },
  { provider: 'google', model: 'gemini-demo', quality: 85, pricing: { input: 1, output: 5 }, specialties: ['research', 'summarization'] },
]
const ok = value => ({ ok: true, value })
const blocked = async () => ({ ok: false, error: { message: '本地 UI 演示不会安装工具、启动终端或运行外部命令。' } })

function createSettingsScope() {
  let snapshot = { status: 'ready', writable: true, revision: 1, value: {
    ...ADAPTIVE_DEFAULTS,
    budgetUsd: 0.1, dailyBudgetUsd: 5, monthlyBudgetUsd: 50,
    routingPreset: 'balanced', overBudgetAction: 'downgrade',
    reviewMode: 'sample', reviewSampleRate: 0.2, allowManualReassign: true,
    confirmUnsandboxedCli: true, onSubscriptionFailure: 'ask',
    modelProfilesJson: JSON.stringify(profiles, null, 2),
    // The demo mirrors the real install settings so the panel renders exactly
    // as it does against a real Host, which always sends them in config.
    toolInstallDir: '', toolNpmRegistry: 'https://registry.npmjs.org/',
    toolInstallMethodsJson: '{}', toolScriptUrlsJson: '{}', toolAllowScriptInstall: true,
  } }
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async mutate(operations, revision) {
      if (revision !== snapshot.revision || !Array.isArray(operations)) return false
      const value = { ...snapshot.value }
      for (const operation of operations) {
        if (operation.op !== 'set' || operation.path?.length !== 1
          || !Object.hasOwn(value, operation.path[0])) return false
        value[operation.path[0]] = operation.value
      }
      snapshot = { ...snapshot, revision: snapshot.revision + 1, value }
      listeners.forEach(listener => listener())
      return true
    },
  }
}

function sampleRuns() {
  return [{
    id: 'demo-team-001', kind: 'team', createdAt: Date.now() - 30 * 60_000,
    task: '演示：梳理架构、检查关键路径并输出验收清单', status: 'partial',
    preset: 'balanced', workspace: 'C:\\demo\\router-workspace', executionMode: 'read-only',
    decision: { complexity: { band: 'complex', value: 0.72 }, estimatedCost: 0.028,
      reason: '示例：拆分分析与验证工作包，在费用和质量之间取得平衡。' },
    packages: [
      { id: 'analyze', name: '分析架构', dependsOn: [], provider: 'deepseek', model: 'deepseek-chat',
        status: 'succeeded', ok: true, ran: true, channel: 'harness-llm', billing: 'api',
        type: 'research', finishedAt: Date.now() - 25 * 60_000,
        difficulty: 'balanced', estimatedCost: 0.003, costUsd: 0.0028, answer: '演示结果：已梳理模块边界，建议补齐关键路径验证。', rating: 1 },
      { id: 'verify', name: '验证关键路径', dependsOn: ['analyze'], provider: 'openai', model: 'gpt-demo',
        status: 'failed', ok: false, ran: true, channel: 'official-cli', toolId: 'codex', billing: 'subscription',
        difficulty: 'complex', estimatedCost: 0.021, referenceCostUsd: 0.018,
        error: '演示失败：模拟网络超时。可以测试“重跑此步”或改派路线。' },
      { id: 'report', name: '汇总验收清单', dependsOn: ['verify'], provider: 'anthropic', model: 'claude-sonnet-demo',
        status: 'blocked', ok: false, ran: false, difficulty: 'balanced', estimatedCost: 0.004 },
    ],
  }]
}

function createDemoSession(scenario) {
  const settingsScope = createSettingsScope()
  let runs = scenario === 'empty' ? [] : sampleRuns()
  let completedAt = scenario === 'onboarding' ? null : Date.now()
  const installed = new Set(['claude-code', 'codex', 'gemini'])
  const source = () => scenario === 'empty' ? { groups: [], routableProviders: [], failures: [] } : catalog
  const routes = () => applyModelProfiles(routesFromModelCatalog(source()), parseModelProfilesJson(settingsScope.getSnapshot().value.modelProfilesJson))
  const tools = OFFICIAL_TOOLS.map(tool => ({
    id: tool.id, label: tool.label, installed: installed.has(tool.id),
    status: installed.has(tool.id) ? 'installed' : 'not-installed',
    version: installed.has(tool.id) ? '0.0.0-demo' : null,
    latestVersion: null, versionStatus: 'unknown',
    login: { state: tool.id === 'gemini' ? 'logged-out' : installed.has(tool.id) ? 'logged-in' : 'unknown',
      command: `${tool.probeExecutables?.[0] ?? tool.id} login`, detail: '仅示例登录状态，不读取本机凭据。' },
  }))
  const ledger = () => {
    const settings = settingsScope.getSnapshot().value
    const spent = scenario === 'empty' ? { today: 0, month: 0, unknownToday: 0, unknownMonth: 0 }
      : { today: 1.28, month: 12.4, unknownToday: 0, unknownMonth: 1, subscriptionToday: 0.18, subscriptionMonth: 2.62, subscriptionRunsMonth: 8 }
    return { runs: structuredClone(runs), settings: { ...settings }, spent,
      budget: { ...budgetCheck({ spent, dailyLimitUsd: settings.dailyBudgetUsd, monthlyLimitUsd: settings.monthlyBudgetUsd }),
        dailyLimitUsd: settings.dailyBudgetUsd, monthlyLimitUsd: settings.monthlyBudgetUsd, action: settings.overBudgetAction },
      biases: {}, learning: buildFeedbackProfile(runs, {
        enabled: settings.feedbackLearningEnabled, halfLifeDays: settings.feedbackHalfLifeDays,
        priorWeight: settings.feedbackPriorWeight, maxAdjustment: settings.feedbackMaxAdjustment, resetAt: settings.feedbackResetAt,
      }), dynamicData: { enabled: settings.dynamicDataEnabled, revision: 'demo-no-network',
        liveBench: { status: settings.dynamicDataEnabled ? 'missing' : 'disabled' }, pricing: { status: settings.dynamicDataEnabled ? 'missing' : 'disabled' } },
      routingData: { liveBench: null, pricingSnapshot: null, dataVersions: { revision: 'demo-no-network' } } }
  }
  const health = () => ({
    tools: structuredClone(tools), onboarding: { completedAt }, notices: [],
    billing: { ...billingOverview(routes(), { loginFor: id => id === 'gemini' ? 'logged-out' : 'subscription' }), cooldownMinutes: 60 },
  })
  const preview = request => {
    const plan = createWorkspacePlan(request.task, source(), {
      ...ledger().routingData, learning: ledger().learning,
      mode: request.provider ? 'direct' : request.planMode,
      directProvider: request.provider, directModel: request.model,
      budgetUsd: request.budgetUsd, preset: request.preset ?? settingsScope.getSnapshot().value.routingPreset,
      modelProfilesJson: settingsScope.getSnapshot().value.modelProfilesJson,
      installedToolIds: [...installed], runnableToolIds: ['claude-code', 'codex'], loggedOutToolIds: ['gemini'],
    })
    const packages = plan.mode === 'team' ? plan.team.workPackages.map(item => ({
      id: item.id, name: item.name, dependsOn: item.dependsOn,
      provider: item.recommendedProvider, model: item.recommendedModel,
      route: `${item.recommendedProvider}/${item.recommendedModel}`, estimatedCost: item.estimatedCost,
      channel: item.executionChannel === 'official-cli' ? 'official-cli' : 'harness-llm',
    })) : [{ id: 'task', name: '演示任务', dependsOn: [], provider: plan.selected.provider,
      model: plan.selected.model, route: `${plan.selected.provider}/${plan.selected.model}`,
      estimatedCost: plan.estimatedCost, channel: 'harness-llm' }]
    return { status: 'preview', selected: plan.selected, estimatedCost: plan.estimatedCost,
      routingBypassed: plan.routingBypassed, workspace: request.workspace || 'C:\\demo\\router-workspace',
      decision: { preset: plan.preset, complexity: plan.complexity, reason: plan.reason, estimatedCost: plan.estimatedCost, packages },
      budget: budgetCheck({ ...ledger().budget, spent: ledger().spent, estimateUsd: plan.estimatedCost }),
      reasons: [{ code: 'demo-only', zh: '这是模拟执行：只在浏览器内生成示例记录，不会调用模型或读取工作区。' }] }
  }
  return {
    settingsScope,
    loadCatalog: async () => scenario === 'error' ? { ok: false, error: { message: '演示：模型目录暂时不可用。可切回“完整示例”检查正常布局。' } } : ok(source()),
    listOfficialTools: async () => ok({ hostVersion: __WORKBENCH_PREVIEW_VERSION__, tools: structuredClone(tools),
      executionCapabilities: OFFICIAL_TOOLS.map(tool => ({ id: tool.id, mode: 'headless', available: installed.has(tool.id) })),
      executionReadiness: OFFICIAL_TOOLS.map(tool => ({ id: tool.id, ready: tool.id !== 'gemini' && installed.has(tool.id) })),
      install: {
        installDir: '', registry: 'https://registry.npmjs.org/', allowScriptInstall: true, scriptUrls: {}, methods: {},
        tools: OFFICIAL_TOOLS.map(tool => ({
          id: tool.id,
          methods: installMethodsFor(tool).map(method => ({ id: method.id, label: method.label, kind: method.kind, blocked: null })),
          methodId: defaultInstallMethod(tool)?.id ?? null,
          savedMethodId: null,
          command: installCommandLine(tool),
          uninstallCommand: tool.manager === 'signed-windows-installer' ? null : '演示模式不执行命令',
          notices: [],
        })),
      },
    }),
    installOfficialTool: blocked, uninstallOfficialTool: blocked, repairOfficialTool: blocked,
    cancelOfficialToolInstall: blocked,
    officialToolInstallStatus: async () => ok({ job: null }),
    toolHealth: async () => ok(health()),
    completeOnboarding: async () => { completedAt = Date.now(); return ok({ completedAt }) },
    loadLedger: async () => ok(ledger()),
    rateResult: async ({ runId, packageId, rating, expectedFinishedAt }) => {
      const item = runs.find(run => run.id === runId)?.packages.find(entry => entry.id === packageId)
      if (item && expectedFinishedAt !== item.finishedAt) return { ok: false, error: { message: '示例结果已更新，请刷新后评价。' } }
      if (item) { item.rating = rating === 'up' ? 1 : rating === 'down' ? -1 : null; item.ratedAt = Date.now() }
      return ok({ saved: Boolean(item) })
    },
    rerunStep: async ({ runId, packageId, provider, model, subscriptionChoice }) => {
      const run = runs.find(entry => entry.id === runId)
      const item = run?.packages.find(entry => entry.id === packageId)
      if (!item) return { ok: false, error: { message: '演示记录不存在。' } }
      Object.assign(item, { provider: provider ?? item.provider, model: model ?? item.model,
        status: subscriptionChoice === 'cancel' ? 'cancelled' : 'succeeded', ok: subscriptionChoice !== 'cancel',
        ran: subscriptionChoice !== 'cancel', channel: 'harness-llm', billing: 'api', costUsd: 0,
        finishedAt: Date.now(), rating: null, review: null,
        error: '', answer: '模拟重跑完成：未调用模型，未修改任何文件。' })
      run.status = run.packages.every(entry => entry.ok) ? 'completed' : 'partial'
      return ok({ runId })
    },
    loadBoundaries: async () => ok({ sandboxAvailable: true, boundaries: routes().map(route => ({
      provider: route.provider, model: route.model, toolLabel: toolForProvider(route.provider)?.label,
      readOnly: { readable: '模拟：指定工作区', sandbox: '模拟边界', direct: false }, write: null,
    })) }),
    previewRun: async request => {
      // Capture the original projection before delaying, so editing the task
      // during a pending preview can expose stale-response regressions.
      const value = preview(request)
      if (scenario === 'slow') await new Promise(resolve => setTimeout(resolve, 2_500))
      return ok(value)
    },
    startRun: async request => {
      const value = preview(request)
      const runId = `demo-${Date.now()}`
      runs.push({ id: runId, kind: request.planMode === 'team' ? 'team' : 'assign', task: request.task,
        createdAt: Date.now(), workspace: value.workspace, executionMode: 'read-only',
        status: 'completed', preset: value.decision.preset, decision: value.decision,
        packages: value.decision.packages.map(item => ({ ...item, status: 'succeeded', ok: true,
          ran: true, channel: 'harness-llm', billing: 'api', costUsd: 0,
          finishedAt: Date.now(), type: 'general',
          answer: `模拟提交任务：${request.task}\n本地 UI 演示结果：仅生成浏览器内记录，没有调用模型或修改文件。` })),
      })
      return ok({ status: 'completed', runId })
    },
  }
}

const scenarios = [['populated', '完整示例'], ['empty', '空目录与空记录'], ['error', '目录读取失败'], ['onboarding', '首次开箱体检'], ['slow', '预览延迟（输入变化检查）']]
function Preview() {
  const initial = new URLSearchParams(window.location.search).get('scenario')
  const [scenario, setScenario] = React.useState(scenarios.some(([id]) => id === initial) ? initial : 'populated')
  const [generation, setGeneration] = React.useState(0)
  const session = React.useMemo(() => createDemoSession(scenario), [scenario, generation])
  return <>
    <aside className="preview-toolbar" aria-label="本地演示控制">
      <strong>本地 UI 演示</strong>
      <p>全部为示例数据与示例价格；执行仅模拟，不调用模型，不读凭据，不安装工具。设置仅保存在本页内存。</p>
      <label htmlFor="preview-scenario">场景<select id="preview-scenario" value={scenario} onChange={event => setScenario(event.target.value)}>
        {scenarios.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <button type="button" onClick={() => setGeneration(value => value + 1)}>重置演示</button>
    </aside>
    <div className="preview-content"><RouterMainPage key={`${scenario}-${generation}`} {...session} /></div>
  </>
}

createRoot(document.getElementById('root')).render(<Preview />)

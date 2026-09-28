/**
 * Shared, deterministic routing model used by the Host and GAL client.
 * It intentionally exposes an auditable decision record, not private model
 * reasoning. The optimizer is a constrained assignment heuristic over a small
 * task DAG; this keeps plan generation bounded and reproducible in a desktop
 * process while retaining the same objective used in the thesis model.
 */

import { liveBenchRow } from './livebench.mjs'

export const OBJECTIVE_WEIGHTS = Object.freeze({
  simple: Object.freeze({ quality: 0.28, cost: 0.45, latency: 0.14, specialty: 0.04, reasoning: 0.07, risk: 0.02 }),
  balanced: Object.freeze({ quality: 0.40, cost: 0.26, latency: 0.10, specialty: 0.09, reasoning: 0.10, risk: 0.05 }),
  complex: Object.freeze({ quality: 0.48, cost: 0.14, latency: 0.06, specialty: 0.14, reasoning: 0.11, risk: 0.07 }),
})

/** Canonical order used only to compare adapter-owned opaque effort ids. */
export const REASONING_EFFORT_ORDER = Object.freeze(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

const REASONING_EFFORT_MULTIPLIERS = Object.freeze({
  off: Object.freeze({ output: 0.78, latency: 0.75 }),
  minimal: Object.freeze({ output: 0.86, latency: 0.82 }),
  low: Object.freeze({ output: 0.93, latency: 0.90 }),
  medium: Object.freeze({ output: 1, latency: 1 }),
  high: Object.freeze({ output: 1.16, latency: 1.15 }),
  xhigh: Object.freeze({ output: 1.34, latency: 1.30 }),
  max: Object.freeze({ output: 1.58, latency: 1.50 }),
})

/** Quality floor for a task node before a cost-saving substitution is allowed. */
export const QUALITY_FLOORS = Object.freeze({ simple: 0.75, balanced: 0.78, complex: 0.82 })

/** Host settings namespace used by the manual pricing editor. */
export const MODEL_ROUTER_SETTINGS_NAMESPACE = 'model-router'

/** Empty user layer means "use the experimental baseline". */
export const DEFAULT_ROUTER_SETTINGS = Object.freeze({
  pricing: Object.freeze({}),
  // The official site publishes versioned table/categories assets and the
  // adapter discovers the newest release from this root URL.
  liveBenchEndpoint: 'https://livebench.ai',
  liveBenchTtlMs: 900000,
  budgetUsd: 0,
  cacheReadRatio: 0,
  cacheWriteRatio: 0,
})

// USD per million tokens. Values are an initial catalog and can be replaced by
// a provider's live pricing without changing the scoring code.
export const MODEL_CATALOG = Object.freeze([
  { id: 'claude-fable-5', aliases: ['claude-fable-5', 'claude fable 5'], quality: 0.99, latency: 0.34, costIn: 10, costOut: 50, specialties: ['reasoning', 'writing', 'research'], risk: 0.06 },
  { id: 'claude-opus-4-8', aliases: ['claude-opus-4-8', 'claude opus 4.8'], quality: 0.97, latency: 0.39, costIn: 5, costOut: 25, specialties: ['reasoning', 'writing', 'code'], risk: 0.07 },
  { id: 'gpt-5.6-sol', aliases: ['gpt-5.6-sol', 'gpt 5.6 sol'], quality: 0.98, latency: 0.40, costIn: 5, costOut: 30, specialties: ['reasoning', 'code', 'math', 'vision'], risk: 0.06 },
  { id: 'gpt-5.5', aliases: ['gpt-5.5', 'gpt 5.5'], quality: 0.95, latency: 0.44, costIn: 5, costOut: 30, specialties: ['reasoning', 'code', 'math'], risk: 0.08 },
  { id: 'deepseek-v4-pro', aliases: ['deepseek-v4-pro', 'deepseek v4 pro'], quality: 0.93, latency: 0.52, costIn: 1.74, costOut: 3.48, specialties: ['code', 'math', 'reasoning'], risk: 0.10 },
  { id: 'deepseek-v4-flash', aliases: ['deepseek-v4-flash', 'deepseek v4 flash'], quality: 0.82, latency: 0.82, costIn: 0.14, costOut: 0.28, specialties: ['code', 'summarization', 'classification'], risk: 0.14 },
  { id: 'kimi-k3', aliases: ['kimi-k3', 'kimi k3'], quality: 0.91, latency: 0.56, costIn: 3, costOut: 15, specialties: ['reasoning', 'long-context', 'code'], risk: 0.10 },
  { id: 'qwen3.7-max', aliases: ['qwen3.7-max', 'qwen 3.7 max'], quality: 0.94, latency: 0.50, costIn: 2.5, costOut: 7.5, specialties: ['reasoning', 'math', 'code'], risk: 0.08 },
  { id: 'qwen3.7-plus', aliases: ['qwen3.7-plus', 'qwen 3.7 plus'], quality: 0.87, latency: 0.72, costIn: 0.4, costOut: 1.6, specialties: ['code', 'math', 'writing'], risk: 0.12 },
  { id: 'glm-5.2', aliases: ['glm-5.2', 'glm 5.2'], quality: 0.89, latency: 0.64, costIn: 1.4, costOut: 4.4, specialties: ['reasoning', 'writing', 'math'], risk: 0.11 },
  { id: 'gpt-5.6-luna', aliases: ['gpt-5.6-luna', 'gpt 5.6 luna'], quality: 0.84, latency: 0.86, costIn: 0.2, costOut: 1.2, specialties: ['classification', 'summarization', 'code'], risk: 0.14 },
  { id: 'gpt-5.6-terra', aliases: ['gpt-5.6-terra', 'gpt 5.6 terra'], quality: 0.91, latency: 0.66, costIn: 2, costOut: 12, specialties: ['code', 'writing', 'reasoning'], risk: 0.10 },
  { id: 'minimax-m3', aliases: ['minimax-m3', 'minimax m3'], quality: 0.86, latency: 0.69, costIn: 0.3, costOut: 1.2, specialties: ['writing', 'code', 'summarization'], risk: 0.13 },
  { id: 'gemini-3-flash', aliases: ['gemini 3 flash', 'gemini-3-flash'], quality: 0.88, latency: 0.73, costIn: 0.5, costOut: 3, specialties: ['vision', 'research', 'summarization'], risk: 0.12 },
  { id: 'big-pickle', aliases: ['big pickle'], quality: 0.70, latency: 0.88, costIn: 0, costOut: 0, specialties: ['classification', 'summarization'], risk: 0.24 },
])

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const routeKey = (provider, model) => `${String(provider ?? '')}/${String(model ?? '')}`

/** OpenCode routes whose catalog entries carry their own protocol endpoint. */
export const OPENCODE_CATALOG_PROVIDERS = Object.freeze([
  'opencode',
  'opencode-go',
  // Some OpenCode-compatible configuration examples use the product name as
  // the route id. Treat those aliases as catalog routes too; the pi-ai catalog
  // still owns the actual model endpoints.
  'opencode-zen',
  'opencode-go-zen',
])

/** Normalize the route ids used by OpenCode-compatible settings. */
function normalizeOpenCodeProvider(provider) {
  const route = String(provider ?? '').trim().toLowerCase()
  return route.replace(/-zen$/, '')
}

/**
 * The pi-ai catalog stores different endpoints for OpenCode's wire families:
 * Anthropic models use /zen while OpenAI-compatible models use /zen/v1 (and
 * the Go route has the corresponding /zen/go variants). A provider-level URL
 * for the public website would overwrite those model endpoints and produce a
 * 404 HTML page. Only the official host is repaired; custom gateways remain
 * fully user-controlled.
 */
export function isOfficialOpenCodeEndpoint(provider, baseURL) {
  const route = String(provider ?? '').trim().toLowerCase()
  if (!['opencode', 'opencode-go'].includes(normalizeOpenCodeProvider(route))) return false
  if (typeof baseURL !== 'string' || baseURL.trim().length === 0) return false
  try {
    const parsed = new URL(baseURL.trim())
    if (parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    return host === 'opencode.ai' || host === 'www.opencode.ai'
  } catch {
    return false
  }
}

/** Return settings mutations that restore the official catalog endpoints. */
export function collectOpenCodeEndpointRepairs(user) {
  if (user === null || typeof user !== 'object' || Array.isArray(user)) return []
  const providers = user.providers
  if (providers === null || typeof providers !== 'object' || Array.isArray(providers)) return []
  const ops = []
  for (const [provider, profile] of Object.entries(providers)) {
    if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) continue
    if (isOfficialOpenCodeEndpoint(provider, profile.baseURL)) {
      ops.push({ op: 'unset', path: ['providers', provider, 'baseURL'] })
    }
  }
  return ops
}

export function textFromMessages(messages) {
  if (!Array.isArray(messages)) return ''
  return messages.map(message => {
    if (!message || !Array.isArray(message.content)) return ''
    return message.content.map(block => typeof block?.text === 'string' ? block.text : '').join('\n')
  }).join('\n').trim()
}

export function classifyTask(text) {
  const value = String(text ?? '')
  if (value.length < 80 && /翻译|解释|translate|explain/i.test(value)) return 'general'
  return detectTaskTypes(value)[0] ?? 'general'
}

const TASK_TYPE_RULES = Object.freeze([
  ['vision', /图片|图像|照片|视觉|image|vision|截图|识图/i],
  ['math', /数学|证明|定理|公式|方程|math|proof|theorem/i],
  ['code', /代码|编程|工程|项目|架构|接口|api|debug|实现|部署|测试|code/i],
  ['research', /研究|论文|文献|联网|检索|research|source|引用/i],
  ['summarization', /总结|摘要|提炼|分类|翻译|summar|classif|extract/i],
  ['writing', /写作|润色|小说|文案|报告|writing|draft/i],
])

const TASK_TYPE_LABELS = Object.freeze({
  vision: '视觉处理',
  math: '数学推导',
  code: '工程与代码',
  research: '研究与检索',
  summarization: '摘要与整理',
  writing: '写作与表达',
})

/** Return all explicit business directions, ranked by signal count. */
export function detectTaskTypes(text) {
  const value = String(text ?? '')
  const ranked = TASK_TYPE_RULES.map(([type, pattern]) => ({
    type,
    signals: value.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))?.length ?? 0,
  })).filter(item => item.signals > 0)
  ranked.sort((left, right) => right.signals - left.signals || left.type.localeCompare(right.type))
  return ranked.map(item => item.type)
}

export function assessComplexity(text) {
  const value = String(text ?? '')
  const lengthScore = clamp(value.length / 2200)
  const requirementScore = clamp((value.match(/(?:^|\n)\s*(?:[-*]|\d+[.)]|[一二三四五六七八九十]+[、.])/g) ?? []).length / 8)
  const codeScore = /(代码|工程|架构|接口|实现|部署|测试|code|api|debug)/i.test(value) ? 0.22 : 0
  const highReasoningScore = /(数学|证明|定理|研究|论文|复杂|多步骤|约束|比较|评估|架构|模块|部署|math|proof|research)/i.test(value) ? 0.20 : 0
  const visionScore = /(图片|图像|照片|截图|视觉|image|vision)/i.test(value) ? 0.12 : 0
  const domainMarkers = (value.match(/代码|工程|架构|接口|实现|部署|测试|模块|拆分|约束|评估|证明|定理|研究|论文|图片|图像|照片|视觉|code|api|debug|proof|research|vision/gi) ?? []).length
  const domainComplexity = clamp(domainMarkers / 5) * 0.28
  const raw = clamp(0.10 + lengthScore * 0.30 + requirementScore * 0.18 + domainComplexity + codeScore + highReasoningScore + visionScore)
  const band = raw < 0.34 ? 'simple' : raw < 0.66 ? 'balanced' : 'complex'
  return { value: raw, band }
}

function specialtyMatch(model, taskType, liveScores = {}) {
  const benchmark = asScore(liveScores?.[taskType])
  if (benchmark !== undefined) return benchmark
  if (model.specialties.includes(taskType)) return 1
  if (taskType === 'general') return 0.58
  if (taskType === 'research' && model.specialties.includes('writing')) return 0.68
  if (taskType === 'writing' && model.specialties.includes('reasoning')) return 0.62
  return 0.38
}

function qualityForTask(row, taskType) {
  return asScore(row?.liveScores?.[taskType]) ?? asScore(row?.liveOverall) ?? row?.metadata?.quality ?? row?.quality ?? 0
}

function specialtyForTask(row, taskType) {
  return specialtyMatch(row.metadata, taskType, row.liveScores)
}

function asScore(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return undefined
  return clamp(number > 1 ? number / 100 : number)
}

function normalizePricing(pricing) {
  if (pricing === null || typeof pricing !== 'object' || Array.isArray(pricing)) return {}
  const normalized = {}
  for (const [id, raw] of Object.entries(pricing)) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const input = Number(raw.input ?? raw.costIn)
    const output = Number(raw.output ?? raw.costOut)
    const cacheRead = Number(raw.cacheRead ?? 0)
    const cacheWrite = Number(raw.cacheWrite ?? 0)
    if (![input, output, cacheRead, cacheWrite].every(value => Number.isFinite(value) && value >= 0)) continue
    normalized[normalize(id)] = {
      input: input,
      output,
      cacheRead,
      cacheWrite,
      currency: String(raw.currency ?? 'USD').toUpperCase(),
    }
  }
  return normalized
}

function pricingFor(model, pricing, provider = '') {
  const normalizedPricing = normalizePricing(pricing)
  const providerOverride = provider === '' ? undefined : normalizedPricing[normalize(`${provider}/${model.id}`)]
  const override = providerOverride ?? normalizedPricing[normalize(model.id)]
  return override ?? {
    input: Number(model.costIn ?? 0),
    output: Number(model.costOut ?? 0),
    cacheRead: Number(model.cacheRead ?? 0),
    cacheWrite: Number(model.cacheWrite ?? 0),
    currency: 'USD',
  }
}

function normalizedCacheRatios(cacheReadRatio = 0, cacheWriteRatio = 0) {
  const read = Number.isFinite(Number(cacheReadRatio)) ? clamp(Number(cacheReadRatio)) : 0
  const write = Number.isFinite(Number(cacheWriteRatio)) ? Math.min(clamp(Number(cacheWriteRatio)), 1 - read) : 0
  return { read, write }
}

function effectivePricing(pricing, cacheReadRatio = 0, cacheWriteRatio = 0) {
  const { read, write } = normalizedCacheRatios(cacheReadRatio, cacheWriteRatio)
  return {
    input: (1 - read - write) * Number(pricing.input)
      + read * Number(pricing.cacheRead)
      + write * Number(pricing.cacheWrite),
    output: Number(pricing.output),
  }
}

function costScore(pricing, maxCost, cacheReadRatio = 0, cacheWriteRatio = 0) {
  const effective = effectivePricing(pricing, cacheReadRatio, cacheWriteRatio)
  const mean = (effective.input + effective.output) / 2
  if (maxCost <= 0) return mean === 0 ? 1 : 0
  return clamp(1 - mean / maxCost)
}

export function estimateCost(model, text, outputTokens = 900, pricingOverrides = {}, cacheReadRatio = 0, cacheWriteRatio = 0) {
  const pricing = pricingFor(model, pricingOverrides)
  const inputTokens = Math.max(80, Math.ceil(String(text ?? '').length / 3.7))
  const ratios = normalizedCacheRatios(cacheReadRatio, cacheWriteRatio)
  const cacheReadTokens = Math.min(inputTokens, Math.max(0, Math.round(inputTokens * ratios.read)))
  const cacheWriteTokens = Math.min(inputTokens - cacheReadTokens, Math.max(0, Math.round(inputTokens * ratios.write)))
  const billableInputTokens = inputTokens - cacheReadTokens - cacheWriteTokens
  return ((billableInputTokens * pricing.input)
    + (cacheReadTokens * pricing.cacheRead)
    + (cacheWriteTokens * pricing.cacheWrite)
    + (outputTokens * pricing.output)) / 1_000_000
}

export function modelMetadata(name) {
  const key = normalize(name)
  return MODEL_CATALOG.find(model => model.aliases.some(alias => {
    const candidate = normalize(alias)
    return key === candidate || key.includes(candidate) || candidate.includes(key)
  })) ?? null
}

/**
 * Return the staged collaboration task for one agent-loop step.
 * Complex turns deliberately use the loop's real steps: each work report is
 * logged as an assistant message, then the synthesis step receives the full
 * durable history. This keeps the plan auditable without exposing private
 * chain-of-thought.
 */
export function collaborationStage(plan, step) {
  if (plan?.complexity?.band !== 'complex' || !Array.isArray(plan.subtasks)) return null
  const index = Math.max(1, Number(step) || 1) - 1
  const task = plan.subtasks[index]
  return task === undefined ? null : { ...task, index: index + 1, total: plan.subtasks.length }
}

/** Return the next staged task after a completed step, or null at synthesis end. */
export function nextCollaborationStage(plan, step) {
  return collaborationStage(plan, (Number(step) || 0) + 1)
}

/**
 * Build a visible, model-facing stage instruction. It asks for a concise work
 * report rather than hidden reasoning; the report is persisted and passed to
 * later stages by the normal session history.
 */
export function collaborationInstruction(plan, step) {
  const stage = collaborationStage(plan, step)
  if (stage === null) return ''
  const taskType = String(plan.taskType ?? 'general')
  if (stage.purpose === 'synthesis') {
    return [
      `[Model Router 协作阶段 ${stage.index}/${stage.total}：结果校验与整合]`,
      `你是最终汇总模型。请阅读主人原问题以及前序协作阶段的工作报告，完成${taskType}任务的交叉校验、冲突处理和最终回答。`,
      '只输出面向主人的最终答案，不要复述内部调度指令，不要编造不存在的证据。',
      '回答必须使用 Markdown；数学公式使用 KaTeX 兼容的 $...$ 或 $$...$$。',
    ].join('\n')
  }
  if (stage.purpose === 'analysis') {
    return [
      `[Model Router 协作阶段 ${stage.index}/${stage.total}：问题建模与约束提取]`,
      `请针对主人的 ${taskType} 问题完成问题建模：提取目标、约束、输入输出、验收标准和关键风险。`,
      '只提交结构化工作报告，供后续模型使用；不要直接替主人给最终答案，也不要输出隐私化的逐步思维链。',
    ].join('\n')
  }
  return [
    `[Model Router 协作阶段 ${stage.index}/${stage.total}：${stage.name}]`,
    `请阅读主人原问题和上一阶段报告，完成 ${taskType} 任务中负责的资料、代码、证据或方案处理。`,
    ...(stage.objective ? [`本工作包的具体目标：${stage.objective}`] : []),
    '只提交可核验的结构化工作报告，列出结论、依据、待确认项和可直接复用的产物；不要直接替主人输出最终答案。',
  ].join('\n')
}

function taskTokenBudget(text, task, complexity, cacheReadRatio = 0, cacheWriteRatio = 0) {
  const inputTokens = Math.max(80, Math.ceil(String(text ?? '').length / 3.7))
  const multipliers = {
    analysis: { input: 0.90, output: 0.55 },
    execution: { input: 1.20, output: complexity === 'complex' ? 1.45 : 1.00 },
    verification: { input: 1.15, output: 0.70 },
    synthesis: { input: 1.65, output: 1.30 },
  }
  const multiplier = multipliers[task.purpose] ?? { input: 1, output: 1 }
  const effortMultiplier = reasoningEffortMultiplier(task.reasoningEffort)
  const totalInputTokens = Math.max(80, Math.round(inputTokens * multiplier.input))
  const ratios = normalizedCacheRatios(cacheReadRatio, cacheWriteRatio)
  const cacheReadTokens = Math.min(totalInputTokens, Math.max(0, Math.round(totalInputTokens * ratios.read)))
  const cacheWriteTokens = Math.min(totalInputTokens - cacheReadTokens, Math.max(0, Math.round(totalInputTokens * ratios.write)))
  return {
    inputTokens: totalInputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens: Math.max(220, Math.round(900 * multiplier.output * effortMultiplier.output)),
  }
}

function taskQualityFloor(band, task) {
  const base = QUALITY_FLOORS[band] ?? QUALITY_FLOORS.balanced
  if (task.purpose === 'synthesis') return Math.max(base, band === 'complex' ? 0.84 : base)
  if (band !== 'complex') return base
  return clamp(base + Math.max(0, Number(task.criticality ?? 0.75) - 0.65) * 0.12)
}

const MAX_EXPLICIT_EXECUTION_PACKAGES = 6
const REQUIREMENT_ACTION = /(?:实现|新增|添加|修复|更新|构建|设计|完成|编写|优化|接入|支持|配置|部署|测试|验证|检查|整理|创建|移除|替换|迁移|适配|开发|调研|安装|下载|上传|发布|生成|集成|改造|封装|显示|提供|允许|确保|处理|解决|分析|探测|检测|选择|分配|拆分|对接|加入|保留|记录|输出|审查|核对|对比|可以|能够|需要|进行|implement|add|fix|update|build|design|write|improve|support|configure|deploy|test|verify|check|create|remove|replace|migrate|install|publish|generate|integrate|review|should|must|need)/i

function requirementText(value) {
  return String(value ?? '').trim().replace(/[。；;\s]+$/u, '').trim()
}

function looksLikeRequirement(value) {
  const item = requirementText(value)
  return item.length >= 3 && !/[:：]$/u.test(item)
    && !/(?:以下|下列|如下)(?:的)?(?:任务|需求|工作|事项|要求)/u.test(item)
    && REQUIREMENT_ACTION.test(item.slice(0, 32))
}

function explicitRequirements(text) {
  const visibleLines = []
  let fence = null
  for (const line of String(text ?? '').split(/\r?\n/u)) {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length
        && !line.slice(marker[0].length).trim()) fence = null
      continue
    }
    if (marker) {
      fence = { char: marker[1][0], length: marker[1].length }
      continue
    }
    visibleLines.push(line)
  }
  const value = visibleLines.join('\n')
  const lines = visibleLines.map(line => line.trim()).filter(Boolean)
  const marker = /^(?:[-*•]\s+|\d{1,2}[.)、](?!\d)\s*|[一二三四五六七八九十]{1,3}[、.)]\s*)(.+)$/u
  const marked = lines.map(line => marker.exec(line)?.[1]).filter(Boolean).map(requirementText)
    .filter(item => item.length >= 3)
  if (marked.length >= 2) return marked

  // A newline is an item boundary only when each line looks like a request.
  // This avoids decomposing wrapped prose, logs, examples, or a single paragraph.
  const plain = lines.filter(line => !/^#{1,6}\s|^```|[:：]$/u.test(line))
  if (plain.length >= 2 && plain.every(looksLikeRequirement)) {
    return plain.map(requirementText).filter(item => item.length >= 3)
  }

  // Semicolons need two action clauses; sentence punctuation is not a boundary.
  const clauses = value.split(/[;；]/u).map(requirementText).filter(Boolean)
  if (clauses.length >= 2 && clauses.every(looksLikeRequirement)) {
    return clauses
  }
  // Complete Chinese action sentences can also be separate requirements.
  // Do not split on ASCII periods, which commonly occur in paths and URLs.
  const sentences = value.split(/[。！？]/u).map(requirementText).filter(Boolean)
  if (sentences.length >= 2 && sentences.every(looksLikeRequirement)) {
    return sentences
  }
  return []
}

function taskPackages(taskType, text, band) {
  if (band !== 'complex') {
    const task = { id: 'execution', name: '直接回答与必要校验', type: taskType, purpose: 'execution', criticality: 0.65, dependsOn: [], preferredReasoningEffort: band === 'simple' ? 'low' : 'medium' }
    return [{ ...task, qualityFloor: taskQualityFloor(band, task) }]
  }
  const value = String(text ?? '')
  const packages = [
    { id: 'analysis', name: '问题建模与约束提取', type: 'reasoning', purpose: 'analysis', criticality: 0.92, dependsOn: [], preferredReasoningEffort: 'high' },
  ]
  const requirements = explicitRequirements(text)
  if (requirements.length >= 2) {
    // Preserve every stated requirement when the list exceeds the package cap.
    const groups = requirements.length > MAX_EXPLICIT_EXECUTION_PACKAGES
      ? [...requirements.slice(0, MAX_EXPLICIT_EXECUTION_PACKAGES - 1).map(item => [item]),
        requirements.slice(MAX_EXPLICIT_EXECUTION_PACKAGES - 1)]
      : requirements.map(item => [item])
    groups.forEach((group, index) => {
      const objective = group.length === 1 ? group[0]
        : group.map((item, offset) => `${MAX_EXPLICIT_EXECUTION_PACKAGES + offset}. ${item}`).join('\n')
      const type = detectTaskTypes(objective)[0] ?? taskType
      packages.push({
        id: `execution-${index + 1}`,
        name: group.length === 1
          ? `需求 ${index + 1}：${group[0].slice(0, 28)}`
          : `需求 ${index + 1}：其余 ${group.length} 项`,
        objective,
        type,
        purpose: 'execution',
        criticality: 0.80,
        dependsOn: ['analysis'],
        preferredReasoningEffort: 'high',
      })
    })
  } else {
    const domains = [...new Set([...(detectTaskTypes(text)), taskType].filter(type => type !== 'general'))]
    for (const type of domains.length > 0 ? domains : [taskType]) {
      packages.push({
        id: `execution-${type}`,
        name: `${TASK_TYPE_LABELS[type] ?? type}方向处理`,
        type,
        purpose: 'execution',
        criticality: domains.length > 1 ? 0.80 : 0.78,
        dependsOn: ['analysis'],
        preferredReasoningEffort: 'high',
      })
    }
  }
  if (/(测试|验证|评估|对比|benchmark|test|verify|audit)/i.test(value)) {
    packages.push({
      id: 'verification',
      name: '验证、反例与风险审查',
      type: 'reasoning',
      purpose: 'verification',
      criticality: 0.88,
      dependsOn: packages.filter(task => task.purpose === 'execution').map(task => task.id),
      preferredReasoningEffort: 'high',
    })
  }
  packages.push({
    id: 'synthesis',
    name: '结果校验与整合',
    type: 'reasoning',
    purpose: 'synthesis',
    criticality: 1,
    dependsOn: packages.filter(task => task.purpose !== 'analysis').map(task => task.id),
    preferredReasoningEffort: 'xhigh',
  })
  return packages.map(task => ({ ...task, qualityFloor: taskQualityFloor(band, task) }))
}

const SYNTHESIS_WEIGHTS = Object.freeze({ quality: 0.58, cost: 0.08, latency: 0.04, specialty: 0.08, reasoning: 0.16, risk: 0.06 })
const ROUTING_BEAM_WIDTH = 256
const ROUTING_CANDIDATE_LIMIT = 12

function weightsForTask(weights, task) {
  return task.purpose === 'synthesis' ? SYNTHESIS_WEIGHTS : weights
}

function compareText(left, right) {
  const a = String(left)
  const b = String(right)
  return a < b ? -1 : a > b ? 1 : 0
}

function compareRowsStable(left, right) {
  return compareText(routeKey(left.provider, left.model), routeKey(right.provider, right.model))
}

function reasoningEffortRank(effort) {
  const normalized = String(effort ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
  const aliases = { none: 'off', disabled: 'off', extra: 'xhigh', extrahigh: 'xhigh', maximum: 'max' }
  const canonical = aliases[normalized] ?? normalized
  const index = REASONING_EFFORT_ORDER.indexOf(canonical)
  return index < 0 ? REASONING_EFFORT_ORDER.indexOf('medium') : index
}

function reasoningEffortMultiplier(effort) {
  const normalized = String(effort ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
  const aliases = { none: 'off', disabled: 'off', extra: 'xhigh', extrahigh: 'xhigh', maximum: 'max' }
  return REASONING_EFFORT_MULTIPLIERS[aliases[normalized] ?? normalized] ?? REASONING_EFFORT_MULTIPLIERS.medium
}

/** Pick the closest exact effort id exposed by an adapter. */
export function selectReasoningEffort(efforts, preferred = 'medium') {
  const exact = Array.isArray(efforts)
    ? [...new Set(efforts.map(effort => String(effort?.id ?? effort ?? '')).filter(Boolean))]
    : []
  if (exact.length === 0) return undefined
  const preferredRank = reasoningEffortRank(preferred)
  return exact.slice().sort((left, right) => {
    const distance = Math.abs(reasoningEffortRank(left) - preferredRank) - Math.abs(reasoningEffortRank(right) - preferredRank)
    if (distance !== 0) return distance
    return reasoningEffortRank(left) - reasoningEffortRank(right) || compareText(left, right)
  })[0]
}

function reasoningDecision(row, task) {
  const preferred = String(task.preferredReasoningEffort ?? 'medium')
  const efforts = Array.isArray(row.reasoningEfforts) ? row.reasoningEfforts : []
  if (efforts.length === 0) {
    const knownUnsupported = row.reasoningKnown === true
    const preferredRank = reasoningEffortRank(preferred)
    return {
      reasoningEffort: undefined,
      reasoningFit: knownUnsupported ? clamp(0.78 - preferredRank * 0.08) : 0.55,
      preferredReasoningEffort: preferred,
      multiplier: REASONING_EFFORT_MULTIPLIERS.medium,
    }
  }
  const preferredRank = reasoningEffortRank(preferred)
  // On an equal distance the shared selector prefers the lower effort to
  // avoid unnecessary latency and output-token cost.
  const chosen = selectReasoningEffort(efforts, preferred)
  const distance = Math.abs(reasoningEffortRank(chosen) - preferredRank)
  return {
    reasoningEffort: chosen,
    reasoningFit: clamp(1 - distance / (REASONING_EFFORT_ORDER.length - 1)),
    preferredReasoningEffort: preferred,
    multiplier: reasoningEffortMultiplier(chosen),
  }
}

function candidateUtility(row, task, weights, maxCost, usedRoutes, cacheReadRatio = 0, cacheWriteRatio = 0) {
  const quality = qualityForTask(row, task.type)
  const floor = Number(task.qualityFloor ?? taskQualityFloor('complex', task))
  const qualityGap = Math.max(0, floor - quality)
  const duplicatePenalty = usedRoutes.has(routeKey(row.provider, row.model)) ? 0.08 : 0
  const synthesisPreference = task.purpose === 'synthesis' && /deepseek[- ]?v4[- ]?pro/i.test(row.model) ? 0.025 : 0
  const reasoning = reasoningDecision(row, task)
  const cost = clamp(costScore(row.pricing, maxCost, cacheReadRatio, cacheWriteRatio) / Math.sqrt(reasoning.multiplier.output))
  const score = weights.quality * quality
    + weights.cost * cost
    + weights.latency * (1 - clamp(row.latency * reasoning.multiplier.latency))
    + weights.specialty * specialtyForTask(row, task.type)
    + (weights.reasoning ?? 0) * reasoning.reasoningFit
    - weights.risk * row.risk
    - duplicatePenalty
    - qualityGap * (task.criticality ?? 0.75)
    + synthesisPreference
  return { score, floor, qualityGap, ...reasoning }
}

function chooseAssignment(rows, task, weights, maxCost, usedRoutes, preferred, cacheReadRatio = 0, cacheWriteRatio = 0) {
  const ordered = rows
    .map(row => ({ row, decision: candidateUtility(row, task, weights, maxCost, usedRoutes, cacheReadRatio, cacheWriteRatio) }))
    .sort((left, right) => right.decision.score - left.decision.score)
  const feasible = ordered.filter(item => qualityForTask(item.row, task.type) >= item.decision.floor)
  const chosen = (preferred === true ? feasible : feasible.filter(item => !usedRoutes.has(routeKey(item.row.provider, item.row.model))))[0]
    ?? feasible[0]
    ?? ordered[0]
  if (chosen === undefined) return { row: null, relaxed: true, floor: 0, qualityGap: 1 }
  return { row: chosen.row, relaxed: qualityForTask(chosen.row, task.type) < chosen.decision.floor, floor: chosen.decision.floor, qualityGap: chosen.decision.qualityGap }
}

function taskCost(row, task, text, complexity, cacheReadRatio = 0, cacheWriteRatio = 0) {
  const decision = row === null ? null : reasoningDecision(row, task)
  const tokens = taskTokenBudget(text, { ...task, reasoningEffort: decision?.reasoningEffort }, complexity, cacheReadRatio, cacheWriteRatio)
  return row === null
    ? 0
    : (((tokens.inputTokens - tokens.cacheReadTokens - tokens.cacheWriteTokens) * row.pricing.input)
      + (tokens.cacheReadTokens * row.pricing.cacheRead)
      + (tokens.cacheWriteTokens * row.pricing.cacheWrite)
      + (tokens.outputTokens * row.pricing.output)) / 1_000_000
}

function dominates(left, right, task, text, complexity, cacheReadRatio, cacheWriteRatio) {
  const leftReasoning = reasoningDecision(left, task)
  const rightReasoning = reasoningDecision(right, task)
  const leftValues = {
    quality: qualityForTask(left, task.type),
    cost: taskCost(left, task, text, complexity, cacheReadRatio, cacheWriteRatio),
    latency: clamp(left.latency * leftReasoning.multiplier.latency),
    specialty: specialtyForTask(left, task.type),
    reasoning: leftReasoning.reasoningFit,
    risk: clamp(left.risk),
  }
  const rightValues = {
    quality: qualityForTask(right, task.type),
    cost: taskCost(right, task, text, complexity, cacheReadRatio, cacheWriteRatio),
    latency: clamp(right.latency * rightReasoning.multiplier.latency),
    specialty: specialtyForTask(right, task.type),
    reasoning: rightReasoning.reasoningFit,
    risk: clamp(right.risk),
  }
  const noWorse = leftValues.quality >= rightValues.quality
    && leftValues.cost <= rightValues.cost
    && leftValues.latency <= rightValues.latency
    && leftValues.specialty >= rightValues.specialty
    && leftValues.reasoning >= rightValues.reasoning
    && leftValues.risk <= rightValues.risk
  const strictlyBetter = leftValues.quality > rightValues.quality
    || leftValues.cost < rightValues.cost
    || leftValues.latency < rightValues.latency
    || leftValues.specialty > rightValues.specialty
    || leftValues.reasoning > rightValues.reasoning
    || leftValues.risk < rightValues.risk
  return noWorse && strictlyBetter
}

function candidatePool(rows, task, weights, maxCost, text, complexity, cacheReadRatio, cacheWriteRatio) {
  const floor = Number(task.qualityFloor ?? 0)
  const feasible = rows.filter(row => qualityForTask(row, task.type) >= floor)
  const source = feasible.length > 0
    ? feasible
    : rows.slice().sort((left, right) => qualityForTask(right, task.type) - qualityForTask(left, task.type) || compareRowsStable(left, right)).slice(0, 3)
  const taskWeights = weightsForTask(weights, task)
  const scored = source.map(row => ({
    row,
    decision: candidateUtility(row, task, taskWeights, maxCost, new Set(), cacheReadRatio, cacheWriteRatio),
    cost: taskCost(row, task, text, complexity, cacheReadRatio, cacheWriteRatio),
  }))
  const frontier = scored.filter(item => !source.some(other => other !== item.row && dominates(other, item.row, task, text, complexity, cacheReadRatio, cacheWriteRatio)))
  const essential = [
    scored.slice().sort((left, right) => left.cost - right.cost || compareRowsStable(left.row, right.row))[0],
    scored.slice().sort((left, right) => right.decision.score - left.decision.score || compareRowsStable(left.row, right.row))[0],
    scored.slice().sort((left, right) => qualityForTask(right.row, task.type) - qualityForTask(left.row, task.type) || compareRowsStable(left.row, right.row))[0],
  ].filter(Boolean)
  const ordered = [...frontier, ...essential]
    .filter((item, index, all) => all.findIndex(candidate => candidate.row === item.row) === index)
    .sort((left, right) => right.decision.score - left.decision.score || left.cost - right.cost || compareRowsStable(left.row, right.row))
    .slice(0, ROUTING_CANDIDATE_LIMIT)
  return {
    options: ordered,
    relaxed: feasible.length === 0,
    pruned: Math.max(0, rows.length - ordered.length),
  }
}

function stateSignature(state) {
  return state.assignments.map(assignment => `${routeKey(assignment.row?.provider, assignment.row?.model)}@${assignment.decision?.reasoningEffort ?? 'provider-default'}`).join('|')
}

function compareUtilityStates(left, right) {
  return left.relaxedCount - right.relaxedCount
    || left.qualityShortfall - right.qualityShortfall
    || right.score - left.score
    || left.cost - right.cost
    || left.switches - right.switches
    || compareText(stateSignature(left), stateSignature(right))
}

function compareCostStates(left, right) {
  return left.relaxedCount - right.relaxedCount
    || left.qualityShortfall - right.qualityShortfall
    || left.cost - right.cost
    || right.score - left.score
    || left.switches - right.switches
    || compareText(stateSignature(left), stateSignature(right))
}

function solveAssignments({ rows, tasks, weights, maxCost, text, complexity, budget, cacheReadRatio, cacheWriteRatio, minimizeCost = false }) {
  const pools = tasks.map(task => candidatePool(rows, task, weights, maxCost, text, complexity, cacheReadRatio, cacheWriteRatio))
  if (pools.some(pool => pool.options.length === 0)) return null
  const suffixMinimum = Array(tasks.length + 1).fill(0)
  for (let index = tasks.length - 1; index >= 0; index -= 1) {
    suffixMinimum[index] = suffixMinimum[index + 1] + Math.min(...pools[index].options.map(option => option.cost))
  }
  if (Number.isFinite(budget) && suffixMinimum[0] > budget + 1e-12) return null

  let states = [{ assignments: [], routesByTask: new Map(), usedRoutes: new Set(), score: 0, cost: 0, switches: 0, relaxedCount: 0, qualityShortfall: 0 }]
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index]
    const pool = pools[index]
    const expanded = []
    for (const state of states) {
      for (const option of pool.options) {
        const nextCost = state.cost + option.cost
        if (Number.isFinite(budget) && nextCost + suffixMinimum[index + 1] > budget + 1e-12) continue
        const taskWeights = weightsForTask(weights, task)
        const decision = candidateUtility(option.row, task, taskWeights, maxCost, state.usedRoutes, cacheReadRatio, cacheWriteRatio)
        const route = routeKey(option.row.provider, option.row.model)
        const dependencySwitches = (task.dependsOn ?? []).reduce((count, dependency) => {
          const dependencyRoute = state.routesByTask.get(dependency)
          return count + (dependencyRoute !== undefined && dependencyRoute !== route ? 1 : 0)
        }, 0)
        const handoffPenalty = dependencySwitches * 0.015
        const qualityShortfall = Math.max(0, decision.floor - qualityForTask(option.row, task.type))
        const usedRoutes = new Set(state.usedRoutes)
        usedRoutes.add(route)
        const routesByTask = new Map(state.routesByTask)
        routesByTask.set(task.id, route)
        expanded.push({
          assignments: [...state.assignments, { task, row: option.row, decision: { ...decision, relaxed: qualityShortfall > 0 }, estimatedCost: option.cost, handoffPenalty }],
          routesByTask,
          usedRoutes,
          score: state.score + decision.score - handoffPenalty,
          cost: nextCost,
          switches: state.switches + dependencySwitches,
          relaxedCount: state.relaxedCount + (qualityShortfall > 0 ? 1 : 0),
          qualityShortfall: state.qualityShortfall + qualityShortfall,
        })
      }
    }
    if (expanded.length === 0) return null
    expanded.sort(minimizeCost ? compareCostStates : compareUtilityStates)
    states = expanded.slice(0, ROUTING_BEAM_WIDTH)
  }
  states.sort(minimizeCost ? compareCostStates : compareUtilityStates)
  return {
    ...states[0],
    candidatePools: pools,
    minimumFeasibleCost: suffixMinimum[0],
  }
}

export function buildPlan({ text = '', available = [], mode = 'collective', pricing = {}, liveBench = null, liveBenchError = '', budgetUsd = 0, cacheReadRatio = 0, cacheWriteRatio = 0 } = {}) {
  const complexity = assessComplexity(text)
  const taskType = classifyTask(text)
  const weights = OBJECTIVE_WEIGHTS[complexity.band]
  const discovered = Array.isArray(available)
    ? available.map(entry => {
        const rawEfforts = Array.isArray(entry.reasoningEfforts) ? entry.reasoningEfforts : []
        const reasoningEfforts = rawEfforts.map(effort => String(effort?.id ?? effort ?? '')).filter(Boolean)
        return {
          provider: String(entry.provider ?? ''),
          model: String(entry.model ?? ''),
          reasoningEfforts: [...new Set(reasoningEfforts)],
          defaultReasoningEffort: entry.defaultReasoningEffort === undefined ? undefined : String(entry.defaultReasoningEffort),
          reasoningKnown: entry.reasoningKnown === true
            || (entry.reasoningKnown === undefined && Array.isArray(entry.reasoningEfforts)),
        }
      })
    : []
  const rows = []
  const normalizedPrices = normalizePricing(pricing)
  const maxCost = Math.max(1, ...MODEL_CATALOG.map(model => {
    const row = pricingFor(model, normalizedPrices)
    const effective = effectivePricing(row, cacheReadRatio, cacheWriteRatio)
    return effective.input + effective.output
  }), ...Object.values(normalizedPrices).map(row => {
    const effective = effectivePricing(row, cacheReadRatio, cacheWriteRatio)
    return effective.input + effective.output
  }))
  for (const route of discovered) {
    const metadata = modelMetadata(route.model) ?? {
      id: route.model, aliases: [route.model], quality: 0.66, latency: 0.55,
      costIn: 1, costOut: 4, specialties: [], risk: 0.24,
    }
    const live = liveBenchRow(liveBench, route.model)
    const liveScores = live?.scores ?? {}
    const liveOverall = asScore(live?.overall)
    const quality = asScore(liveScores?.[taskType]) ?? liveOverall ?? metadata.quality
    const pricingRow = pricingFor(metadata, normalizedPrices, route.provider)
    const specialty = specialtyMatch(metadata, taskType, liveScores)
    rows.push({
      provider: route.provider,
      model: route.model,
      metadata,
      quality,
      liveScores,
      liveOverall,
      latency: metadata.latency,
      risk: metadata.risk,
      specialty,
      reasoningEfforts: route.reasoningEfforts,
      defaultReasoningEffort: route.defaultReasoningEffort,
      reasoningKnown: route.reasoningKnown,
      pricing: pricingRow,
      score: 0,
      estimatedCost: estimateCost(metadata, text, 900, normalizedPrices, cacheReadRatio, cacheWriteRatio),
    })
  }
  const taskNodes = taskPackages(taskType, text, complexity.band)
  const budget = Number(budgetUsd)
  const utilityPlan = solveAssignments({
    rows,
    tasks: taskNodes,
    weights,
    maxCost,
    text,
    complexity: complexity.band,
    budget: Number.POSITIVE_INFINITY,
    cacheReadRatio,
    cacheWriteRatio,
  })
  const budgetPlan = budget > 0
    ? solveAssignments({
      rows,
      tasks: taskNodes,
      weights,
      maxCost,
      text,
      complexity: complexity.band,
      budget,
      cacheReadRatio,
      cacheWriteRatio,
    })
    : null
  const minimumCostPlan = budget > 0 && budgetPlan === null
    ? solveAssignments({
      rows,
      tasks: taskNodes,
      weights,
      maxCost,
      text,
      complexity: complexity.band,
      budget: Number.POSITIVE_INFINITY,
      cacheReadRatio,
      cacheWriteRatio,
      minimizeCost: true,
    })
    : null
  const optimized = budget > 0 ? (budgetPlan ?? minimumCostPlan ?? utilityPlan) : utilityPlan
  const assignments = optimized?.assignments ?? []
  const usedRoutes = optimized?.usedRoutes ?? new Set()
  const constraintRelaxed = (optimized?.relaxedCount ?? 0) > 0
  for (const row of rows) {
    row.score = candidateUtility(row, taskNodes[0] ?? { type: taskType, qualityFloor: QUALITY_FLOORS[complexity.band] }, weights, maxCost, new Set(), cacheReadRatio, cacheWriteRatio).score
  }
  rows.sort((left, right) => right.score - left.score || compareRowsStable(left, right))
  const selectedAssignment = assignments[0]
  const selected = selectedAssignment?.row ?? rows[0] ?? null
  const synthesizerAssignment = assignments.at(-1)
  const synthesizer = synthesizerAssignment?.row ?? rows.find(row => /deepseek/i.test(row.model)) ?? rows[0]
  const subtasks = assignments.map(({ task, row, decision }) => ({
    id: task.id,
    name: task.name,
    ...(task.objective ? { objective: task.objective } : {}),
    type: task.type,
    recommended: row?.model ?? '待发现模型',
    recommendedProvider: row?.provider ?? '',
    recommendedReasoningEffort: decision?.reasoningEffort,
    preferredReasoningEffort: decision?.preferredReasoningEffort ?? task.preferredReasoningEffort,
    reasoningFit: Number(Number(decision?.reasoningFit ?? 0).toFixed(3)),
    purpose: task.purpose,
    criticality: task.criticality,
    qualityFloor: Number(task.qualityFloor.toFixed(3)),
    dependsOn: [...(task.dependsOn ?? [])],
  }))
  const costBreakdown = assignments.map(({ task, row, decision, estimatedCost, handoffPenalty }, index) => {
    const tokens = taskTokenBudget(text, { ...task, reasoningEffort: decision?.reasoningEffort }, complexity.band, cacheReadRatio, cacheWriteRatio)
    const taskEstimate = estimatedCost ?? taskCost(row, task, text, complexity.band, cacheReadRatio, cacheWriteRatio)
    return {
      stage: index + 1,
      purpose: task.purpose,
      model: row?.model ?? '待发现模型',
      provider: row?.provider ?? '',
      reasoningEffort: decision?.reasoningEffort,
      preferredReasoningEffort: decision?.preferredReasoningEffort,
      reasoningFit: Number(Number(decision?.reasoningFit ?? 0).toFixed(3)),
      reasoningOutputMultiplier: Number(Number(decision?.multiplier?.output ?? 1).toFixed(2)),
      inputTokens: tokens.inputTokens,
      cacheReadTokens: tokens.cacheReadTokens,
      cacheWriteTokens: tokens.cacheWriteTokens,
      outputTokens: tokens.outputTokens,
      estimatedCost: Number(taskEstimate.toFixed(6)),
      quality: Number((row === null ? 0 : qualityForTask(row, task.type)).toFixed(3)),
      handoffPenalty: Number(Number(handoffPenalty ?? 0).toFixed(3)),
    }
  })
  const totalEstimate = costBreakdown.reduce((sum, row) => sum + row.estimatedCost, 0)
  const baselineCost = assignments.reduce((sum, { task }) => {
    const strongest = rows.reduce((best, row) => qualityForTask(row, task.type) > (best === null ? -1 : qualityForTask(best, task.type)) ? row : best, null)
    return sum + taskCost(strongest, task, text, complexity.band, cacheReadRatio, cacheWriteRatio)
  }, 0)
  const budgetExceeded = Number(budgetUsd) > 0 && totalEstimate > Number(budgetUsd)
  const savings = baselineCost <= 0 ? 0 : clamp((baselineCost - totalEstimate) / baselineCost)
  const paretoPruned = (optimized?.candidatePools ?? []).reduce((sum, pool) => sum + pool.pruned, 0)
  const minimumFeasibleCost = optimized?.minimumFeasibleCost ?? minimumCostPlan?.cost ?? 0
  const reason = selected === null
    ? '尚未发现可用模型，保留 Harness 原始模型选择。'
    : `${complexity.band === 'simple' ? '低复杂度优先成本、响应速度与较低推理开销' : complexity.band === 'balanced' ? '在质量、成本、推理等级、延迟与风险之间平衡' : '高复杂度执行包含推理等级的依赖感知全局约束分配'}；任务类型为 ${taskType}，已对 ${String(subtasks.length)} 个工作包进行 Pareto 剪枝和有界组合搜索。`
  return {
    mode,
    complexity: { value: Number(complexity.value.toFixed(3)), band: complexity.band },
    taskType,
    taskTypes: [...new Set(taskNodes.map(task => task.type).filter(type => type !== 'reasoning'))],
    objectiveWeights: weights,
    candidates: rows.slice(0, 8).map(row => {
      const decision = candidateUtility(row, taskNodes[0] ?? { type: taskType, qualityFloor: QUALITY_FLOORS[complexity.band], preferredReasoningEffort: complexity.band === 'simple' ? 'low' : 'medium' }, weights, maxCost, new Set(), cacheReadRatio, cacheWriteRatio)
      return { provider: row.provider, model: row.model, score: Number(row.score.toFixed(3)), quality: Number(row.quality.toFixed(3)), specialty: Number(row.specialty.toFixed(3)), reasoningEffort: decision.reasoningEffort, preferredReasoningEffort: decision.preferredReasoningEffort, reasoningFit: Number(decision.reasoningFit.toFixed(3)), reasoningKnown: row.reasoningKnown, reasoningEfforts: row.reasoningEfforts, estimatedCost: Number(row.estimatedCost.toFixed(6)), inputPrice: row.pricing.input, outputPrice: row.pricing.output }
    }),
    selected: selected === null ? null : { provider: selected.provider, model: selected.model, reasoningEffort: selectedAssignment?.decision?.reasoningEffort, estimatedCost: Number(selected.estimatedCost.toFixed(6)) },
    subtasks,
    synthesizer: synthesizer === undefined ? null : { provider: synthesizer.provider, model: synthesizer.model, reasoningEffort: synthesizerAssignment?.decision?.reasoningEffort },
    estimatedCost: Number(totalEstimate.toFixed(6)),
    costBreakdown,
    optimization: {
      solver: 'pareto-pruned quality-constrained beam assignment',
      qualityFloor: QUALITY_FLOORS[complexity.band],
      budgetUsd: Number(Number(budgetUsd) > 0 ? Number(budgetUsd) : 0),
      cacheReadRatio: normalizedCacheRatios(cacheReadRatio, cacheWriteRatio).read,
      cacheWriteRatio: normalizedCacheRatios(cacheReadRatio, cacheWriteRatio).write,
      budgetExceeded,
      constraintRelaxed,
      baselineAllStrongCost: Number(baselineCost.toFixed(6)),
      estimatedSavings: Number(savings.toFixed(4)),
      distinctRoutes: usedRoutes.size,
      handoffCount: optimized?.switches ?? 0,
      paretoPruned,
      beamWidth: ROUTING_BEAM_WIDTH,
      budgetFeasible: budget <= 0 || budgetPlan !== null,
      minimumFeasibleCost: Number(Number(minimumFeasibleCost).toFixed(6)),
      liveBench: liveBench?.fetchedAt
        ? { source: liveBench.source ?? 'livebench', fetchedAt: liveBench.fetchedAt, models: Object.keys(liveBench.models ?? {}).length, stale: String(liveBenchError).length > 0, error: String(liveBenchError || '') }
        : { source: 'experimental-baseline', fetchedAt: null, models: 0, stale: false, error: String(liveBenchError || '') },
    },
    reason,
    generatedAt: new Date().toISOString(),
  }
}

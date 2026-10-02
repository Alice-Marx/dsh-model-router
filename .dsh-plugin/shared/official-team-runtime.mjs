/**
 * Execute a routed series of official CLI work packages in one isolated Git
 * worktree. A successful editable run is copied back with git apply only after
 * the original checkout is rechecked clean; incomplete work stays in the
 * worktree for review. No package supplies an executable or shell fragment.
 */
import { spawn } from 'node:child_process'
import { appendFile, mkdir, realpath, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { runOfficialTool, officialToolExecutionCapabilities, officialToolReadiness } from './official-tool-executor.mjs'
import { toolForProvider } from './official-tool-registry.mjs'

const MAX_GIT_OUTPUT = 64_000_000
const GIT_TIMEOUT_MS = 120_000

function within(parent, child) {
  const part = relative(parent, child)
  return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part))
}

async function canonicalDirectory(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) throw new TypeError('workspace must be an absolute directory')
  const canonical = await realpath(path)
  if (!(await stat(canonical)).isDirectory()) throw new TypeError('workspace must be a directory')
  return canonical
}

/** The session owner, never model arguments, selects the filesystem scope. */
export async function sessionWorkspace(ctx, exec) {
  const session = exec?.agent?.session
  if (!session) throw new Error('official CLI execution requires a live Harness session')
  const policy = ctx.sandboxPolicy.resolve({ session })
  const root = await canonicalDirectory(policy.workspaceRoot)
  const chosen = await canonicalDirectory(session.header?.cwd ?? policy.workspaceRoot)
  if (!within(root, chosen)) throw new Error('session working directory is outside the Harness workspace policy')
  return { cwd: chosen, root, sandboxMode: policy.mode }
}

function git(args, { cwd, input, signal, timeoutMs = GIT_TIMEOUT_MS } = {}) {
  return new Promise(resolveResult => {
    let child
    try {
      child = spawn('git', args, { cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      resolveResult({ ok: false, code: null, output: Buffer.from(String(error?.message ?? error)) })
      return
    }
    const stdoutChunks = []
    const stderrChunks = []
    let bytes = 0
    let oversized = false
    let timedOut = false
    let cancelled = false
    const collect = (data, chunks) => {
      bytes += data.length
      if (bytes > MAX_GIT_OUTPUT) { oversized = true; child.kill('SIGTERM'); return }
      chunks.push(data)
    }
    child.stdout.on('data', data => collect(data, stdoutChunks))
    child.stderr.on('data', data => collect(data, stderrChunks))
    child.stdin.on('error', () => { /* Git may exit before consuming a patch. */ })
    const onAbort = () => { cancelled = true; child.kill('SIGTERM') }
    signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeoutMs)
    child.on('error', error => finish(null, error))
    child.on('close', code => finish(code))
    if (input === undefined) child.stdin.end()
    else child.stdin.end(input)
    let finished = false
    function finish(code, error) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      const output = Buffer.concat(stdoutChunks)
      const stderr = Buffer.concat(stderrChunks)
      resolveResult({ ok: code === 0 && !oversized && !timedOut && !cancelled, code,
        output, stderr, oversized, timedOut, cancelled, error: error?.message })
    }
  })
}

function gitError(action, result) {
  const detail = String(result.stderr?.length ? result.stderr : result.output ?? '').trim().slice(-900)
  return new Error(`${action}失败${result.cancelled ? '（已取消）' : result.timedOut ? '（超时）' : result.oversized ? '（输出过大）' : ''}${detail ? `：${detail}` : ''}`)
}

async function cleanRepoRoot(workspace, signal) {
  const top = await git(['rev-parse', '--show-toplevel'], { cwd: workspace, signal })
  if (!top.ok) throw gitError('读取 Git 仓库', top)
  const repo = await canonicalDirectory(top.output.toString('utf8').trim())
  if (repo !== workspace) throw new Error('可编辑团队任务要求当前 Harness 工作目录为 Git 仓库根目录')
  const status = await git(['status', '--porcelain=v1', '--untracked-files=all'], { cwd: workspace, signal })
  if (!status.ok) throw gitError('检查原工作区', status)
  if (status.output.length > 0) throw new Error('原工作区有未提交改动；请先提交或选择干净工作区，再启动可编辑团队任务')
  return repo
}

/** Keep nested worktrees out of ordinary git status without changing tracked files. */
async function excludeNestedWorktrees(workspace, signal) {
  const ignored = await git(['check-ignore', '-q', '--', '.model-router-workspaces/'], { cwd: workspace, signal })
  if (ignored.ok) return
  if (ignored.code !== 1 || ignored.cancelled || ignored.timedOut) throw gitError('检查独立工作区忽略规则', ignored)
  const pathResult = await git(['rev-parse', '--git-path', 'info/exclude'], { cwd: workspace, signal })
  if (!pathResult.ok) throw gitError('定位 Git 本地忽略文件', pathResult)
  const pathText = pathResult.output.toString('utf8').trim()
  if (!pathText || pathText.includes('\0')) throw new Error('Git 本地忽略文件路径无效')
  const excludePath = isAbsolute(pathText) ? pathText : resolve(workspace, pathText)
  const parent = dirname(excludePath)
  await mkdir(parent, { recursive: true })
  await appendFile(excludePath, '\n# model-router-galgame isolated worktrees\n/.model-router-workspaces/\n', 'utf8')
  const confirmed = await git(['check-ignore', '-q', '--', '.model-router-workspaces/'], { cwd: workspace, signal })
  if (!confirmed.ok) throw gitError('确认独立工作区忽略规则', confirmed)
}

/** Keep generated worktrees beside the project so they use the same drive. */
async function isolatedWorktree(workspace, signal, allowedRoot) {
  await cleanRepoRoot(workspace, signal)
  const base = await git(['rev-parse', 'HEAD'], { cwd: workspace, signal })
  if (!base.ok || !/^[0-9a-f]{40,64}$/i.test(base.output.toString('utf8').trim())) {
    throw gitError('记录原仓库基线', base)
  }
  const baseCommit = base.output.toString('utf8').trim()
  const policyRoot = await canonicalDirectory(allowedRoot ?? workspace)
  const sibling = join(dirname(workspace), '.model-router-workspaces', basename(workspace))
  const parent = within(policyRoot, sibling) ? sibling : join(workspace, '.model-router-workspaces')
  if (parent === join(workspace, '.model-router-workspaces')) await excludeNestedWorktrees(workspace, signal)
  await mkdir(parent, { recursive: true })
  const isolatedRoot = await canonicalDirectory(parent)
  const target = join(isolatedRoot, `run-${randomUUID()}`)
  const added = await git(['worktree', 'add', '--detach', target, 'HEAD'], { cwd: workspace, signal })
  if (!added.ok) throw gitError('创建独立 Git 工作区', added)
  const runPath = await canonicalDirectory(target)
  if (!within(isolatedRoot, runPath) || runPath === isolatedRoot) throw new Error('独立工作区路径校验失败')
  return { workspace: runPath, isolatedRoot, baseCommit, source: workspace }
}

async function integrateWorktree(source, isolated, baseCommit, signal) {
  await cleanRepoRoot(source, signal)
  const current = await git(['rev-parse', 'HEAD'], { cwd: source, signal })
  if (!current.ok) throw gitError('复核原仓库基线', current)
  if (current.output.toString('utf8').trim() !== baseCommit) {
    throw new Error('原仓库 HEAD 在官方 CLI 执行期间发生变化；保留独立工作区，拒绝自动整合')
  }
  const ignored = await git(['ls-files', '--others', '--ignored', '--exclude-standard', '-z'], { cwd: isolated, signal })
  if (!ignored.ok) throw gitError('检查独立工作区忽略文件', ignored)
  const ignoredPaths = ignored.output.toString('utf8').split('\0').filter(Boolean)
  const staged = await git(['add', '-A'], { cwd: isolated, signal })
  if (!staged.ok) throw gitError('收集独立工作区变更', staged)
  // Compare the final index with the original checkout commit. Vendor agents
  // may create commits in their worktree; diffing only its current HEAD would
  // silently drop all committed work.
  const patch = await git(['diff', '--cached', '--binary', baseCommit], { cwd: isolated, signal })
  if (!patch.ok) throw gitError('生成独立工作区补丁', patch)
  const names = await git(['diff', '--cached', '--name-only', baseCommit], { cwd: isolated, signal })
  if (!names.ok) throw gitError('列出修改文件', names)
  const changedFiles = names.output.toString('utf8').trim().split(/\r?\n/).filter(Boolean)
  if (patch.output.length === 0) return { integrated: false, changedFiles: [],
    ignoredArtifacts: ignoredPaths.length, ignoredExamples: ignoredPaths.slice(0, 12),
    notice: ignoredPaths.length > 0
      ? '官方 CLI 只生成了 Git 忽略的产物；它们仍在独立工作区，须人工核对。'
      : '官方 CLI 没有修改受 Git 管理的文件。' }
  const checked = await git(['apply', '--check', '--binary', '-'], { cwd: source, input: patch.output, signal })
  if (!checked.ok) throw gitError('核对原工作区补丁', checked)
  const applied = await git(['apply', '--binary', '-'], { cwd: source, input: patch.output, signal })
  if (!applied.ok) throw gitError('整合原工作区补丁', applied)
  return { integrated: true, changedFiles,
    ignoredArtifacts: ignoredPaths.length, ignoredExamples: ignoredPaths.slice(0, 12),
    notice: ignoredPaths.length > 0
      ? `源文件补丁已应用；${ignoredPaths.length} 个 Git 忽略产物未整合，仍在独立工作区供核对。`
      : '补丁已应用至原工作区，保留独立工作区供核对。' }
}

function checkedTeamCliModels(cliModels, assigned) {
  if (cliModels == null) return Object.create(null)
  if (typeof cliModels !== 'object' || Array.isArray(cliModels)) {
    throw new TypeError('cliModels must map work package ids or official tool ids to configured CLI model names')
  }
  const packages = new Map(assigned.map(item => [item.id, item]))
  const tools = new Set(assigned.map(item => item.toolId))
  const checked = Object.create(null)
  for (const [key, model] of Object.entries(cliModels)) {
    const toolId = packages.get(key)?.toolId ?? (tools.has(key) ? key : null)
    if (!toolId || toolId === 'zcode') {
      throw new TypeError(`cliModels contains an unsupported package or tool id: ${key}`)
    }
    if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(model)) {
      throw new TypeError(`cliModels contains an invalid model name for ${toolId}`)
    }
    if ((toolId === 'minimax-code' || toolId === 'mimo-code') && !model.includes('/')) {
      throw new TypeError(`${toolId} requires a provider/model CLI name`)
    }
    checked[key] = model
  }
  return checked
}

function teamCliModel(item, cliModels) {
  // Harness directory IDs and vendor CLI aliases are independent namespaces.
  // Only the two CLIs with a verified direct model argument contract receive
  // a planned ID. All other vendors use their configured default until the
  // user supplies a verified CLI mapping through that vendor's own settings.
  if (cliModels[item.id]) return cliModels[item.id]
  if (cliModels[item.toolId]) return cliModels[item.toolId]
  return item.toolId === 'claude-code' || item.toolId === 'codex'
    ? item.recommendedModel : null
}

function reportedCliModel(toolId, value) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  // MiniMax's verified exec.result.model is a structured selection, while
  // its --model argument is one provider/model string.
  if (toolId === 'minimax-code' && value && typeof value === 'object'
    && typeof value.providerId === 'string' && value.providerId
    && typeof value.modelId === 'string' && value.modelId) {
    return `${value.providerId}/${value.modelId}`
  }
  return null
}

function packagePrompt(task, item, completed) {
  const dependencies = item.dependsOn.map(id => completed.find(result => result.id === id)).filter(Boolean)
  const directions = {
    analysis: '提取本工作包对应的需求、约束、依赖和验收依据。此阶段只做分析，不修改文件。',
    execution: '依据总任务与前置分析完成当前领域的实现或交付；不要接管其他执行工作包。',
    verification: '逐项核对前置工作包的交付与原任务要求，列出证据、失败点和未验证内容。',
    synthesis: '整合前置工作包成果，核对冲突与遗漏，给出最终交付清单和未完成事项。',
  }
  return [
    `总任务：\n${String(task).slice(0, 40_000)}`,
    `当前工作包：${item.name}（${item.type}）\n工作要求：${directions[item.purpose] ?? item.purpose}`,
    item.objective ? `当前包的具体目标：\n${item.objective}` : '',
    Array.isArray(item.verificationChecklist) && item.verificationChecklist.length
      ? `验收要点：\n${item.verificationChecklist.map(point => `- ${point}`).join('\n')}` : '',
    dependencies.length
      ? `依赖工作包结果：\n${dependencies.map(dep => `${dep.name}: ${dep.finalText.slice(0, 2_500)}`).join('\n\n')}`
      : '当前工作包无前置依赖。',
    '仅处理当前工作包。说明实际完成内容、改动文件和未完成事项；不要把无法完成说成完成。',
  ].join('\n\n')
}

/** Preflight every assignment before any model request or workspace write. */
export function executableTeamPackages(plan, installedIds = [], mode = 'read-only') {
  const capabilities = new Map(officialToolExecutionCapabilities().map(item => [item.id, item]))
  const packages = Array.isArray(plan?.team?.workPackages) ? plan.team.workPackages : []
  const blocking = []
  const assigned = packages.map(item => {
    const tool = toolForProvider(item.recommendedProvider)
    const capability = tool ? capabilities.get(tool.id) : null
    if (!tool || !capability?.supported || !capability.modes?.includes(mode) || !installedIds.includes(tool.id)) {
      blocking.push({ id: item.id, name: item.name, provider: item.recommendedProvider,
        toolId: tool?.id ?? null,
        reason: !tool ? '该供应商没有注册表中的官方 CLI。'
          : !capability?.supported ? capability?.reason ?? '此 CLI 暂不支持托管执行。'
            : !capability.modes?.includes(mode) ? `此 CLI 不支持 ${mode} 模式；请选择已审批的可编辑隔离工作区模式。`
            : '此 CLI 尚未安装。' })
    }
    return { ...item, toolId: tool?.id ?? null }
  })
  return { assigned, blocking }
}

/** Remove a worktree this run created but could not use; failures are ignored. */
async function removeWorktree(source, target) {
  try { await git(['worktree', 'remove', '--force', target], { cwd: source }) } catch { /* left for manual cleanup */ }
}

/**
 * Copy the changes of an earlier, never integrated worktree into a fresh one.
 * Refuses when the original checkout moved since that run (the patch would be
 * based on another commit) or when the earlier worktree is not one of ours.
 */
async function seedWorktree(isolated, seedFrom, signal) {
  if (!/^[0-9a-f]{40,64}$/i.test(seedFrom.baseCommit)) throw new Error('原运行没有记录 Git 基线，无法在新工作区续跑。')
  if (seedFrom.baseCommit !== isolated.baseCommit) {
    throw new Error('原仓库 HEAD 已不是原运行的基线提交；无法安全套用之前的改动。请核对原独立工作区后重新执行整个团队任务。')
  }
  let prior
  try { prior = await canonicalDirectory(seedFrom.workspace) }
  catch { throw new Error('原运行的独立工作区已不存在，无法套用之前的改动；请重新执行整个团队任务。') }
  // Only a worktree of this repository that the plugin created (run-<uuid>) is accepted.
  const listed = await git(['worktree', 'list', '--porcelain'], { cwd: isolated.source, signal })
  const worktrees = listed.ok ? listed.output.toString('utf8').split(/\r?\n/).filter(line => line.startsWith('worktree ')).map(line => line.slice(9)) : []
  const known = await Promise.all(worktrees.map(path => canonicalDirectory(path).catch(() => null)))
  if (!known.includes(prior) || !/^run-[0-9a-f-]{36}$/i.test(basename(prior)) || basename(dirname(dirname(prior))) !== '.model-router-workspaces' && basename(dirname(prior)) !== '.model-router-workspaces') {
    throw new Error('原独立工作区不是本仓库由插件创建的 Git 工作树，拒绝读取。')
  }
  const staged = await git(['add', '-A'], { cwd: prior, signal })
  if (!staged.ok) throw gitError('收集原独立工作区变更', staged)
  const patch = await git(['diff', '--cached', '--binary', seedFrom.baseCommit], { cwd: prior, signal })
  if (!patch.ok) throw gitError('生成原独立工作区补丁', patch)
  const names = await git(['diff', '--cached', '--name-only', seedFrom.baseCommit], { cwd: prior, signal })
  const files = names.ok ? names.output.toString('utf8').trim().split(/\r?\n/).filter(Boolean) : []
  if (patch.output.length === 0) return { from: prior, files: [] }
  const checked = await git(['apply', '--check', '--binary', '-'], { cwd: isolated.workspace, input: patch.output, signal })
  if (!checked.ok) throw gitError('核对之前改动的补丁', checked)
  const applied = await git(['apply', '--binary', '-'], { cwd: isolated.workspace, input: patch.output, signal })
  if (!applied.ok) throw gitError('在新工作区套用之前的改动', applied)
  return { from: prior, files }
}

/** Sequential execution preserves DAG dependencies and avoids edit conflicts. */
export async function runOfficialTeam({ plan, task, workspace, allowedRoot, mode = 'read-only', installedIds = [], cliModels, signal, sandbox, runtime, previous = [], onlyIds = null, seedFrom = null }) {
  // A retry runs only `onlyIds`; earlier results feed dependency context. An
  // editable retry needs `seedFrom` (the earlier, never integrated worktree and
  // its base commit): a fresh worktree gets that worktree's changes first, so
  // the retried steps continue from them and one patch is integrated at the end.
  const retry = Array.isArray(onlyIds)
  if (retry && mode !== 'read-only' && !(seedFrom && typeof seedFrom.workspace === 'string' && typeof seedFrom.baseCommit === 'string')) {
    throw new TypeError('an editable team retry needs the earlier isolated worktree (seedFrom)')
  }
  const selected = executableTeamPackages(plan, installedIds, mode)
  const assigned = retry ? selected.assigned.filter(item => onlyIds.includes(item.id)) : selected.assigned
  const blocking = retry ? selected.blocking.filter(item => onlyIds.includes(item.id)) : selected.blocking
  if (assigned.length === 0) return { status: 'blocked', blocking: [{ reason: '计划没有工作包。' }], results: [] }
  if (blocking.length > 0) return { status: 'blocked', blocking, results: [] }
  if (mode !== 'read-only' && mode !== 'workspace-write') throw new TypeError('team mode must be read-only or workspace-write')
  const configuredCliModels = checkedTeamCliModels(cliModels, assigned)
  const source = await canonicalDirectory(workspace)
  if (typeof sandbox?.confine !== 'function') return { status: 'blocked', blocking: [{ reason: '官方 Harness 进程沙箱不可用。' }], results: [] }
  // The Host passes no runtime override. Tests can inject inert CLI adapters to
  // exercise assignment, stopping, and Git integration without provider accounts.
  const readinessCheck = runtime?.readiness ?? officialToolReadiness
  const runTool = runtime?.runTool ?? runOfficialTool
  const readiness = await Promise.all([...new Set(assigned.map(item => item.toolId))].map(id => readinessCheck(id, source)))
  const unready = readiness.filter(item => !item.ready)
  if (unready.length > 0) return { status: 'blocked', blocking: unready.map(item => ({ toolId: item.id, reason: item.reason })), results: [] }
  const isolated = mode === 'workspace-write' ? await isolatedWorktree(source, signal, allowedRoot) : null
  const runWorkspace = isolated?.workspace ?? source
  let seeded = null
  if (isolated && retry) {
    try { seeded = await seedWorktree(isolated, seedFrom, signal) }
    catch (error) {
      await removeWorktree(source, isolated.workspace)
      return { status: 'blocked', blocking: [{ reason: String(error?.message ?? error) }], results: [] }
    }
  }
  const completed = []
  const context = retry ? (Array.isArray(previous) ? previous : []).filter(item => item?.id && typeof item.finalText === 'string') : []
  for (const item of assigned) {
    if (signal?.aborted) return { status: 'cancelled', workspace: runWorkspace, results: completed }
    const cliModel = teamCliModel(item, configuredCliModels)
    const result = await runTool({
      toolId: item.toolId,
      modelId: cliModel,
      task: packagePrompt(task, item, [...context, ...completed]),
      workspace: runWorkspace,
      mode,
      isolatedRoot: isolated?.isolatedRoot,
      sandbox,
      signal,
    })
    const reportedModel = reportedCliModel(item.toolId, result.reportedModel)
    const modelMismatch = result.status === 'succeeded' && cliModel && reportedModel
      && cliModel !== reportedModel
    const packageStatus = modelMismatch ? 'model-mismatch' : result.status
    completed.push({ id: item.id, name: item.name,
      ...(item.objective ? { objective: item.objective } : {}), provider: item.recommendedProvider,
      recommendedModel: item.recommendedModel, toolId: item.toolId,
      requestedCliModel: result.requestedModel ?? null,
      actualModel: reportedModel,
      modelNotice: modelMismatch
        ? `官方 CLI 回报模型 ${reportedModel}，与本包指定的 ${cliModel} 不一致；后续工作包已停止。`
        : result.modelNotice ?? (!cliModel
        ? 'Harness 推荐模型 ID 未经此厂商 CLI 验证；本包使用厂商 CLI 已配置的默认模型。'
        : reportedModel ? null : '该 CLI 未返回可核验的实际模型 ID；请以厂商运行记录核对。'),
      status: packageStatus, finalText: result.finalText ?? '',
      ...(result.usage ? { usage: result.usage } : {}),
      ...(Number.isFinite(result.reportedCostUsd) ? { reportedCostUsd: result.reportedCostUsd } : {}),
      error: modelMismatch ? '官方 CLI 实际模型与指定模型不一致。' : result.error ?? result.reason ?? null,
      outputTail: result.status === 'succeeded' ? null : result.stderrTail ?? result.stdoutTail ?? null })
    if (packageStatus !== 'succeeded') return { status: 'incomplete', workspace: runWorkspace, results: completed,
      ...(isolated ? { baseCommit: isolated.baseCommit } : {}), ...(seeded ? { seeded } : {}) }
  }
  if (!isolated) return { status: 'cli-completed', workspace: runWorkspace, results: completed,
    notice: '只读模式已收集各工作包结果；模型输出仍需人工验收。' }
  try {
    const integration = await integrateWorktree(source, runWorkspace, isolated.baseCommit, signal)
    return { status: integration.ignoredArtifacts > 0 ? 'integration-pending' : 'cli-completed',
      workspace: runWorkspace, results: completed, integration, baseCommit: isolated.baseCommit, ...(seeded ? { seeded } : {}),
      notice: integration.ignoredArtifacts > 0
        ? '受 Git 管理的源文件已整合；忽略产物保留在独立工作区，仍需核对和补交。'
        : '各 CLI 进程成功结束且可用补丁已整合；文件内容仍需按任务要求验收。' }
  } catch (error) {
    return { status: 'integration-pending', workspace: runWorkspace, results: completed, baseCommit: isolated.baseCommit,
      ...(seeded ? { seeded } : {}),
      error: String(error?.message ?? error), notice: '独立工作区已保留；原工作区未自动整合。' }
  }
}

/** One editable CLI task also uses the same isolated workspace and merge gate. */
export async function runOfficialTask({ toolId, task, workspace, allowedRoot, modelId, mode = 'read-only', signal, sandbox }) {
  const source = await canonicalDirectory(workspace)
  if (typeof sandbox?.confine !== 'function') return { toolId, status: 'unsupported', reason: '官方 Harness 进程沙箱不可用。' }
  const readiness = await officialToolReadiness(toolId, source)
  if (!readiness.ready) return { toolId, status: 'unsupported', reason: readiness.reason }
  const isolated = mode === 'workspace-write' ? await isolatedWorktree(source, signal, allowedRoot) : null
  const result = await runOfficialTool({ toolId, task, modelId, workspace: isolated?.workspace ?? source,
    mode, isolatedRoot: isolated?.isolatedRoot, signal, sandbox })
  if (!isolated || result.status !== 'succeeded') return { ...result, ...(isolated ? { isolatedWorkspace: isolated.workspace, baseCommit: isolated.baseCommit } : {}) }
  try {
    const integration = await integrateWorktree(source, isolated.workspace, isolated.baseCommit, signal)
    return { ...result,
      ...(integration.ignoredArtifacts > 0 ? { status: 'integration-pending' } : {}),
      isolatedWorkspace: isolated.workspace, integration }
  } catch (error) {
    return { ...result, status: 'integration-pending', isolatedWorkspace: isolated.workspace,
      integrationError: String(error?.message ?? error) }
  }
}

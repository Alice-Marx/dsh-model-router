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

const MAX_GIT_OUTPUT = 12_000_000
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
  return { workspace: runPath, isolatedRoot }
}

async function integrateWorktree(source, isolated, signal) {
  await cleanRepoRoot(source, signal)
  const ignored = await git(['ls-files', '--others', '--ignored', '--exclude-standard', '-z'], { cwd: isolated, signal })
  if (!ignored.ok) throw gitError('检查独立工作区忽略文件', ignored)
  if (ignored.output.length > 0) {
    const paths = ignored.output.toString('utf8').split('\0').filter(Boolean)
    throw new Error(`独立工作区包含 ${paths.length} 个被 Git 忽略的产物，尚未整合；请在保留的工作区核对：${paths.slice(0, 12).join('、')}`)
  }
  const staged = await git(['add', '-A'], { cwd: isolated, signal })
  if (!staged.ok) throw gitError('收集独立工作区变更', staged)
  const patch = await git(['diff', '--cached', '--binary', 'HEAD'], { cwd: isolated, signal })
  if (!patch.ok) throw gitError('生成独立工作区补丁', patch)
  const names = await git(['diff', '--cached', '--name-only', 'HEAD'], { cwd: isolated, signal })
  if (!names.ok) throw gitError('列出修改文件', names)
  const changedFiles = names.output.toString('utf8').trim().split(/\r?\n/).filter(Boolean)
  if (patch.output.length === 0) return { integrated: false, changedFiles: [], notice: '官方 CLI 没有修改受 Git 管理的文件。' }
  const checked = await git(['apply', '--check', '--binary', '-'], { cwd: source, input: patch.output, signal })
  if (!checked.ok) throw gitError('核对原工作区补丁', checked)
  const applied = await git(['apply', '--binary', '-'], { cwd: source, input: patch.output, signal })
  if (!applied.ok) throw gitError('整合原工作区补丁', applied)
  return { integrated: true, changedFiles, notice: '补丁已应用至原工作区，保留独立工作区供核对。' }
}

function packagePrompt(task, item, completed) {
  const dependencies = item.dependsOn.map(id => completed.find(result => result.id === id)).filter(Boolean)
  return [
    `总任务：\n${String(task).slice(0, 40_000)}`,
    `当前工作包：${item.name}（${item.type}）\n目标：${item.purpose}`,
    dependencies.length
      ? `依赖工作包结果：\n${dependencies.map(dep => `${dep.name}: ${dep.finalText.slice(0, 2_500)}`).join('\n\n')}`
      : '当前工作包无前置依赖。',
    '仅处理当前工作包。说明实际完成内容、改动文件和未完成事项；不要把无法完成说成完成。',
  ].join('\n\n')
}

/** Preflight every assignment before any model request or workspace write. */
export function executableTeamPackages(plan, installedIds = []) {
  const capabilities = new Map(officialToolExecutionCapabilities().map(item => [item.id, item]))
  const packages = Array.isArray(plan?.team?.workPackages) ? plan.team.workPackages : []
  const blocking = []
  const assigned = packages.map(item => {
    const tool = toolForProvider(item.recommendedProvider)
    const capability = tool ? capabilities.get(tool.id) : null
    if (!tool || !capability?.supported || !installedIds.includes(tool.id)) {
      blocking.push({ id: item.id, name: item.name, provider: item.recommendedProvider,
        toolId: tool?.id ?? null,
        reason: !tool ? '该供应商没有注册表中的官方 CLI。'
          : !capability?.supported ? capability?.reason ?? '此 CLI 暂不支持托管执行。'
            : '此 CLI 尚未安装。' })
    }
    return { ...item, toolId: tool?.id ?? null }
  })
  return { assigned, blocking }
}

/** Sequential execution preserves DAG dependencies and avoids edit conflicts. */
export async function runOfficialTeam({ plan, task, workspace, allowedRoot, mode = 'read-only', installedIds = [], signal, sandbox }) {
  const { assigned, blocking } = executableTeamPackages(plan, installedIds)
  if (assigned.length === 0) return { status: 'blocked', blocking: [{ reason: '计划没有工作包。' }], results: [] }
  if (blocking.length > 0) return { status: 'blocked', blocking, results: [] }
  if (mode !== 'read-only' && mode !== 'workspace-write') throw new TypeError('team mode must be read-only or workspace-write')
  const source = await canonicalDirectory(workspace)
  if (typeof sandbox?.confine !== 'function') return { status: 'blocked', blocking: [{ reason: '官方 Harness 进程沙箱不可用。' }], results: [] }
  const readiness = await Promise.all([...new Set(assigned.map(item => item.toolId))].map(id => officialToolReadiness(id, source)))
  const unready = readiness.filter(item => !item.ready)
  if (unready.length > 0) return { status: 'blocked', blocking: unready.map(item => ({ toolId: item.id, reason: item.reason })), results: [] }
  const isolated = mode === 'workspace-write' ? await isolatedWorktree(source, signal, allowedRoot) : null
  const runWorkspace = isolated?.workspace ?? source
  const completed = []
  for (const item of assigned) {
    if (signal?.aborted) return { status: 'cancelled', workspace: runWorkspace, results: completed }
    const result = await runOfficialTool({
      toolId: item.toolId,
      modelId: item.recommendedModel,
      task: packagePrompt(task, item, completed),
      workspace: runWorkspace,
      mode,
      isolatedRoot: isolated?.isolatedRoot,
      sandbox,
      signal,
    })
    completed.push({ id: item.id, name: item.name, provider: item.recommendedProvider,
      recommendedModel: item.recommendedModel, toolId: item.toolId,
      requestedCliModel: result.requestedModel ?? null,
      actualModel: '已请求推荐模型；实际模型仍须以该厂商 CLI 返回记录核对',
      status: result.status, finalText: result.finalText ?? '',
      error: result.error ?? result.reason ?? null,
      outputTail: result.status === 'succeeded' ? null : result.stderrTail ?? result.stdoutTail ?? null })
    if (result.status !== 'succeeded') return { status: 'incomplete', workspace: runWorkspace, results: completed }
  }
  if (!isolated) return { status: 'cli-completed', workspace: runWorkspace, results: completed,
    notice: '只读模式已收集各工作包结果；模型输出仍需人工验收。' }
  try {
    const integration = await integrateWorktree(source, runWorkspace, signal)
    return { status: 'cli-completed', workspace: runWorkspace, results: completed, integration,
      notice: '各 CLI 进程成功结束且可用补丁已整合；文件内容仍需按任务要求验收。' }
  } catch (error) {
    return { status: 'integration-pending', workspace: runWorkspace, results: completed,
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
  if (!isolated || result.status !== 'succeeded') return { ...result, ...(isolated ? { isolatedWorkspace: isolated.workspace } : {}) }
  try {
    return { ...result, isolatedWorkspace: isolated.workspace,
      integration: await integrateWorktree(source, isolated.workspace, signal) }
  } catch (error) {
    return { ...result, status: 'integration-pending', isolatedWorkspace: isolated.workspace,
      integrationError: String(error?.message ?? error) }
  }
}

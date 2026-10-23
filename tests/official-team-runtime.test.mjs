import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  executableTeamPackages,
  preflightOfficialWorkspace,
  runOfficialTask,
  runOfficialTeam,
  sessionWorkspace,
} from '../.dsh-plugin/shared/official-team-runtime.mjs'
import { buildTeamRunRecord, buildToolRunRecord, spending } from '../.dsh-plugin/shared/run-ledger.mjs'

const repository = fileURLToPath(new URL('..', import.meta.url))

function workPackage(id, provider, model, dependsOn = [], purpose = 'execution') {
  return {
    id, name: `Package ${id}`, type: purpose, purpose, dependsOn,
    objective: `Finish ${id}`, verificationChecklist: [`Check ${id}`],
    recommendedProvider: provider, recommendedModel: model,
  }
}

function teamPlan(...workPackages) {
  return { team: { workPackages } }
}

function sandbox() {
  return { confine() { throw new Error('mock runner must never spawn a CLI') } }
}

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

const samePath = (first, second) => process.platform === 'win32'
  ? resolve(first).toLowerCase() === resolve(second).toLowerCase() : resolve(first) === resolve(second)

async function hostStorageParent(workspace) {
  const canonical = await realpath(workspace)
  const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical
  return join(await realpath(tmpdir()), '.model-router-workspaces', createHash('sha256').update(identity).digest('hex'))
}

async function temporaryRepository(run) {
  const temporary = await mkdtemp(join(tmpdir(), 'model-router-team-'))
  const workspace = join(temporary, 'repo')
  try {
    await mkdir(workspace)
    git(workspace, 'init', '-q')
    await writeFile(join(workspace, 'README.md'), 'base\n')
    git(workspace, 'add', 'README.md')
    git(workspace, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial')
    return await run({ temporary, workspace })
  } finally {
    // Windows worktrees live outside the fresh source directory. Remove only
    // registered test worktrees inside that directory or its exact Host key.
    const storage = await hostStorageParent(workspace)
    const canonicalSource = await realpath(workspace)
    const canonicalTemporary = await realpath(temporary)
    const registered = execFileSync('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: workspace, encoding: 'utf8' })
      .split('\0').filter(part => part.startsWith('worktree ')).map(part => part.slice(9))
    for (const path of registered) {
      const canonical = await realpath(path)
      if (samePath(canonical, canonicalSource)) continue
      const part = relative(canonicalTemporary, canonical)
      const insideTemporary = part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
      assert.ok(insideTemporary || samePath(dirname(canonical), storage)
        && /^run-[0-9a-f-]{36}$/i.test(basename(canonical)), 'cleanup target must be this test repository worktree')
      git(workspace, 'worktree', 'remove', '--force', canonical)
    }
    try { await rmdir(storage) } catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error }
    // Only remove the fresh test directory, never a caller-supplied path.
    const parent = await realpath(tmpdir())
    const target = canonicalTemporary
    const part = relative(parent, target)
    assert.ok(part.startsWith('model-router-team-') && part !== '..'
      && !part.startsWith(`..${sep}`) && !isAbsolute(part))
    await rm(target, { recursive: true, force: true })
  }
}

test('session workspace comes from the live Harness session and stays inside policy root', async () => {
  const root = await realpath(repository)
  const child = await realpath(join(root, '.dsh-plugin'))
  const session = { header: { cwd: child } }
  const resolvedSessions = []
  const ctx = { sandboxPolicy: { resolve({ session: received }) {
    resolvedSessions.push(received)
    return { workspaceRoot: root, mode: 'read-only' }
  } } }

  assert.deepEqual(await sessionWorkspace(ctx, { agent: { session } }), {
    cwd: child, root, sandboxMode: 'read-only',
  })
  assert.equal(resolvedSessions[0], session)
  await assert.rejects(sessionWorkspace(ctx, {}), /live Harness session/)
  await assert.rejects(sessionWorkspace(ctx, { agent: {
    session: { header: { cwd: dirname(root) } },
  } }), /outside the Harness workspace policy/)
})

test('team preflight blocks unsupported providers and read-only unsafe CLIs', () => {
  const plan = teamPlan(
    workPackage('simple', 'moonshot', 'kimi-k3'),
    workPackage('unknown', 'unregistered-provider', 'unknown-large', ['simple']),
  )
  const writable = executableTeamPackages(plan, ['kimi-code'], 'workspace-write')
  assert.deepEqual(writable.assigned.map(item => item.toolId), ['kimi-code', null])
  assert.deepEqual(writable.blocking.map(item => item.id), ['unknown'])

  const readOnly = executableTeamPackages(teamPlan(plan.team.workPackages[0]), ['kimi-code'], 'read-only')
  assert.equal(readOnly.blocking.length, 1)
  assert.match(readOnly.blocking[0].reason, /read-only/)
})

test('editable workspace preview accepts a clean Git root without creating a worktree or changing ignores', async () => {
  await temporaryRepository(async ({ workspace }) => {
    const worktreesBefore = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: workspace, encoding: 'utf8' })
    const excludeBefore = await readFile(join(workspace, '.git', 'info', 'exclude'), 'utf8')
    assert.equal(await preflightOfficialWorkspace(join(workspace, '.'), 'workspace-write'), await realpath(workspace))
    assert.equal(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: workspace, encoding: 'utf8' }), worktreesBefore)
    assert.equal(await readFile(join(workspace, '.git', 'info', 'exclude'), 'utf8'), excludeBefore)
    assert.equal(await readFile(join(workspace, 'README.md'), 'utf8'), 'base\n')
    await assert.rejects(realpath(join(workspace, '.model-router-workspaces')), { code: 'ENOENT' })
  })
})

test('editable workspace preview rejects dirty or nested checkouts while read-only remains available', async () => {
  await temporaryRepository(async ({ workspace }) => {
    const nested = join(workspace, 'nested')
    await mkdir(nested)
    await assert.rejects(preflightOfficialWorkspace(nested, 'workspace-write'), /Git 仓库根目录/)
    assert.equal(await preflightOfficialWorkspace(nested), await realpath(nested))
    await writeFile(join(workspace, 'README.md'), 'uncommitted user work\n')
    const worktreesBefore = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: workspace, encoding: 'utf8' })
    await assert.rejects(preflightOfficialWorkspace(workspace, 'workspace-write'), /未提交改动/)
    assert.equal(await preflightOfficialWorkspace(workspace, 'read-only'), await realpath(workspace))
    assert.equal(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: workspace, encoding: 'utf8' }), worktreesBefore)
    assert.equal(await readFile(join(workspace, 'README.md'), 'utf8'), 'uncommitted user work\n')
  })
})

test('workspace preview permits non-Git directories only for read-only execution', async () => {
  await temporaryRepository(async ({ temporary }) => {
    const directory = join(temporary, 'plain-files')
    await mkdir(directory)
    await writeFile(join(directory, 'notes.txt'), 'plain directory\n')
    assert.equal(await preflightOfficialWorkspace(directory), await realpath(directory))
    await assert.rejects(preflightOfficialWorkspace(directory, 'workspace-write'), /读取 Git 仓库失败/)
    assert.equal(await readFile(join(directory, 'notes.txt'), 'utf8'), 'plain directory\n')
    await assert.rejects(realpath(join(directory, '.model-router-workspaces')), { code: 'ENOENT' })
  })
})

test('invalid or unassigned CLI model mappings fail before any CLI or workspace mutation', async () => {
  const plan = teamPlan(workPackage('simple', 'moonshot', 'harness-kimi'))
  const common = { plan, task: 'Do the simple package', workspace: repository,
    mode: 'workspace-write', installedIds: ['kimi-code'], sandbox: sandbox() }
  for (const cliModels of [[], { outsider: 'kimi-k3' }, { simple: 'kimi-k3; echo unsafe' }]) {
    await assert.rejects(runOfficialTeam({ ...common, cliModels }), /cliModels/)
  }
})

test('missing Harness process confinement blocks the team before CLI readiness', async () => {
  const plan = teamPlan(workPackage('simple', 'moonshot', 'harness-kimi'))
  const result = await runOfficialTeam({ plan, task: 'Do the simple package',
    workspace: repository, mode: 'workspace-write', installedIds: ['kimi-code'],
    runtime: {
      async readiness() { throw new Error('must not probe without sandbox') },
      async runTool() { throw new Error('must not run without sandbox') },
    },
  })
  assert.equal(result.status, 'blocked')
  assert.match(result.blocking[0].reason, /沙箱不可用/)
})

test('single-tool mode readiness rejects edits before creating a Git worktree or dispatching', async () => {
  await temporaryRepository(async ({ temporary, workspace }) => {
    const worktreesBefore = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: workspace, encoding: 'utf8' })
    let dispatched = false
    const checks = [
      { ready: true, readyModes: ['read-only'], modes: ['read-only', 'workspace-write'],
        modeReasons: { 'workspace-write': 'Codex 当前仅支持只读任务。' } },
      { ready: true, readyModes: [], modes: ['workspace-write'] },
      { ready: true, modes: ['read-only'] },
      { ready: true },
      { ready: false, modes: ['workspace-write'], reason: '所选入口不可用。' },
    ]
    for (const readiness of checks) {
      const result = await runOfficialTask({ toolId: 'codex', task: 'Do not start an unsupported edit',
        workspace, allowedRoot: temporary, mode: 'workspace-write', sandbox: sandbox(), runtime: {
          async readiness(id, source) {
            assert.equal(id, 'codex')
            assert.equal(source, await realpath(workspace))
            return readiness
          },
          async runTool() { dispatched = true; throw new Error('an unsupported mode must not dispatch') },
        } })
      assert.equal(result.status, 'unsupported')
      assert.equal(result.isolatedWorkspace, undefined)
      assert.match(result.reason, /只读|workspace-write|入口不可用/)
    }
    assert.equal(dispatched, false)
    assert.equal(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: workspace, encoding: 'utf8' }), worktreesBefore)
    assert.equal(await readFile(join(workspace, 'README.md'), 'utf8'), 'base\n')
  })
})

test('single-tool execution accepts legacy readiness modes and integrates an approved isolated edit', async () => {
  await temporaryRepository(async ({ temporary, workspace }) => {
    const calls = []
    const result = await runOfficialTask({ toolId: 'kimi-code', task: 'Create the offline fixture',
      workspace, allowedRoot: temporary, mode: 'workspace-write', sandbox: sandbox(), runtime: {
        async readiness() { return { ready: true, modes: ['workspace-write'] } },
        async runTool(options) {
          calls.push(options)
          assert.notEqual(options.workspace, await realpath(workspace))
          assert.equal(options.mode, 'workspace-write')
          await writeFile(join(options.workspace, 'delivery.txt'), 'offline edit\n')
          return { status: 'succeeded', finalText: 'fixture complete' }
        },
      } })
    assert.equal(calls.length, 1)
    assert.equal(result.status, 'succeeded')
    assert.equal(result.integration.integrated, true)
    assert.equal((await readFile(join(workspace, 'delivery.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'offline edit\n')
  })
})

test('single-tool read-only execution uses explicit readyModes even when legacy modes differ', async () => {
  await temporaryRepository(async ({ workspace }) => {
    const source = await realpath(workspace)
    const result = await runOfficialTask({ toolId: 'codex', task: 'Read the offline fixture',
      workspace, mode: 'read-only', sandbox: sandbox(), runtime: {
        async readiness() { return { ready: true, readyModes: ['read-only'], modes: [] } },
        async runTool(options) {
          assert.equal(options.workspace, source)
          assert.equal(options.mode, 'read-only')
          assert.equal(options.isolatedRoot, undefined)
          return { status: 'succeeded', finalText: await readFile(join(options.workspace, 'README.md'), 'utf8') }
        },
      } })
    assert.equal(result.status, 'succeeded')
    assert.equal(result.finalText, 'base\n')
    assert.equal(result.isolatedWorkspace, undefined)
  })
})

test('team executes distinct official adapters in dependency order and does not invent actual model IDs', { skip: process.platform !== 'win32' }, async () => {
  const calls = []
  const plan = teamPlan(
    workPackage('analysis', 'anthropic', 'harness-cheap', [], 'analysis'),
    workPackage('review', 'openai', 'harness-premium', ['analysis'], 'verification'),
  )
  const result = await runOfficialTeam({ plan, task: 'Analyze and review a design',
    workspace: repository, mode: 'read-only', installedIds: ['claude-code', 'codex'],
    cliModels: { analysis: 'claude-haiku-4-5' }, sandbox: sandbox(),
    runtime: {
      async readiness(id) { return { id, ready: true } },
      async runTool(options) {
        calls.push(options)
        return { status: 'succeeded', requestedModel: options.modelId,
          finalText: options.toolId === 'claude-code' ? 'analysis evidence' : 'review evidence' }
      },
    },
  })

  assert.equal(result.status, 'cli-completed')
  assert.deepEqual(calls.map(call => call.toolId), ['claude-code', 'codex'])
  assert.equal(calls[0].modelId, 'claude-haiku-4-5', 'package-level CLI binding wins')
  assert.equal(calls[1].modelId, null, 'without a CLI binding Codex uses its own default')
  assert.match(calls[1].task, /analysis evidence/, 'dependent package receives prior result')
  assert.equal(result.results[0].recommendedModel, 'harness-cheap')
  assert.equal(result.results[0].requestedCliModel, 'claude-haiku-4-5')
  assert.equal(result.results[0].actualModel, null, 'CLI request is not proof of the model used')
  assert.match(result.results[0].modelNotice, /未返回可核验的实际模型/)
  assert.equal(result.results[1].actualModel, null)
  assert.equal(result.results[1].requestedCliModel, null)
  assert.match(result.results[1].modelNotice, /默认模型/)
})

test('team CLI bindings choose package then tool names and leave other packages on CLI defaults', { skip: process.platform !== 'win32' }, async () => {
  const calls = []
  const plan = teamPlan(
    workPackage('analysis', 'anthropic', 'catalog-cheap', [], 'analysis'),
    workPackage('review', 'anthropic', 'catalog-premium', ['analysis'], 'verification'),
    workPackage('summary', 'openai', 'catalog-openai', ['review'], 'synthesis'),
  )
  const result = await runOfficialTeam({ plan, task: 'Read and review the fixture',
    workspace: repository, mode: 'read-only', installedIds: ['claude-code', 'codex'],
    cliModels: { 'claude-code': 'tool-alias', analysis: 'package-alias' }, sandbox: sandbox(),
    runtime: {
      async readiness(id) { return { id, ready: true } },
      async runTool(options) {
        calls.push(options)
        return { status: 'succeeded', finalText: 'fixture result' }
      },
    },
  })
  assert.equal(result.status, 'cli-completed')
  assert.deepEqual(calls.map(call => call.modelId), ['package-alias', 'tool-alias', null])
  assert.deepEqual(result.results.map(item => item.recommendedModel), ['catalog-cheap', 'catalog-premium', 'catalog-openai'])
  assert.deepEqual(result.results.map(item => item.requestedCliModel), ['package-alias', 'tool-alias', null])
  assert.deepEqual(result.results.map(item => item.actualModel), [null, null, null])
})

test('team retains reported-model, usage and sandbox evidence and rejects an unready execution mode', { skip: process.platform !== 'win32' }, async () => {
  const plan = teamPlan(workPackage('analysis', 'anthropic', 'catalog-model', [], 'analysis'))
  const usage = { inputTokens: 123, outputTokens: 456 }
  const result = await runOfficialTeam({ plan, task: 'Read fixture', workspace: repository, mode: 'read-only',
    installedIds: ['claude-code'], cliModels: { analysis: 'cli-alias' }, sandbox: sandbox(),
    runtime: {
      async readiness(id) { return { id, ready: true, readyModes: ['read-only'] } },
      async runTool() { return { status: 'succeeded', finalText: 'done', reportedModel: 'cli-alias',
        usage, usageIncomplete: true, reportedCostUsd: 0, source: 'verified-fixture', sandboxEnforcement: 'full' } },
    } })
  const pkg = result.results[0]
  assert.equal(result.status, 'cli-completed')
  assert.equal(pkg.recommendedModel, 'catalog-model')
  assert.equal(pkg.requestedCliModel, 'cli-alias')
  assert.equal(pkg.actualModel, 'cli-alias')
  assert.equal(pkg.reportedModel, 'cli-alias')
  assert.equal(pkg.usageIncomplete, true)
  assert.deepEqual(pkg.usage, usage)
  assert.equal(pkg.reportedCostUsd, 0)
  assert.equal(pkg.source, 'verified-fixture')
  assert.equal(pkg.sandboxEnforcement, 'full')
  const blocked = await runOfficialTeam({ plan, task: 'Read fixture', workspace: repository, mode: 'read-only',
    installedIds: ['claude-code'], sandbox: sandbox(), runtime: {
      async readiness(id) { return { id, ready: true, modes: ['read-only'], readyModes: [] } },
      async runTool() { throw new Error('an unready mode must not run') },
    } })
  assert.equal(blocked.status, 'blocked')
  assert.match(blocked.blocking[0].reason, /read-only/)
})

test('team stops after a failed CLI and never dispatches dependent work', { skip: process.platform !== 'win32' }, async () => {
  const calls = []
  const plan = teamPlan(
    workPackage('analysis', 'anthropic', 'claude-small', [], 'analysis'),
    workPackage('implementation', 'openai', 'gpt-large', ['analysis']),
  )
  const result = await runOfficialTeam({ plan, task: 'Analyze and implement',
    workspace: repository, mode: 'read-only', installedIds: ['claude-code', 'codex'],
    sandbox: sandbox(), runtime: {
      async readiness(id) { return { id, ready: true } },
      async runTool({ toolId }) { calls.push(toolId); return { status: 'failed', error: 'mock provider rejected', exitCode: 1,
        stderrTail: '', stdoutTail: 'provider rejected api_key=sk-example-private-value' } },
    },
  })
  assert.equal(result.status, 'incomplete')
  assert.deepEqual(calls, ['claude-code'])
  assert.equal(result.results[0].error, 'mock provider rejected')
  assert.match(result.results[0].outputTail, /provider rejected/)
  assert.doesNotMatch(result.results[0].outputTail, /sk-example-private-value/)
  assert.equal(result.results[0].exitCode, 1)
})

test('a later adapter exception preserves earlier charges and the editable worktree for recording and retry', async () => {
  await temporaryRepository(async ({ temporary, workspace }) => {
    const plan = teamPlan(
      workPackage('analysis', 'moonshot', 'catalog-a', [], 'analysis'),
      workPackage('implementation', 'minimax', 'catalog-b', ['analysis']),
      workPackage('review', 'moonshot', 'catalog-c', ['implementation'], 'verification'),
    )
    const calls = []
    const usage = { inputTokens: 21, outputTokens: 34 }
    const result = await runOfficialTeam({ plan, task: 'Complete the fixture', workspace,
      allowedRoot: temporary, mode: 'workspace-write', installedIds: ['kimi-code', 'minimax-code'],
      sandbox: sandbox(), runtime: {
        async readiness(id) { return { id, ready: true, readyModes: ['workspace-write'] } },
        async runTool(options) {
          calls.push(options)
          if (calls.length > 1) throw new TypeError('prompt rejected api_key=sk-private-fixture-secret')
          await writeFile(join(options.workspace, 'partial.txt'), 'prior delivered work\n')
          return { status: 'succeeded', finalText: 'first package evidence', usage, reportedCostUsd: 0.07 }
        },
      } })
    assert.deepEqual(calls.map(item => item.toolId), ['kimi-code', 'minimax-code'])
    assert.equal(result.status, 'incomplete')
    assert.equal(result.results.length, 2)
    assert.equal(result.results[0].finalText, 'first package evidence')
    assert.deepEqual(result.results[0].usage, usage)
    assert.equal(result.results[0].reportedCostUsd, 0.07)
    assert.equal(result.results[1].status, 'failed')
    assert.match(result.results[1].error, /执行器异常.*prompt rejected/)
    assert.match(result.results[1].outputTail, /prompt rejected/)
    assert.doesNotMatch(JSON.stringify(result), /sk-private-fixture-secret/)
    assert.equal(result.results[1].exitCode, null)
    assert.match(result.baseCommit, /^[0-9a-f]{40,64}$/)
    assert.equal(await readFile(join(result.workspace, 'partial.txt'), 'utf8'), 'prior delivered work\n')
    await assert.rejects(readFile(join(workspace, 'partial.txt')), { code: 'ENOENT' })

    const record = buildTeamRunRecord({ id: 'adapter-exception', createdAt: Date.now(), task: 'fixture',
      plan, execution: result, mode: 'workspace-write', workspace, billingFor: () => 'api' })
    assert.deepEqual(record.packages.map(item => item.status), ['succeeded', 'failed', 'blocked'])
    assert.equal(record.packages[0].costUsd, 0.07)
    assert.equal(record.packages[0].answer, 'first package evidence')
    assert.equal(record.packages[2].ran, false)
    assert.equal(record.isolatedWorkspace, result.workspace)
    assert.equal(record.baseCommit, result.baseCommit)
    assert.equal(spending([record]).today, 0.07)
    assert.equal(spending([record]).unknownToday, 1)
  })
})

test('an adapter abort preserves earlier results and records a cancelled package before stopping', { skip: process.platform !== 'win32' }, async () => {
  const controller = new AbortController()
  const plan = teamPlan(
    workPackage('analysis', 'anthropic', 'catalog-a', [], 'analysis'),
    workPackage('execution', 'anthropic', 'catalog-b', ['analysis']),
    workPackage('review', 'anthropic', 'catalog-c', ['execution'], 'verification'),
  )
  let calls = 0
  const result = await runOfficialTeam({ plan, task: 'Read fixture', workspace: repository,
    mode: 'read-only', installedIds: ['claude-code'], signal: controller.signal, sandbox: sandbox(), runtime: {
      async readiness(id) { return { id, ready: true, readyModes: ['read-only'] } },
      async runTool() {
        if (++calls === 1) return { status: 'succeeded', finalText: 'prior evidence', reportedCostUsd: 0 }
        controller.abort()
        throw Object.assign(new Error('stopped token=private-fixture-token'), { name: 'AbortError' })
      },
    } })
  assert.equal(calls, 2)
  assert.equal(result.status, 'cancelled')
  assert.equal(result.results[0].finalText, 'prior evidence')
  assert.equal(result.results[0].reportedCostUsd, 0)
  assert.equal(result.results[1].status, 'cancelled')
  assert.match(result.results[1].error, /已取消/)
  assert.doesNotMatch(JSON.stringify(result), /private-fixture-token/)
})

test('single-tool failures and adapter throws return scrubbed diagnostics for the ledger', async () => {
  for (const thrown of [false, true]) {
    const result = await runOfficialTask({ toolId: 'codex', task: 'Read fixture', workspace: repository,
      mode: 'read-only', sandbox: sandbox(), runtime: {
        async readiness() { return { ready: true, readyModes: ['read-only'] } },
        async runTool() {
          if (thrown) throw new Error('launch rejected password=private-fixture-password')
          return { status: 'failed', error: 'vendor rejected request', exitCode: 7,
            stderrTail: '', stdoutTail: 'request failed api_key=sk-private-fixture-key', reportedCostUsd: 0.02 }
        },
      } })
    assert.equal(result.status, 'failed')
    assert.match(result.diagnostic, thrown ? /launch rejected/ : /request failed/)
    assert.doesNotMatch(result.diagnostic, /private-fixture/)
    assert.equal(result.exitCode, thrown ? null : 7)
    const record = buildToolRunRecord({ id: 'failed-tool', createdAt: Date.now(), task: 'fixture',
      toolId: 'codex', result, billingFor: () => 'api' })
    assert.equal(record.packages[0].diagnostic, result.diagnostic)
    assert.equal(record.packages[0].exitCode ?? null, result.exitCode)
    assert.equal(record.packages[0].costUsd, thrown ? null : 0.02)
  }
})

test('adapter exceptions scrub exact inherited credential values before storing error and diagnostic', async () => {
  const previous = process.env.ANTHROPIC_AUTH_TOKEN
  const fixtureToken = 'opaque-inherited-fixture-credential'
  process.env.ANTHROPIC_AUTH_TOKEN = fixtureToken
  try {
    const result = await runOfficialTask({ toolId: 'codex', task: 'Read fixture', workspace: repository,
      mode: 'read-only', sandbox: sandbox(), runtime: {
        async readiness() { return { ready: true, readyModes: ['read-only'] } },
        async runTool() { throw new Error(`launch failed ANTHROPIC_AUTH_TOKEN=${fixtureToken}`) },
      } })
    assert.match(result.error, /launch failed.*\[redacted\]/)
    assert.match(result.diagnostic, /launch failed.*\[redacted\]/)
    assert.doesNotMatch(JSON.stringify(result), /opaque-inherited-fixture-credential/)
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN
    else process.env.ANTHROPIC_AUTH_TOKEN = previous
  }
})

test('cancellation between work packages stops dispatch without inventing completion', { skip: process.platform !== 'win32' }, async () => {
  const controller = new AbortController()
  const calls = []
  const plan = teamPlan(
    workPackage('analysis', 'anthropic', 'claude-small', [], 'analysis'),
    workPackage('implementation', 'openai', 'gpt-large', ['analysis']),
  )
  const result = await runOfficialTeam({ plan, task: 'Analyze and implement',
    workspace: repository, mode: 'read-only', installedIds: ['claude-code', 'codex'],
    sandbox: sandbox(), signal: controller.signal, runtime: {
      async readiness(id) { return { id, ready: true } },
      async runTool({ toolId }) {
        calls.push(toolId)
        controller.abort()
        return { status: 'succeeded', finalText: 'analysis only' }
      },
    },
  })
  assert.equal(result.status, 'cancelled')
  assert.deepEqual(calls, ['claude-code'])
  assert.equal(result.results.length, 1)
})

test('a CLI-reported model mismatch stops later packages and prevents integration', async () => {
  await temporaryRepository(async ({ temporary, workspace }) => {
    const calls = []
    const plan = teamPlan(
      workPackage('cheap', 'minimax', 'harness-cheap'),
      workPackage('complex', 'moonshot', 'harness-large', ['cheap']),
    )
    const result = await runOfficialTeam({ plan, task: 'Use the assigned models',
      workspace, allowedRoot: temporary, mode: 'workspace-write',
      installedIds: ['kimi-code', 'minimax-code'],
      cliModels: { cheap: 'minimax/M2', complex: 'kimi-large' }, sandbox: sandbox(),
      runtime: {
        async readiness(id) { return { id, ready: true } },
        async runTool(options) {
          calls.push(options.toolId)
          await writeFile(join(options.workspace, 'wrong-model-output.txt'), 'unreviewed\n')
          return { status: 'succeeded', finalText: 'done', requestedModel: options.modelId,
            reportedModel: { providerId: 'minimax', modelId: 'M3' } }
        },
      },
    })
    assert.equal(result.status, 'incomplete')
    assert.deepEqual(calls, ['minimax-code'])
    assert.equal(result.results[0].status, 'model-mismatch')
    assert.equal(result.results[0].requestedCliModel, 'minimax/M2')
    assert.equal(result.results[0].actualModel, 'minimax/M3')
    assert.match(result.results[0].modelNotice, /不一致/)
    await assert.rejects(readFile(join(workspace, 'wrong-model-output.txt'), 'utf8'),
      { code: 'ENOENT' }, 'an unreviewed isolated patch must not reach the source checkout')
  })
})

test('editable team uses one isolated Git worktree and integrates successful packages', async () => {
  await temporaryRepository(async ({ temporary, workspace }) => {
    const calls = []
    const plan = teamPlan(
      workPackage('cheap', 'moonshot', 'harness-cheap'),
      workPackage('complex', 'minimax', 'harness-large', ['cheap']),
    )
    const result = await runOfficialTeam({ plan, task: 'Implement two dependent packages',
      workspace, allowedRoot: temporary, mode: 'workspace-write',
      installedIds: ['kimi-code', 'minimax-code'],
      cliModels: { cheap: 'kimi-small', complex: 'minimax/M2' }, sandbox: sandbox(),
      runtime: {
        async readiness(id) { return { id, ready: true } },
        async runTool(options) {
          calls.push(options)
          assert.notEqual(options.workspace, workspace, 'CLI must run in the isolated checkout')
          assert.equal(options.mode, 'workspace-write')
          const previous = options.toolId === 'minimax-code'
            ? await readFile(join(options.workspace, 'delivery.txt'), 'utf8') : ''
          await writeFile(join(options.workspace, 'delivery.txt'), `${previous}${options.toolId}\n`)
          return { status: 'succeeded', finalText: `completed ${options.toolId}`,
            requestedModel: options.modelId,
            reportedModel: options.toolId === 'minimax-code'
              ? { providerId: 'minimax', modelId: 'M2' } : options.modelId }
        },
      },
    })
    assert.equal(result.status, 'cli-completed')
    assert.equal(result.integration.integrated, true)
    assert.deepEqual(calls.map(call => [call.toolId, call.modelId]), [
      ['kimi-code', 'kimi-small'], ['minimax-code', 'minimax/M2'],
    ])
    assert.equal(calls[0].workspace, calls[1].workspace, 'dependent work uses the same isolated checkout')
    assert.match(calls[1].task, /completed kimi-code/)
    assert.equal((await readFile(join(workspace, 'delivery.txt'), 'utf8')).replace(/\r\n/g, '\n'),
      'kimi-code\nminimax-code\n')
    assert.deepEqual(result.results.map(item => item.actualModel), ['kimi-small', 'minimax/M2'])
  })
})

test('editable team refuses a dirty source checkout before dispatch', async () => {
  await temporaryRepository(async ({ temporary, workspace }) => {
    await writeFile(join(workspace, 'README.md'), 'uncommitted user work\n')
    const plan = teamPlan(workPackage('simple', 'moonshot', 'harness-kimi'))
    let dispatched = false
    await assert.rejects(runOfficialTeam({ plan, task: 'Make an edit',
      workspace, allowedRoot: temporary, mode: 'workspace-write',
      installedIds: ['kimi-code'], sandbox: sandbox(), runtime: {
        async readiness(id) { return { id, ready: true } },
        async runTool() { dispatched = true; throw new Error('must not run') },
      },
    }), /未提交改动/)
    assert.equal(dispatched, false)
    assert.equal(await readFile(join(workspace, 'README.md'), 'utf8'), 'uncommitted user work\n')
  })
})

test('source authorization is checked before readiness or isolated storage for team and single-tool edits', async () => {
  await temporaryRepository(async ({ temporary, workspace }) => {
    const approved = join(temporary, 'approved')
    await mkdir(approved)
    const before = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: workspace, encoding: 'utf8' })
    const runtime = {
      async readiness() { throw new Error('an unauthorized source must not probe tools') },
      async runTool() { throw new Error('an unauthorized source must not run tools') },
    }
    await assert.rejects(runOfficialTeam({ plan: teamPlan(workPackage('edit', 'moonshot', 'model')),
      task: 'edit', workspace, allowedRoot: approved, mode: 'workspace-write',
      installedIds: ['kimi-code'], sandbox: sandbox(), runtime }), /会话批准的工作区范围/)
    await assert.rejects(runOfficialTask({ toolId: 'kimi-code', task: 'edit', workspace,
      allowedRoot: approved, mode: 'workspace-write', sandbox: sandbox(), runtime }), /会话批准的工作区范围/)
    assert.equal(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: workspace, encoding: 'utf8' }), before)
    await assert.rejects(realpath(await hostStorageParent(workspace)), { code: 'ENOENT' })
  })
})

test('Windows edit storage is derived from canonical source outside its approved source scope', { skip: process.platform !== 'win32' }, async () => {
  await temporaryRepository(async ({ workspace }) => {
    const source = await realpath(workspace)
    const expected = await hostStorageParent(source)
    const excludeBefore = await readFile(join(source, '.git', 'info', 'exclude'), 'utf8')
    const result = await runOfficialTask({ toolId: 'kimi-code', task: 'edit', workspace: source,
      allowedRoot: source, mode: 'workspace-write', sandbox: sandbox(), runtime: {
        async readiness() { return { ready: true, readyModes: ['workspace-write'] } },
        async runTool(options) {
          assert.ok(samePath(options.isolatedRoot, expected))
          assert.ok(samePath(dirname(options.workspace), expected))
          assert.notEqual(options.workspace, source)
          assert.equal(options.mode, 'workspace-write')
          await writeFile(join(options.workspace, 'partial.txt'), 'retained only in the isolated run\n')
          return { status: 'failed', error: 'keep fixture for retry' }
        },
      } })
    assert.equal(result.status, 'failed')
    assert.ok(samePath(dirname(result.isolatedWorkspace), expected))
    assert.match(basename(result.isolatedWorkspace), /^run-[0-9a-f-]{36}$/i)
    const sourceToStorage = relative(source, expected)
    assert.ok(sourceToStorage.startsWith('..') || isAbsolute(sourceToStorage))
    assert.equal(await readFile(join(source, '.git', 'info', 'exclude'), 'utf8'), excludeBefore)
    await assert.rejects(readFile(join(source, 'partial.txt')), { code: 'ENOENT' })
  })
})

test('workspace previews never create Host storage or Git worktrees for either mode', async () => {
  await temporaryRepository(async ({ workspace }) => {
    const storage = await hostStorageParent(workspace)
    const before = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: workspace, encoding: 'utf8' })
    for (const mode of ['read-only', 'workspace-write']) {
      assert.equal(await preflightOfficialWorkspace(workspace, mode), await realpath(workspace))
      await assert.rejects(realpath(storage), { code: 'ENOENT' })
      await assert.rejects(realpath(join(workspace, '.model-router-workspaces')), { code: 'ENOENT' })
    }
    assert.equal(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: workspace, encoding: 'utf8' }), before)
  })
})

test('Windows Host storage rejects an existing source-key junction before CLI dispatch', { skip: process.platform !== 'win32' }, async () => {
  await temporaryRepository(async ({ temporary, workspace }) => {
    const storage = await hostStorageParent(workspace)
    await mkdir(dirname(storage), { recursive: true })
    const foreign = join(temporary, 'foreign-storage')
    await mkdir(foreign)
    await symlink(foreign, storage, 'junction')
    try {
      await assert.rejects(runOfficialTask({ toolId: 'kimi-code', task: 'edit', workspace,
        allowedRoot: workspace, mode: 'workspace-write', sandbox: sandbox(), runtime: {
          async readiness() { return { ready: true, readyModes: ['workspace-write'] } },
          async runTool() { throw new Error('a redirected Host storage path must not dispatch') },
        } }), /符号链接|目录联接/)
      assert.equal(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: workspace, encoding: 'utf8' })
        .split(/\r?\n/).filter(line => line.startsWith('worktree ')).length, 1)
    } finally { await unlink(storage) }
  })
})

test('retry accepts the exact Host source parent and legacy parent but rejects lookalike registered worktrees', async () => {
  await temporaryRepository(async ({ temporary, workspace }) => {
    const plan = teamPlan(workPackage('edit', 'moonshot', 'model'))
    const common = { plan, task: 'edit', workspace, allowedRoot: temporary, mode: 'workspace-write',
      installedIds: ['kimi-code'], sandbox: sandbox() }
    const first = await runOfficialTeam({ ...common, runtime: {
      async readiness(id) { return { id, ready: true } },
      async runTool(options) {
        await writeFile(join(options.workspace, 'prior.txt'), 'first attempt\n')
        return { status: 'failed', error: 'paused fixture' }
      },
    } })
    const retry = await runOfficialTeam({ ...common, onlyIds: ['edit'],
      seedFrom: { workspace: first.workspace, baseCommit: first.baseCommit }, runtime: {
        async readiness(id) { return { id, ready: true } },
        async runTool(options) {
          assert.equal((await readFile(join(options.workspace, 'prior.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'first attempt\n')
          return { status: 'failed', error: 'keep source clean for the remaining cases' }
        },
      } })
    assert.equal(retry.status, 'incomplete')
    assert.ok(samePath(await realpath(retry.seeded.from), await realpath(first.workspace)))

    const counterfeitParent = join(temporary, 'foreign', '.model-router-workspaces', basename(workspace))
    await mkdir(counterfeitParent, { recursive: true })
    const counterfeit = join(counterfeitParent, `run-${randomUUID()}`)
    git(workspace, 'worktree', 'add', '--detach', counterfeit, 'HEAD')
    const blocked = await runOfficialTeam({ ...common, onlyIds: ['edit'],
      seedFrom: { workspace: counterfeit, baseCommit: first.baseCommit }, runtime: {
        async readiness(id) { return { id, ready: true } },
        async runTool() { throw new Error('a registered lookalike must never run') },
      } })
    assert.equal(blocked.status, 'blocked')
    assert.match(blocked.blocking[0].reason, /不是本仓库由插件创建/)

    const legacyParent = join(temporary, '.model-router-workspaces', basename(workspace))
    await mkdir(legacyParent, { recursive: true })
    const legacy = join(legacyParent, `run-${randomUUID()}`)
    git(workspace, 'worktree', 'add', '--detach', legacy, 'HEAD')
    await writeFile(join(legacy, 'legacy.txt'), 'earlier release\n')
    const resumed = await runOfficialTeam({ ...common, onlyIds: ['edit'],
      seedFrom: { workspace: legacy, baseCommit: first.baseCommit }, runtime: {
        async readiness(id) { return { id, ready: true } },
        async runTool(options) {
          assert.equal((await readFile(join(options.workspace, 'legacy.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'earlier release\n')
          return { status: 'succeeded', finalText: 'legacy retry completed' }
        },
      } })
    assert.equal(resumed.status, 'cli-completed')
    assert.ok(samePath(await realpath(resumed.seeded.from), await realpath(legacy)))
    assert.equal((await readFile(join(workspace, 'legacy.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'earlier release\n')
  })
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { executeAssignmentPlan, rerunAssignmentPackage } from '../.dsh-plugin/shared/task-executors.mjs'
import { runOfficialTask, runOfficialTeam } from '../.dsh-plugin/shared/official-team-runtime.mjs'

const repository = fileURLToPath(new URL('..', import.meta.url))
const workPackage = (id, dependsOn = []) => ({ id, name: id, objective: `Finish ${id}`, dependsOn,
  recommendedProvider: 'openai', recommendedModel: `gpt-${id}` })
const planOf = (...workPackages) => ({ team: { workPackages } })
const routeFor = item => ({ provider: item.recommendedProvider, model: item.recommendedModel, execution: 'api' })
const assignment = plan => ({ plan, task: 'Offline fixture', routes: plan.team.workPackages.map(routeFor), workspace: repository,
  spawnImpl() { throw new Error('offline fixture must not spawn a CLI') } })
const sandbox = { confine() { throw new Error('offline fixture must not launch a CLI') } }
const runtime = { async readiness() { return { id: 'codex', ready: true, readyModes: ['read-only', 'workspace-write'] } } }
const failedCheckpoint = error => error.code === 'ROUTER_CHECKPOINT_FAILED' && /disk unavailable/.test(error.message)

test('required package start checkpoint fails closed before any paid call', async () => {
  let calls = 0
  await assert.rejects(executeAssignmentPlan({ ...assignment(planOf(workPackage('first'), workPackage('second'))),
    async onCheckpointStart() { throw new Error('disk unavailable') },
    async apiFallback() { calls += 1; return { ok: true, answer: 'should not run' } },
  }), error => {
    assert.ok(failedCheckpoint(error))
    assert.equal(error.checkpointStage, 'start')
    assert.deepEqual(error.execution.packages, [])
    return true
  })
  assert.equal(calls, 0)
})

test('required result checkpoint failure retains the receipt and stops downstream paid calls', async () => {
  let calls = 0
  const usage = { inputTokens: 10, outputTokens: 7 }
  await assert.rejects(executeAssignmentPlan({ ...assignment(planOf(workPackage('first'), workPackage('second', ['first']))),
    async apiFallback() { calls += 1; return { ok: true, answer: 'paid receipt', usage } },
    async onCheckpointResult() { throw new Error('disk unavailable') },
  }), error => {
    assert.ok(failedCheckpoint(error))
    assert.equal(error.checkpointStage, 'result')
    assert.equal(error.execution.packages[0].answer, 'paid receipt')
    assert.deepEqual(error.execution.packages[0].usage, usage)
    assert.deepEqual(error.execution.ranIds, ['first'])
    return true
  })
  assert.equal(calls, 1)
})

test('required start and result checkpoints are awaited around each paid package', async () => {
  const events = []
  const result = await executeAssignmentPlan({ ...assignment(planOf(workPackage('first'), workPackage('second', ['first']))),
    async onCheckpointStart(item) { await Promise.resolve(); events.push(`start:${item.id}`) },
    async apiFallback({ route }) {
      const id = route.model.slice(4)
      assert.equal(events.at(-1), `start:${id}`)
      events.push(`paid:${id}`)
      return { ok: true, answer: id }
    },
    async onCheckpointResult(item) { await Promise.resolve(); events.push(`saved:${item.id}`) },
    async onPackage() { assert.match(events.at(-1), /^saved:/) },
  })
  assert.equal(result.status, 'completed')
  assert.deepEqual(events, ['start:first', 'paid:first', 'saved:first', 'start:second', 'paid:second', 'saved:second'])
})

test('cancelling during required start releases the unstarted receipt without dispatch', async () => {
  const controller = new AbortController()
  const receipts = []
  const result = await executeAssignmentPlan({ ...assignment(planOf(workPackage('first'))), signal: controller.signal,
    async onCheckpointStart() { controller.abort() },
    async onCheckpointResult(item) { receipts.push(item) },
    async apiFallback() { throw new Error('cancelled checkpoint must not dispatch') },
  })
  assert.equal(result.status, 'cancelled')
  assert.equal(receipts[0].notStarted, true)
  assert.equal(receipts[0].cancelled, true)
})

test('retry checkpoints exclude retained receipts and expose them in failure evidence', async () => {
  const packages = [workPackage('first'), workPackage('second', ['first'])]
  const retained = { id: 'first', ok: true, provider: 'openai', model: 'gpt-first', answer: 'retained receipt', reportedCostUsd: 0.2 }
  const starts = []
  await assert.rejects(rerunAssignmentPackage({ task: 'Retry fixture', packages, previous: [retained], packageId: 'second',
    routes: packages.map(routeFor), onCheckpointStart(item) { starts.push(item.id); throw new Error('disk unavailable') },
    async apiFallback() { throw new Error('checkpoint must stop retry') },
  }), error => {
    assert.ok(failedCheckpoint(error))
    assert.equal(error.execution.packages[0], retained)
    return true
  })
  assert.deepEqual(starts, ['second'])
})

test('single-tool checkpoint failure before dispatch keeps notStarted evidence', async () => {
  let calls = 0
  await assert.rejects(runOfficialTask({ toolId: 'codex', task: 'Offline fixture', workspace: repository, sandbox,
    runtime: { ...runtime, async runTool() { calls += 1; return { status: 'succeeded', finalText: 'paid' } } },
    async onCheckpointStart(item) { assert.equal(item.id, 'direct'); throw new Error('disk unavailable') },
  }), error => {
    assert.ok(failedCheckpoint(error))
    assert.equal(error.execution.notStarted, true)
    assert.equal(error.execution.id, 'direct')
    return true
  })
  assert.equal(calls, 0)
})

test('single-tool cancellation waits for the result checkpoint and preserves reported spend', async () => {
  const controller = new AbortController()
  const result = await runOfficialTask({ toolId: 'codex', task: 'Offline fixture', workspace: repository,
    signal: controller.signal, sandbox,
    runtime: { ...runtime, async runTool() { controller.abort(); return { status: 'cancelled', finalText: 'partial paid', reportedCostUsd: 0.07 } } },
    async onCheckpointResult(item) { await Promise.resolve(); assert.equal(item.id, 'direct'); assert.equal(item.reportedCostUsd, 0.07) },
  })
  assert.equal(result.status, 'cancelled')
  assert.equal(result.finalText, 'partial paid')
  assert.equal(result.reportedCostUsd, 0.07)
})

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
const samePath = (first, second) => process.platform === 'win32'
  ? resolve(first).toLowerCase() === resolve(second).toLowerCase() : resolve(first) === resolve(second)
async function temporaryRepository(run) {
  const temporary = await mkdtemp(join(tmpdir(), 'model-router-checkpoint-'))
  const workspace = join(temporary, 'repo')
  await mkdir(workspace)
  git(workspace, 'init', '-q')
  git(workspace, 'config', 'core.autocrlf', 'false')
  await writeFile(join(workspace, 'README.md'), 'base\n')
  git(workspace, 'add', 'README.md')
  git(workspace, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial')
  try { return await run({ temporary, workspace }) } finally {
    const source = await realpath(workspace)
    const temporaryRoot = await realpath(temporary)
    const identity = process.platform === 'win32' ? source.toLowerCase() : source
    const storage = join(await realpath(tmpdir()), '.model-router-workspaces', createHash('sha256').update(identity).digest('hex'))
    const registered = git(workspace, 'worktree', 'list', '--porcelain', '-z').split('\0')
      .filter(part => part.startsWith('worktree ')).map(part => part.slice(9))
    for (const path of registered) {
      const target = await realpath(path)
      if (samePath(target, source)) continue
      const part = relative(temporaryRoot, target)
      assert.ok(part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
        || samePath(dirname(target), storage) && /^run-[0-9a-f-]{36}$/i.test(basename(target)))
      git(workspace, 'worktree', 'remove', '--force', target)
    }
    try { await rmdir(storage) } catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error }
    const part = relative(await realpath(tmpdir()), temporaryRoot)
    assert.ok(part.startsWith('model-router-checkpoint-') && !part.includes(sep) && !isAbsolute(part))
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

for (const kind of ['team', 'task']) {
  test(`${kind} saves the isolated workspace and base commit before any paid execution`,
    { skip: kind === 'team' && process.platform !== 'win32' }, async () => {
      await temporaryRepository(async ({ temporary, workspace }) => {
        const events = []
        let location
        const common = { task: 'Offline fixture', workspace, allowedRoot: temporary, mode: 'workspace-write', sandbox,
          async onWorkspace(value) {
            await Promise.resolve()
            location = value
            assert.notEqual(value.workspace, workspace)
            assert.equal(value.isolatedWorkspace, value.workspace)
            assert.match(value.baseCommit, /^[0-9a-f]{40,64}$/)
            assert.equal(await readFile(join(value.workspace, 'README.md'), 'utf8'), 'base\n')
            events.push('workspace')
          },
          async onCheckpointStart() { assert.equal(events.at(-1), 'workspace'); events.push('started') },
          async onCheckpointResult() { events.push('saved') },
          runtime: { ...runtime, async runTool({ workspace: actual }) {
            assert.equal(events.at(-1), 'started')
            assert.equal(actual, location.workspace)
            events.push('paid')
            return { status: 'failed', finalText: 'preserved attempt', reportedCostUsd: 0.05 }
          } },
        }
        if (kind === 'team') await runOfficialTeam({ ...common, plan: planOf(workPackage('first')),
          executionEnvironment: 'cli-native', installedIds: ['codex'] })
        else await runOfficialTask({ ...common, toolId: 'codex' })
        assert.deepEqual(events, ['workspace', 'started', 'paid', 'saved'])
      })
    })

  test(`${kind} workspace checkpoint failure blocks paid calls and keeps the isolated location`,
    { skip: kind === 'team' && process.platform !== 'win32' }, async () => {
      await temporaryRepository(async ({ temporary, workspace }) => {
        let calls = 0
        let location
        const common = { task: 'Offline fixture', workspace, allowedRoot: temporary, mode: 'workspace-write', sandbox,
          async onWorkspace(value) { location = value; throw new Error('disk unavailable') },
          runtime: { ...runtime, async runTool() { calls += 1; throw new Error('must not dispatch') } },
        }
        const execution = kind === 'team'
          ? runOfficialTeam({ ...common, plan: planOf(workPackage('first')), executionEnvironment: 'cli-native', installedIds: ['codex'] })
          : runOfficialTask({ ...common, toolId: 'codex' })
        await assert.rejects(execution, error => {
          assert.ok(failedCheckpoint(error))
          assert.equal(error.checkpointStage, 'workspace')
          assert.equal(error.execution.baseCommit, location.baseCommit)
          assert.equal(kind === 'team' ? error.execution.workspace : error.execution.isolatedWorkspace, location.workspace)
          return true
        })
        assert.equal(calls, 0)
        assert.equal(await readFile(join(location.workspace, 'README.md'), 'utf8'), 'base\n')
      })
    })

  test(`${kind} result checkpoint failure keeps paid changes and prevents Git integration`,
    { skip: kind === 'team' && process.platform !== 'win32' }, async () => {
      await temporaryRepository(async ({ temporary, workspace }) => {
        let calls = 0
        let location
        const common = { task: 'Offline fixture', workspace, allowedRoot: temporary, mode: 'workspace-write', sandbox,
          async onWorkspace(value) { location = value },
          async onCheckpointResult() { throw new Error('disk unavailable') },
          runtime: { ...runtime, async runTool({ workspace: isolated }) {
            calls += 1
            await writeFile(join(isolated, 'README.md'), 'paid changes\n')
            return { status: 'succeeded', finalText: 'paid receipt', reportedCostUsd: 0.09 }
          } },
        }
        const execution = kind === 'team'
          ? runOfficialTeam({ ...common, plan: planOf(workPackage('first'), workPackage('second', ['first'])),
            executionEnvironment: 'cli-native', installedIds: ['codex'] })
          : runOfficialTask({ ...common, toolId: 'codex' })
        await assert.rejects(execution, error => {
          assert.ok(failedCheckpoint(error))
          assert.equal(error.checkpointStage, 'result')
          const receipt = kind === 'team' ? error.execution.results[0] : error.execution
          assert.equal(receipt.finalText, 'paid receipt')
          assert.equal(receipt.reportedCostUsd, 0.09)
          return true
        })
        assert.equal(calls, 1)
        assert.equal(await readFile(join(location.workspace, 'README.md'), 'utf8'), 'paid changes\n')
        assert.equal(await readFile(join(workspace, 'README.md'), 'utf8'), 'base\n')
      })
    })
}

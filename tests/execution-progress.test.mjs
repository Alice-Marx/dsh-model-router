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
const workPackage = (id, dependsOn = []) => ({ id, name: id, objective: `Finish ${id}`,
  type: 'execution', purpose: 'execution', dependsOn,
  recommendedProvider: 'openai', recommendedModel: `gpt-${id}` })
const planOf = (...workPackages) => ({ team: { workPackages } })
const routeFor = item => ({ provider: item.recommendedProvider, model: item.recommendedModel, execution: 'api' })
const apiOptions = plan => ({ plan, task: 'Complete the fixture', routes: plan.team.workPackages.map(routeFor),
  workspace: repository, spawnImpl() { throw new Error('offline fixture must never spawn a CLI') } })
const sandbox = { confine() { throw new Error('inert fixture must never launch a CLI') } }
const teamOptions = plan => ({ plan, task: 'Complete the fixture', workspace: repository,
  installedIds: ['codex'], sandbox, runtime: {
    async readiness() { return { id: 'codex', ready: true, readyModes: ['read-only', 'workspace-write'] } },
    async runTool() { throw new Error('test must supply an inert adapter') },
  } })

test('package hooks are awaited in dispatch order and publish completion before the next request', async () => {
  const plan = planOf(workPackage('first'), workPackage('second', ['first']))
  const events = []
  const controller = new AbortController()
  const result = await executeAssignmentPlan({ ...apiOptions(plan), signal: controller.signal,
    async onStage(stage) { await Promise.resolve(); events.push(stage) },
    async onPackageStart(item) {
      await Promise.resolve()
      assert.equal(item.provider, 'openai')
      assert.equal(item.model, `gpt-${item.id}`)
      events.push(`start:${item.id}`)
    },
    async apiFallback({ route, task, signal }) {
      assert.equal(signal, controller.signal)
      const id = route.model.slice(4)
      assert.equal(events.at(-1), `start:${id}`)
      if (id === 'second') assert.match(task, /first evidence/)
      events.push(`run:${id}`)
      return { ok: true, answer: `${id} evidence`, usage: { inputTokens: 3, outputTokens: 4 } }
    },
    async onPackage(item) {
      await Promise.resolve()
      assert.equal(item.answer, `${item.id} evidence`)
      events.push(`done:${item.id}`)
      return { ignored: true }
    },
  })
  assert.deepEqual(events, ['preparing', 'executing', 'start:first', 'run:first', 'done:first',
    'start:second', 'run:second', 'done:second'])
  assert.equal(result.status, 'completed')
  assert.deepEqual(result.packages[0].usage, { inputTokens: 3, outputTokens: 4 })
})

test('a package start is observable while its request is still pending', async () => {
  let release
  let entered
  const pending = new Promise(resolve => { release = resolve })
  const dispatched = new Promise(resolve => { entered = resolve })
  const events = []
  const execution = executeAssignmentPlan({ ...apiOptions(planOf(workPackage('first'))),
    onPackageStart: item => events.push(`start:${item.id}`), onPackage: item => events.push(`done:${item.id}`),
    async apiFallback() { entered(); await pending; return { ok: true, answer: 'delivered' } },
  })
  await dispatched
  assert.deepEqual(events, ['start:first'])
  release()
  await execution
  assert.deepEqual(events, ['start:first', 'done:first'])
})

test('blocked dependencies and pre-cancelled packages publish results without a start hook', async () => {
  const plan = planOf(workPackage('first'), workPackage('second', ['first']))
  for (const cancelled of [false, true]) {
    const controller = new AbortController()
    if (cancelled) controller.abort()
    const starts = []
    const done = []
    let calls = 0
    const result = await executeAssignmentPlan({ ...apiOptions(plan), signal: controller.signal,
      onPackageStart: item => starts.push(item.id), onPackage: item => done.push(item),
      async apiFallback() { calls += 1; return { ok: false, error: 'fixture rejection' } },
    })
    assert.deepEqual(starts, cancelled ? [] : ['first'])
    assert.deepEqual(done.map(item => item.id), ['first', 'second'])
    assert.equal(calls, cancelled ? 0 : 1)
    if (cancelled) assert.ok(done.every(item => item.cancelled && item.notStarted))
    else assert.equal(done[1].blocked, true)
    assert.equal(result.status, cancelled ? 'cancelled' : 'failed')
  }
})

test('bypassed routing still publishes the direct package and keeps the whole task', async () => {
  const starts = []
  const done = []
  const task = 'The exact direct task'
  const route = { provider: 'openai', model: 'gpt-direct', execution: 'api' }
  const result = await executeAssignmentPlan({ plan: { routingBypassed: true, directRoute: route },
    task, routes: [route], onPackageStart: item => starts.push(item), onPackage: item => done.push(item),
    async apiFallback(options) { assert.equal(options.task, task); return { ok: true, answer: 'direct evidence' } },
  })
  assert.deepEqual(starts.map(item => item.id), ['direct'])
  assert.equal(done[0], result.packages[0])
  assert.equal(result.status, 'completed')
})

test('cancellation while preparing credentials stops before publishing a package start', async () => {
  const controller = new AbortController()
  const starts = []
  const done = []
  const result = await executeAssignmentPlan({ ...apiOptions(planOf(workPackage('first'))),
    signal: controller.signal, async credentialsFor() { controller.abort(); return null },
    onPackageStart: item => starts.push(item), onPackage: item => done.push(item),
    async apiFallback() { throw new Error('cancelled package must never dispatch') },
  })
  assert.equal(result.status, 'cancelled')
  assert.equal(starts.length, 0)
  assert.equal(done[0].notStarted, true)
})

test('observer failures cannot lose successful evidence or prevent cancellation of later packages', async () => {
  const controller = new AbortController()
  const usage = { inputTokens: 12, outputTokens: 8 }
  const starts = []
  const done = []
  const result = await executeAssignmentPlan({
    ...apiOptions(planOf(workPackage('first'), workPackage('second', ['first']))), signal: controller.signal,
    async onStage() { throw new Error('stage observer unavailable') },
    async onPackageStart(item) { starts.push(item.id); throw new Error('start observer unavailable') },
    async apiFallback() { return { ok: true, answer: 'paid evidence', usage } },
    async onPackage(item) {
      done.push(item.id)
      if (item.id === 'first') controller.abort()
      throw new Error('completion observer unavailable')
    },
  })
  assert.equal(result.status, 'cancelled')
  assert.deepEqual(starts, ['first'])
  assert.deepEqual(done, ['first', 'second'])
  assert.equal(result.packages[0].ok, true)
  assert.equal(result.packages[0].answer, 'paid evidence')
  assert.deepEqual(result.packages[0].usage, usage)
  assert.equal(result.packages[1].notStarted, true)
})

test('retry progress excludes retained successful receipts and preserves their evidence', async () => {
  const packages = [workPackage('first'), workPackage('second', ['first'])]
  const retained = { id: 'first', name: 'first', ok: true, provider: 'openai', model: 'gpt-first',
    answer: 'retained paid evidence', usage: { inputTokens: 10 }, reportedCostUsd: 0.12 }
  const starts = []
  const done = []
  const result = await rerunAssignmentPackage({ task: 'Retry fixture', packages, previous: [retained],
    packageId: 'second', routes: packages.map(routeFor),
    onPackageStart: item => starts.push(item.id), onPackage: item => done.push(item.id),
    async apiFallback({ task }) { assert.match(task, /retained paid evidence/); return { ok: true, answer: 'retried' } },
  })
  assert.equal(result.packages[0], retained)
  assert.deepEqual(starts, ['second'])
  assert.deepEqual(done, ['second'])
})

test('team preflight failure never publishes package starts or fabricated results', async () => {
  const events = []
  const result = await runOfficialTeam({ ...teamOptions(planOf(workPackage('first'))), installedIds: [],
    onStage: stage => events.push(stage), onPackageStart: () => events.push('start'), onPackage: () => events.push('done'),
  })
  assert.equal(result.status, 'blocked')
  assert.deepEqual(events, ['preparing'])
  assert.deepEqual(result.results, [])
})

test('team package observers preserve ordering, cancellation, usage and explicit reported cost',
  { skip: process.platform !== 'win32' }, async () => {
    const plan = planOf(workPackage('first'), workPackage('second', ['first']), workPackage('third', ['second']))
    const controller = new AbortController()
    const events = []
    const usage = { inputTokens: 10, outputTokens: 6 }
    let calls = 0
    const common = teamOptions(plan)
    const result = await runOfficialTeam({ ...common, signal: controller.signal,
      async onStage(stage) { events.push(stage); throw new Error('stage observer failed') },
      async onPackageStart(item) { events.push(`start:${item.id}`); throw new Error('start observer failed') },
      async onPackage(item) { events.push(`done:${item.id}`); throw new Error('result observer failed') },
      runtime: { ...common.runtime, async runTool({ signal, task }) {
        assert.equal(signal, controller.signal)
        calls += 1
        events.push(`run:${calls}`)
        if (calls === 1) return { status: 'succeeded', finalText: 'paid evidence', usage, reportedCostUsd: 0.07 }
        assert.match(task, /paid evidence/)
        controller.abort()
        return { status: 'cancelled', finalText: 'partial second evidence', usage, reportedCostUsd: 0 }
      } },
    })
    assert.equal(result.status, 'cancelled')
    assert.equal(calls, 2)
    assert.deepEqual(events, ['preparing', 'executing', 'start:first', 'run:1', 'done:first',
      'start:second', 'run:2', 'done:second'])
    assert.equal(result.results[0].finalText, 'paid evidence')
    assert.deepEqual(result.results[0].usage, usage)
    assert.equal(result.results[0].reportedCostUsd, 0.07)
    assert.equal(result.results[1].finalText, 'partial second evidence')
    assert.equal(result.results[1].reportedCostUsd, 0)
  })

const samePath = (first, second) => process.platform === 'win32'
  ? resolve(first).toLowerCase() === resolve(second).toLowerCase() : resolve(first) === resolve(second)
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
async function temporaryRepository(run) {
  const temporary = await mkdtemp(join(tmpdir(), 'model-router-progress-'))
  const workspace = join(temporary, 'repo')
  await mkdir(workspace)
  git(workspace, 'init', '-q')
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
    assert.ok(part.startsWith('model-router-progress-') && !part.includes(sep) && !isAbsolute(part))
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

for (const cancelAt of ['last-result', 'integrating-stage']) {
  test(`editable team cancellation at ${cancelAt} keeps isolated changes and never integrates`,
    { skip: process.platform !== 'win32' }, async () => {
      await temporaryRepository(async ({ temporary, workspace }) => {
        const controller = new AbortController()
        const common = teamOptions(planOf(workPackage('first')))
        const stages = []
        const receipts = []
        const usage = { inputTokens: 3, outputTokens: 2 }
        const result = await runOfficialTeam({ ...common, workspace, allowedRoot: temporary,
          mode: 'workspace-write', executionEnvironment: 'cli-native', signal: controller.signal,
          async onStage(stage) {
            stages.push(stage)
            if (cancelAt === 'integrating-stage' && stage === 'integrating') controller.abort()
          },
          async onPackage(item) { receipts.push(item); throw new Error('receipt sink failed') },
          runtime: { ...common.runtime, async runTool({ workspace: isolated, signal }) {
            assert.equal(signal, controller.signal)
            await writeFile(join(isolated, 'delivery.txt'), 'preserved isolated evidence\n')
            if (cancelAt === 'last-result') controller.abort()
            return { status: 'succeeded', finalText: 'paid delivery', usage, reportedCostUsd: 0.08 }
          } },
        })
        assert.equal(result.status, 'cancelled')
        assert.equal(result.results[0], receipts[0])
        assert.equal(result.results[0].status, 'succeeded')
        assert.deepEqual(result.results[0].usage, usage)
        assert.equal(result.results[0].reportedCostUsd, 0.08)
        assert.match(result.baseCommit, /^[0-9a-f]{40,64}$/)
        assert.notEqual(result.workspace, workspace)
        assert.equal(await readFile(join(result.workspace, 'delivery.txt'), 'utf8'), 'preserved isolated evidence\n')
        await assert.rejects(readFile(join(workspace, 'delivery.txt')), { code: 'ENOENT' })
        assert.equal(stages.includes('integrating'), cancelAt === 'integrating-stage')
      })
    })
}

test('pre-cancelled team and single-tool tasks never probe or dispatch adapters', async () => {
  const controller = new AbortController()
  controller.abort()
  const common = teamOptions(planOf(workPackage('first')))
  const runtime = { async readiness() { throw new Error('cancelled task must not probe') },
    async runTool() { throw new Error('cancelled task must not dispatch') } }
  const single = await runOfficialTask({ toolId: 'codex', task: 'fixture', workspace: repository,
    signal: controller.signal, sandbox, runtime })
  assert.equal(single.status, 'cancelled')
  assert.equal(single.notStarted, true)
  if (process.platform === 'win32') {
    const team = await runOfficialTeam({ ...common, signal: controller.signal, runtime })
    assert.equal(team.status, 'cancelled')
    assert.deepEqual(team.results, [])
  }
})

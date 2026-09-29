import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  executableTeamPackages,
  runOfficialTeam,
  sessionWorkspace,
} from '../.dsh-plugin/shared/official-team-runtime.mjs'

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

async function temporaryRepository(run) {
  const temporary = await mkdtemp(join(tmpdir(), 'model-router-team-'))
  try {
    const workspace = join(temporary, 'repo')
    await mkdir(workspace)
    git(workspace, 'init', '-q')
    await writeFile(join(workspace, 'README.md'), 'base\n')
    git(workspace, 'add', 'README.md')
    git(workspace, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial')
    return await run({ temporary, workspace })
  } finally {
    // Only remove the fresh test directory, never a caller-supplied path.
    const parent = await realpath(tmpdir())
    const target = await realpath(temporary)
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
  assert.match(calls[1].task, /analysis evidence/, 'dependent package receives prior result')
  assert.equal(result.results[0].recommendedModel, 'harness-cheap')
  assert.equal(result.results[0].requestedCliModel, 'claude-haiku-4-5')
  assert.equal(result.results[0].actualModel, null, 'CLI request is not proof of the model used')
  assert.match(result.results[0].modelNotice, /未返回可核验的实际模型/)
  assert.equal(result.results[1].actualModel, null)
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
      async runTool({ toolId }) { calls.push(toolId); return { status: 'failed', error: 'mock provider rejected' } },
    },
  })
  assert.equal(result.status, 'incomplete')
  assert.deepEqual(calls, ['claude-code'])
  assert.equal(result.results[0].error, 'mock provider rejected')
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

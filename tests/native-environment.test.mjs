import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'router-native-test-'))
const { approvalReasonCodes, confirmationReasons, previewWorkbenchRun, startWorkbenchRun, routerRemoteServices, routerStateStore } = await import('../.dsh-plugin/index.mjs')
const { parseRunRequest } = await import('../.dsh-plugin/shared/official-tools-remote.mjs')
const { launchRequest, rerunConfirmations } = await import('../.dsh-plugin/client/insights-state.mjs')
const { officialToolExecutionCapabilities, runOfficialTool } = await import('../.dsh-plugin/shared/official-tool-executor.mjs')
const { runOfficialTeam } = await import('../.dsh-plugin/shared/official-team-runtime.mjs')
const { execFileSync } = await import('node:child_process')
const { writeFile, readFile } = await import('node:fs/promises')
const { OfficialToolsRemoteService } = await import('../.dsh-plugin/official-tools-remote-service.mjs')
const { OFFICIAL_TOOLS_REMOTE_DESCRIPTORS, OFFICIAL_TOOLS_REMOTE_NAMESPACE } = await import('../.dsh-plugin/shared/official-tools-remote.mjs')
const { gatewayClient } = await import('./helpers/typert-gateway.mjs')
const { unwrapRemote } = await import('../.dsh-plugin/client/insights-state.mjs')

test('workbench retry carries explicit native consent through the gateway and Host dispatcher', async () => {
  // A deliberately absent source makes the next preflight fail before discovery
  // or execution. Accepted consent must reach it; missing consent must pause first.
  const absent = join(process.env.DSH_HOME, 'absent-source')
  const run = { id: 'native-retry-dispatch', createdAt: Date.now(), task: 'fixture',
    kind: 'team', status: 'incomplete', executionMode: 'workspace-write', executionEnvironment: 'cli-native',
    workspace: absent, isolatedWorkspace: join(process.env.DSH_HOME, 'retained-worktree'), baseCommit: 'a'.repeat(40),
    packages: [{ id: 'failed', status: 'failed', ok: false, recommendedProvider: 'anthropic', recommendedModel: 'fixture' }] }
  await routerStateStore().appendRun(run)
  const ctx = { llm: { listProviders: () => [{ id: 'anthropic' }], listModels: async () => [{ id: 'fixture' }], resolveModelInfo: async () => ({}) } }
  const service = Object.create(OfficialToolsRemoteService.prototype)
  service.services = routerRemoteServices(ctx, { confirmUnsandboxedCli: false })
  const api = gatewayClient(OFFICIAL_TOOLS_REMOTE_DESCRIPTORS, service, OFFICIAL_TOOLS_REMOTE_NAMESPACE)
  const request = { runId: run.id, packageId: 'failed', confirmWrite: true }
  for (const confirmUnsandboxed of [undefined, false, 'true']) {
    const result = unwrapRemote(await api.rerunStep({ ...request, confirmUnsandboxed }), 'fixture failure')
    assert.equal(result.paused, true)
    assert.deepEqual(result.needsConfirmation, ['unsandboxed'])
  }
  const noWrite = unwrapRemote(await api.rerunStep({ ...request, confirmWrite: false, confirmUnsandboxed: true }), 'fixture failure')
  assert.deepEqual(noWrite.needsConfirmation, ['workspace-write'])
  const accepted = await api.rerunStep({ ...request, confirmUnsandboxed: true })
  assert.throws(() => unwrapRemote(accepted, 'fixture failure'), /原运行的工作区.*不可用/,
    'explicit consent must pass the native gate and reach workspace preflight')
})

test('native environment is explicit, editable-only, and needs approval even when legacy confirmation is disabled', () => {
  const request = { task: 'fixture', executor: 'official-team', planMode: 'team', executionMode: 'workspace-write', executionEnvironment: 'cli-native' }
  assert.equal(parseRunRequest(request).executionEnvironment, 'cli-native')
  assert.throws(() => parseRunRequest({ ...request, executionMode: 'read-only' }), /cli-native/)
  assert.throws(() => parseRunRequest({ ...request, executor: 'routed' }), /official-team/)
  assert.deepEqual(approvalReasonCodes('model_router_team_execute', { mode: 'workspace-write', executionEnvironment: 'cli-native' }, { confirmUnsandboxedCli: false }), ['workspace-write', 'unsandboxed'])
  assert.match(confirmationReasons(['unsandboxed'], { executionEnvironment: 'cli-native' })[0].zh, /当前用户权限/)
  assert.doesNotMatch(confirmationReasons(['unsandboxed'], { executionEnvironment: 'cli-native' })[0].zh, /只读仅由|设置中关闭/)
  assert.equal(launchRequest({ ...request, mode: 'team' }).executionEnvironment, 'cli-native')
  assert.deepEqual(rerunConfirmations({ run: { kind: 'team', executionMode: 'workspace-write', executionEnvironment: 'cli-native', status: 'incomplete', isolatedWorkspace: '/owned', baseCommit: 'a'.repeat(40) }, ledger: { settings: { confirmUnsandboxedCli: false } } }).map(item => item.code), ['workspace-write', 'unsandboxed'])
})

test('native Codex write capability does not broaden the default Harness capability', async () => {
  const ordinary = officialToolExecutionCapabilities().find(item => item.id === 'codex')
  if (process.platform === 'win32') {
    assert.deepEqual(ordinary.modes, ['read-only'])
    assert.ok(officialToolExecutionCapabilities({ executionEnvironment: 'cli-native' }).find(item => item.id === 'codex').modes.includes('workspace-write'))
    const result = await runOfficialTool({ toolId: 'codex', task: 'fixture', workspace: process.cwd(), executionEnvironment: 'cli-native', mode: 'read-only' })
    assert.equal(result.status, 'unsupported')
  }
})

test('native team passes the explicit environment, preserves dependencies, and integrates the final patch without requiring Harness', async () => {
  const source = mkdtempSync(join(tmpdir(), 'router-native-git-'))
  const git = (...args) => execFileSync('git', args, { cwd: source, stdio: 'pipe' })
  git('init', '-q'); await writeFile(join(source, 'README.md'), 'fixture\n'); git('add', 'README.md')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'base')
  const item = (id, dependsOn = []) => ({ id, name: id, type: 'code', purpose: 'execution', recommendedProvider: 'anthropic', recommendedModel: 'fixture', dependsOn })
  const seen = []
  const result = await runOfficialTeam({ workspace: source, allowedRoot: source, mode: 'workspace-write', executionEnvironment: 'cli-native',
    task: 'fixture', installedIds: ['claude-code'], plan: { team: { workPackages: [item('first'), item('second', ['first'])] } },
    runtime: { capabilities: [{ id: 'claude-code', supported: true, modes: ['workspace-write'] }],
      readiness: async (_id, _source, options) => { assert.equal(options.executionEnvironment, 'cli-native'); return { ready: true, readyModes: ['workspace-write'] } },
      runTool: async options => { seen.push(options); assert.equal(options.executionEnvironment, 'cli-native');
        if (seen.length === 2) assert.match(options.task, /first: first completed/)
        await writeFile(join(options.workspace, `output${seen.length}.txt`), 'done\n')
        return { status: 'succeeded', finalText: `${seen.length === 1 ? 'first' : 'second'} completed`, sandboxEnforcement: 'none' } } } })
  assert.equal(result.status, 'cli-completed', JSON.stringify(result.blocking))
  assert.equal(seen.length, 2)
  assert.ok(seen.every(entry => entry.workspace !== source))
  assert.ok(result.results.every(entry => entry.executionEnvironment === 'cli-native' && entry.sandboxEnforcement === 'none'))
  assert.equal((await readFile(join(source, 'output2.txt'), 'utf8')).trim(), 'done')
})

test('workbench native preview and start enforce both confirmations before executing any tool', async () => {
  const ctx = { llm: { listProviders: () => [{ id: 'anthropic' }], listModels: async () => [{ id: 'fixture' }], resolveModelInfo: async () => ({}) } }
  const request = { task: '读取说明并创建JSON文件', executor: 'official-team', planMode: 'team', executionMode: 'workspace-write', executionEnvironment: 'cli-native', workspace: process.cwd() }
  let invoked = 0
  const options = { preflightWorkspace: async () => process.cwd(), planOptions: { installedToolIds: ['claude-code'], readiness: [{ id: 'claude-code', ready: true, readyModes: ['workspace-write'] }], executionCapabilities: [{ id: 'claude-code', modes: ['workspace-write'] }] },
    executeOfficialTeam: async (_ctx, _config, plan, args) => {
      invoked++
      assert.equal(plan.executionEnvironment, 'cli-native')
      assert.equal(args.confirmUnsandboxed, true)
      return { status: 'cli-completed', runId: 'native-fixture' }
    } }
  const preview = await previewWorkbenchRun(ctx, { confirmUnsandboxedCli: false }, request, options)
  assert.equal(preview.executionEnvironment, 'cli-native')
  assert.deepEqual(preview.reasons.map(item => item.code), ['workspace-write', 'unsandboxed'])
  const blocked = await startWorkbenchRun(ctx, {}, { ...request, confirmedReasons: ['workspace-write'] }, options)
  assert.equal(blocked.status, 'needs-confirmation')
  assert.deepEqual(blocked.missing, ['unsandboxed'])
  assert.equal(invoked, 0)
  const result = await startWorkbenchRun(ctx, {}, { ...request, confirmedReasons: ['workspace-write', 'unsandboxed'] }, options)
  assert.equal(result.executionEnvironment, 'cli-native')
  assert.equal(invoked, 1)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPlanFromRoutes } from '../.dsh-plugin/shared/harness-plan.mjs'
import { executeAssignedTask, executeAssignmentPlan } from '../.dsh-plugin/shared/task-executors.mjs'

function fakeSpawn(handler) {
  const calls = []
  const spawnImpl = (file, args, options) => {
    calls.push({ file, args, options })
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = { end() {} }
    child.pid = 42
    child.kill = () => child.emit('close', null)
    const script = handler(file, args, options) ?? { code: 0, stdout: '' }
    if (script.hang) return child
    queueMicrotask(() => {
      if (script.spawnError) {
        const error = new Error('spawn failed')
        error.code = script.spawnError
        child.emit('error', error)
        return
      }
      if (script.stdout) child.stdout.emit('data', Buffer.from(script.stdout))
      if (script.stderr) child.stderr.emit('data', Buffer.from(script.stderr))
      child.emit('close', script.code ?? 0)
    })
    return child
  }
  return { spawnImpl, calls }
}

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'model-router-exec-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  return root
}

test('direct mode keeps the chosen model and skips comparison', () => {
  const routes = [
    { provider: 'cheap', model: 'flash', quality: 0.7 },
    { provider: 'strong', model: 'reason', quality: 0.99 },
  ]
  const plan = createPlanFromRoutes('请设计复杂系统架构，实现接口，编写测试并部署。', routes, {
    mode: 'direct', directProvider: 'cheap', directModel: 'flash',
  })
  assert.equal(plan.routingBypassed, true)
  assert.equal(plan.mode, 'direct')
  assert.equal(plan.selected.provider, 'cheap')
  assert.equal(plan.selected.model, 'flash')
  assert.match(plan.reason, /不与其他已配置模型比较/)
  assert.throws(() => createPlanFromRoutes('你好', routes, {
    mode: 'direct', directProvider: 'cheap', directModel: 'missing',
  }), /不在当前模型目录/)
})

test('claude, codex, and gemini adapters use fixed headless arguments and the configured key', async t => {
  const cwd = await workspace(t)
  const secret = 'sk-test-secret-value'
  const cases = [
    {
      route: { provider: 'anthropic', model: 'claude-sonnet', execution: 'official' },
      file: 'claude',
      expectArg: '-p',
      stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: `done ${secret}` }),
    },
    {
      route: { provider: 'openai', model: 'gpt-5.6', execution: 'auto' },
      file: 'codex',
      expectArg: 'exec',
      stdout: `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'codex ok' } })}\n${JSON.stringify({ type: 'turn.completed' })}\n`,
    },
    {
      route: { provider: 'google-ai', model: 'gemini-flash', execution: 'official' },
      file: 'gemini',
      expectArg: '--output-format',
      stdout: JSON.stringify({ response: 'gemini ok' }),
    },
  ]
  for (const item of cases) {
    const { spawnImpl, calls } = fakeSpawn((file, args) => {
      if (args[0] === '--version') return { code: 0, stdout: '1.2.3\n' }
      assert.equal(file, item.file)
      assert.ok(args.includes(item.expectArg), args.join(' '))
      return { code: 0, stdout: item.stdout }
    })
    const chunks = []
    const result = await executeAssignedTask({
      route: item.route,
      task: '请回答这个问题。',
      workspace: cwd,
      credentials: { apiKey: secret },
      spawnImpl,
      onChunk: chunk => chunks.push(chunk),
      apiFallback: () => { throw new Error('api should not run') },
    })
    assert.equal(result.ok, true)
    assert.equal(result.channel, 'official-cli')
    assert.equal(result.credentialSource, 'configured-api-key')
    assert.equal(JSON.stringify(result).includes(secret), false)
    assert.equal(calls.at(-1).options.shell, false)
    assert.equal(calls.at(-1).options.env[result.toolId === 'codex' ? 'OPENAI_API_KEY' : result.toolId === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'], secret)
    assert.equal(calls.at(-1).options.cwd, cwd)
    if (item.file === 'claude') assert.equal(chunks.join('').includes(secret), false)
  }
})

test('claude keeps its instruction positional when no CLI model id is passed', async t => {
  const cwd = await workspace(t)
  const { spawnImpl, calls } = fakeSpawn((file, args) => args[0] === '--version'
    ? { code: 0, stdout: '2.1.287\n' }
    : { code: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'OK' }) })
  const result = await executeAssignedTask({
    route: { provider: 'anthropic', model: 'Claude Sonnet (catalog name)' },
    task: '请回答 OK。',
    workspace: cwd,
    spawnImpl,
    apiFallback: () => { throw new Error('api should not run') },
  })
  assert.equal(result.ok, true)
  const args = calls.at(-1).args
  assert.equal(args.includes('--model'), false)
  const instruction = args.at(-1)
  assert.match(instruction, /standard input/)
  for (const flag of ['--tools', '--disallowedTools']) {
    assert.equal(args.includes(flag), false, `${flag} must use the = form`)
    assert.ok(args.some(arg => arg.startsWith(`${flag}=`)), flag)
  }
  // A bare variadic flag would consume the following positional value.
  assert.equal(['--tools', '--disallowedTools'].includes(args.at(-2)), false, `instruction follows ${args.at(-2)}`)
})

test('codex ignores transient reconnect errors and decides by the turn event', async t => {
  const cwd = await workspace(t)
  const lines = events => `${events.map(event => JSON.stringify(event)).join('\n')}\n`
  const retry = { type: 'error', message: 'Reconnecting... 1/5 (stream disconnected before completion)' }
  const run = stdout => {
    const { spawnImpl } = fakeSpawn((file, args) => args[0] === '--version' ? { code: 0, stdout: 'codex-cli 0.160.0\n' } : { code: 0, stdout })
    return executeAssignedTask({
      route: { provider: 'openai', model: 'gpt-5' },
      task: '请回答 OK。',
      workspace: cwd,
      spawnImpl,
      apiFallback: async () => ({ ok: true, answer: 'api answer' }),
    })
  }
  const recovered = await run(lines([
    { type: 'thread.started', thread_id: 't' }, { type: 'turn.started' }, retry,
    { type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'OK' } },
    { type: 'turn.completed', usage: {} },
  ]))
  assert.equal(recovered.channel, 'official-cli')
  assert.equal(recovered.answer, 'OK')
  assert.equal(recovered.fallback, null)

  const failed = await run(lines([
    { type: 'turn.started' }, retry,
    { type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'partial' } },
    { type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized' } },
  ]))
  assert.equal(failed.channel, 'harness-llm')
  assert.equal(failed.answer, 'api answer')
  assert.match(failed.fallback.reason, /Codex 未返回完整成功终态和回答/)
})

test('a missing or failed official tool falls back to the model API', async t => {
  const cwd = await workspace(t)
  const missing = fakeSpawn(() => ({ spawnError: 'ENOENT' }))
  let fallbacks = 0
  const missed = await executeAssignedTask({
    route: { provider: 'anthropic', model: 'claude-sonnet', execution: 'official' },
    task: '请审阅方案。',
    workspace: cwd,
    spawnImpl: missing.spawnImpl,
    apiFallback: async () => { fallbacks += 1; return { ok: true, answer: 'api answer' } },
  })
  assert.equal(missed.channel, 'harness-llm')
  assert.equal(missed.answer, 'api answer')
  assert.match(missed.fallback.reason, /未安装或无法启动/)
  assert.equal(fallbacks, 1)

  const failed = fakeSpawn((file, args) => args[0] === '--version' ? { code: 0, stdout: '1.0.0\n' } : { code: 2, stderr: 'boom' })
  const broke = await executeAssignedTask({
    route: { provider: 'openai', model: 'gpt', execution: 'auto' },
    task: '请审阅方案。',
    workspace: cwd,
    spawnImpl: failed.spawnImpl,
    apiFallback: async () => ({ ok: true, answer: 'after failure' }),
  })
  assert.equal(broke.ok, true)
  assert.equal(broke.channel, 'harness-llm')
  assert.match(broke.fallback.reason, /执行失败/)

  const { spawnImpl, calls } = fakeSpawn(() => { throw new Error('must not spawn') })
  const apiOnly = await executeAssignedTask({
    route: { provider: 'anthropic', model: 'claude-sonnet', execution: 'api' },
    task: '请审阅方案。',
    workspace: cwd,
    spawnImpl,
    apiFallback: async () => ({ ok: true, answer: 'api only' }),
  })
  assert.equal(apiOnly.answer, 'api only')
  assert.equal(apiOnly.fallback.reason.includes('模型目录 API'), true)
  assert.equal(calls.length, 0)

  const deepseek = await executeAssignedTask({
    route: { provider: 'deepseek', model: 'deepseek-v4' },
    task: '请提取关键词。',
    workspace: cwd,
    spawnImpl,
    apiFallback: async () => ({ ok: true, answer: 'deepseek api' }),
  })
  assert.equal(deepseek.answer, 'deepseek api')
  assert.match(deepseek.fallback.reason, /没有官方代理工具/)
})

test('official CLI timeout falls back and a dependency failure does not run later packages', async t => {
  const cwd = await workspace(t)
  const hanging = fakeSpawn((file, args) => args[0] === '--version'
    ? { code: 0, stdout: '1.0.0\n' }
    : { hang: true })
  const timed = await executeAssignedTask({
    route: { provider: 'gemini', model: 'gemini-flash', execution: 'official' },
    task: '请总结。',
    workspace: cwd,
    timeoutMs: 1_000,
    spawnImpl: hanging.spawnImpl,
    apiFallback: async () => ({ ok: true, answer: 'timed fallback' }),
  })
  assert.equal(timed.timedOut, true)
  assert.equal(timed.answer, 'timed fallback')

  const plan = {
    routingBypassed: false,
    team: { workPackages: [
      { id: 'analysis', name: '分析', objective: '提取约束', dependsOn: [], recommendedProvider: 'deepseek', recommendedModel: 'v4' },
      { id: 'execution-1', name: '实现', objective: '写代码', dependsOn: ['analysis'], recommendedProvider: 'openai', recommendedModel: 'gpt' },
    ] },
  }
  let spawns = 0
  const aggregate = await executeAssignmentPlan({
    plan,
    task: '请完成分析和实现。',
    routes: [
      { provider: 'deepseek', model: 'v4', execution: 'api' },
      { provider: 'openai', model: 'gpt', execution: 'official' },
    ],
    workspace: cwd,
    spawnImpl: () => { spawns += 1; throw new Error('must not spawn') },
    apiFallback: async ({ route }) => route.provider === 'deepseek'
      ? { ok: false, error: 'upstream' }
      : { ok: true, answer: 'should not run' },
  })
  assert.equal(aggregate.status, 'failed')
  assert.equal(aggregate.packages[1].error.includes('依赖未完成'), true)
  assert.equal(spawns, 0)
  assert.match(aggregate.aggregate, /分析/)
})


// 0.13.3 regression: a CLI that writes nothing must be reported as such, not as an incomplete answer.
test('an official CLI that exits with no output at all reports the exit code and empty output', async t => {
  const cwd = await workspace(t)
  const run = (code, stdout, stderr = '') => {
    const { spawnImpl } = fakeSpawn((file, args) => args[0] === '--version' ? { code: 0, stdout: 'codex-cli 0.157.1\n' } : { code, stdout, stderr })
    return executeAssignedTask({
      route: { provider: 'openai', model: 'gpt-5' }, task: '请回答 OK。', workspace: cwd, spawnImpl,
      apiFallback: async () => ({ ok: true, answer: 'api answer' }),
    })
  }
  const silent = await run(0, '\r\n')
  assert.equal(silent.channel, 'harness-llm')
  assert.match(silent.fallback.reason, /^Codex 退出码 0，无任何输出（stdout 与 stderr 均为空）。/)
  const withStderr = await run(0, '', 'boom\n')
  assert.doesNotMatch(withStderr.fallback.reason, /无任何输出/)
})

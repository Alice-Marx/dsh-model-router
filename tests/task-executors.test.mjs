import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve, sep } from 'node:path'
import { createPlanFromRoutes } from '../.dsh-plugin/shared/harness-plan.mjs'
import { adapterForToolId, executeAssignedTask, executeAssignmentPlan, resolvePortableToolLaunch, usageFromOutput, usageFromEvents } from '../.dsh-plugin/shared/task-executors.mjs'

test('vendor cost evidence preserves explicit zero, refuses missing or partial totals and accepts only a single reported Claude model', () => {
  const result = { usage: { input_tokens: 1, output_tokens: 2 }, total_cost_usd: 0, modelUsage: { 'claude-reported': {} } }
  assert.equal(usageFromOutput('claude-json', JSON.stringify(result)).reportedCostUsd, 0)
  assert.equal(usageFromOutput('claude-json', JSON.stringify(result)).reportedModel, 'claude-reported')
    assert.equal(usageFromOutput('claude-json', JSON.stringify({ ...result, modelUsage: { 'claude-reported[1M]': {} } })).reportedModel, 'claude-reported[1M]')
    assert.equal(usageFromOutput('claude-json', JSON.stringify({ ...result, modelUsage: { a: {}, 'invalid name': {} } })).reportedModel, undefined)
  assert.equal(usageFromOutput('claude-json', JSON.stringify({ ...result, total_cost_usd: null })).reportedCostUsd, undefined)
  assert.equal(usageFromOutput('claude-json', JSON.stringify({ ...result, modelUsage: { a: {}, b: {} } })).reportedModel, undefined)
  assert.equal(usageFromEvents('grok-end', { usage: {}, total_cost_usd: 0 }).reportedCostUsd, 0)
  assert.equal(usageFromEvents('grok-end', { usage: {}, total_cost_usd: null }).reportedCostUsd, undefined)
  assert.equal(usageFromEvents('mimo-steps', [{ tokens: {}, cost: 0 }]).reportedCostUsd, 0)
  assert.equal(usageFromEvents('mimo-steps', [{ tokens: {}, cost: 0.1 }, { tokens: {} }]).reportedCostUsd, undefined)
})
import { officialToolEntrySelection } from '../.dsh-plugin/shared/official-tool-executor.mjs'
import { createNpmAttestor } from '../.dsh-plugin/shared/npm-attestation.mjs'

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

const fakePortableLaunch = async adapter => ({ file: adapter.executable, args: [] })

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'model-router-exec-'))
  t.after(async () => {
    if (resolve(root).startsWith(`${resolve(tmpdir())}${sep}`)) await rm(root, { recursive: true, force: true })
  })
  return root
}

const geminiManifest = version => JSON.stringify({ name: '@google/gemini-cli', version, bin: { gemini: './dist/index.js' } })

function geminiAttestor(versions) {
  const tarEntry = (name, source) => {
    const body = Buffer.from(source)
    const header = Buffer.alloc(512)
    header.write(`package/${name}`, 0, 100)
    header.write('0000644\0', 100)
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124)
    header.write('        ', 148)
    header.write('0', 156)
    header.write('ustar\0', 257)
    let sum = 0
    for (const byte of header) sum += byte
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
    return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)])
  }
  const packages = Object.fromEntries(Object.entries(versions).map(([version, source]) => {
    const tgz = gzipSync(Buffer.concat([tarEntry('package.json', geminiManifest(version)), tarEntry('dist/index.js', source), Buffer.alloc(1024)]))
    return [version, { tgz, integrity: `sha512-${createHash('sha512').update(tgz).digest('base64')}` }]
  }))
  return createNpmAttestor({ persist: false, npmCacheDirectory: async () => null, fetchImpl: async raw => {
    const url = new URL(raw)
    const version = url.pathname.split('/').at(-1).replace(/\.tgz$/, '')
    const pkg = packages[version]
    if (!pkg) return { ok: false, status: 404 }
    return url.pathname.endsWith('.tgz')
      ? { ok: true, body: Readable.toWeb(Readable.from([pkg.tgz])) }
      : { ok: true, json: async () => ({ name: '@google/gemini-cli', version,
        dist: { integrity: pkg.integrity, tarball: `https://registry.npmjs.org/@google/gemini-cli/-/${version}.tgz` } }) }
  } })
}

async function geminiPackage(modules, version, entrySource = 'fixture') {
  const packageRoot = join(modules, '@google', 'gemini-cli')
  await mkdir(join(packageRoot, 'dist'), { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), geminiManifest(version))
  await writeFile(join(packageRoot, 'dist', 'index.js'), entrySource)
  return await realpath(join(packageRoot, 'dist', 'index.js'))
}

test('Gemini headless launch selects npm or pnpm package bins and never a shared command shim', async t => {
  const cwd = await workspace(t)
  const root = await workspace(t)
  const prefix = join(root, 'AI tools with spaces')
  const npmEntry = await geminiPackage(process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules'), '1.0.0')
  const pnpmModules = join(prefix, '.pnpm', 'global', '5', 'node_modules')
  const pnpmEntry = await geminiPackage(join(pnpmModules, '.pnpm', '@google+gemini-cli@2.0.0', 'node_modules'), '2.0.0')
  await mkdir(join(pnpmModules, '@google'), { recursive: true })
  await symlink(resolve(pnpmEntry, '..', '..'), join(pnpmModules, '@google', 'gemini-cli'), process.platform === 'win32' ? 'junction' : 'dir')
  const attestor = geminiAttestor({ '1.0.0': 'fixture', '2.0.0': 'fixture' })
  // A shim with the same name exists beside both stores, and must never be used.
  await writeFile(join(prefix, 'gemini.cmd'), 'this shim must not execute')
  const beforePath = process.env.PATH
  process.env.PATH = [prefix, beforePath].filter(Boolean).join(delimiter)
  t.after(() => { if (beforePath === undefined) delete process.env.PATH; else process.env.PATH = beforePath })
  for (const [method, entry] of [['npm', npmEntry], ['pnpm', pnpmEntry]]) {
    const preferences = { installDir: prefix, methods: { gemini: method }, scriptUrls: {}, allowScriptInstall: true }
    const selection = officialToolEntrySelection('gemini', { preferences })
    const { spawnImpl, calls } = fakeSpawn((file, args) => {
      assert.equal(file, process.execPath)
      assert.equal(args[0], entry)
      if (args[1] === '--version') return { code: 0, stdout: '1.0.0\n' }
      assert.ok(args.includes('-p'))
      assert.deepEqual(args.slice(-2), ['-m', 'gemini-test'])
      return { code: 0, stdout: JSON.stringify({ response: method }) }
    })
    const result = await executeAssignedTask({
      route: { provider: 'google-ai', model: 'gemini-test', cliModel: 'gemini-test', execution: 'official' }, task: '回答问题', workspace: cwd, spawnImpl,
      resolvePortableLaunch: (adapter, workspace) => resolvePortableToolLaunch(adapter, workspace, { selection,
        attestor, findNode: async (directory, minimum) => { assert.deepEqual(minimum, [20, 0, 0]); return process.execPath } }),
      apiFallback: () => { throw new Error('selected Gemini fixture should run') },
    })
    assert.equal(result.ok, true)
    assert.equal(result.answer, method)
    assert.equal(calls.length, 2)
    assert.equal(calls.at(-1).options.shell, false)
  }
})

test('a missing selected Gemini copy falls back without spawning another PATH installation', async t => {
  const cwd = await workspace(t)
  const root = await workspace(t)
  await geminiPackage(join(root, 'other', 'node_modules'), '99.0.0')
  const selection = officialToolEntrySelection('gemini', { preferences: {
    installDir: join(root, 'missing'), methods: { gemini: 'npm' }, scriptUrls: {}, allowScriptInstall: true,
  } })
  const result = await executeAssignedTask({
    route: { provider: 'google', model: 'gemini-test', execution: 'official' }, task: '回答问题', workspace: cwd,
    spawnImpl: () => { throw new Error('a missing selected package cannot spawn') },
    resolvePortableLaunch: (adapter, workspace) => resolvePortableToolLaunch(adapter, workspace, { selection,
      findNode: async () => { throw new Error('do not look for Node when the selected package is absent') } }),
    apiFallback: async () => ({ ok: true, answer: 'api fallback' }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.channel, 'harness-llm')
  assert.match(result.fallback.reason, /所选安装目录.*gemini.*入口/)
})

test('a real Node child runs a Gemini package bin with spaces and stdin without a Windows shell', async t => {
  const cwd = await workspace(t)
  const root = await workspace(t)
  const prefix = join(root, 'AI tools with spaces')
  const source = `
    if (process.argv.includes('--version')) { process.stdout.write('1.0.0\\n') }
    else { let task = ''; process.stdin.on('data', chunk => { task += chunk }); process.stdin.on('end', () => {
      process.stdout.write(JSON.stringify({ response: task, args: process.argv.slice(2) }));
    }) }
  `
  const entry = await geminiPackage(process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules'), '1.0.0', source)
  const selection = officialToolEntrySelection('gemini', { preferences: {
    installDir: prefix, methods: { gemini: 'npm' }, scriptUrls: {}, allowScriptInstall: true,
  } })
  const launch = await resolvePortableToolLaunch(adapterForToolId('gemini'), cwd, { selection,
    attestor: geminiAttestor({ '1.0.0': source }), findNode: async () => process.execPath })
  assert.deepEqual(launch.args, [entry])
  const result = await executeAssignedTask({
    route: { provider: 'google-ai', model: 'gemini-test', execution: 'official' }, task: '中文 fixture prompt', workspace: cwd,
    resolvePortableLaunch: async () => launch, apiFallback: () => { throw new Error('fixture should execute without a shell') },
  })
  assert.equal(result.ok, true)
  assert.equal(result.answer, '中文 fixture prompt')
  assert.equal(result.version, '1.0.0')
})

test('Gemini refuses tampered or unattested package code before starting a child', async t => {
  const cwd = await workspace(t)
  const prefix = await workspace(t)
  const modules = process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules')
  const entry = await geminiPackage(modules, '1.0.0', 'official fixture code')
  const selection = officialToolEntrySelection('gemini', { preferences: {
    installDir: prefix, methods: { gemini: 'npm' }, scriptUrls: {}, allowScriptInstall: true,
  } })
  const cases = [
    { source: 'tampered fixture code', attestor: geminiAttestor({ '1.0.0': 'official fixture code' }), error: /发行文件不符/ },
    { source: 'official fixture code', attestor: geminiAttestor({}), error: /404/ },
    { source: 'official fixture code', attestor: createNpmAttestor({ persist: false, npmCacheDirectory: async () => null,
      fetchImpl: async () => { throw new Error('registry unavailable') } }), error: /registry unavailable/ },
  ]
  for (const item of cases) {
    await writeFile(entry, item.source)
    let nodeLookups = 0
    let spawns = 0
    const result = await executeAssignedTask({
      route: { provider: 'google-ai', model: 'gemini-test', execution: 'official' }, task: '回答问题', workspace: cwd,
      spawnImpl: () => { spawns += 1; throw new Error('unattested code must not start') },
      resolvePortableLaunch: (adapter, workspace) => resolvePortableToolLaunch(adapter, workspace, { selection,
        attestor: item.attestor, findNode: async () => { nodeLookups += 1; return process.execPath } }),
      apiFallback: async () => ({ ok: true, answer: 'api fallback' }),
    })
    assert.equal(result.channel, 'harness-llm')
    assert.match(result.fallback.reason, /npm 摘要核验/)
    assert.match(result.fallback.reason, item.error)
    assert.equal(nodeLookups, 0)
    assert.equal(spawns, 0)
  }
})

test('Gemini refuses package links outside the selected npm or pnpm tree before attestation', async t => {
  const cwd = await workspace(t)
  const root = await workspace(t)
  const outsideEntry = await geminiPackage(join(root, 'outside'), '1.0.0')
  for (const method of ['npm', 'pnpm']) {
    const prefix = join(root, method)
    const modules = method === 'pnpm' ? join(prefix, '.pnpm', 'global', '5', 'node_modules')
      : process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules')
    await mkdir(join(modules, '@google'), { recursive: true })
    await symlink(resolve(outsideEntry, '..', '..'), join(modules, '@google', 'gemini-cli'), process.platform === 'win32' ? 'junction' : 'dir')
    const selection = officialToolEntrySelection('gemini', { preferences: {
      installDir: prefix, methods: { gemini: method }, scriptUrls: {}, allowScriptInstall: true,
    } })
    const launch = await resolvePortableToolLaunch(adapterForToolId('gemini'), cwd, { selection,
      attestor: { matchesPackage() { throw new Error('escaped package must fail before attestation') } },
      findNode: async () => { throw new Error('escaped package must not look up Node') },
    })
    assert.equal(launch.file, undefined)
    assert.match(launch.reason, /离开了所选安装目录的包存储树/)
  }
})

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
      resolvePortableLaunch: fakePortableLaunch,
      onChunk: chunk => chunks.push(chunk),
      apiFallback: () => { throw new Error('api should not run') },
    })
    assert.equal(result.ok, true)
    assert.equal(result.channel, 'official-cli')
    assert.equal(result.recommendedModel, item.route.model)
    assert.equal(result.requestedCliModel, null, 'catalog IDs must not override the CLI default')
    assert.equal(result.actualModel, null, 'a routing recommendation is not actual-model evidence')
    assert.equal(calls.at(-1).args.includes('--model'), false)
    assert.equal(calls.at(-1).args.includes('-m'), false)
    assert.equal(result.credentialSource, 'configured-api-key')
    assert.equal(JSON.stringify(result).includes(secret), false)
    assert.equal(calls.at(-1).options.shell, false)
    assert.equal(calls.at(-1).options.env[result.toolId === 'codex' ? 'OPENAI_API_KEY' : result.toolId === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'], secret)
    assert.equal(calls.at(-1).options.cwd, cwd)
    if (item.file === 'claude') assert.equal(chunks.join('').includes(secret), false)
  }
})

test('portable CLIs receive only explicitly bound CLI model names', async t => {
  const cwd = await workspace(t)
  const cases = [
    { provider: 'anthropic', cliModel: 'sonnet', flag: '--model',
      stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done' }) },
    { provider: 'openai', cliModel: 'gpt-cli-alias', flag: '--model',
      stdout: '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n{"type":"turn.completed"}\n' },
    { provider: 'google-ai', cliModel: 'gemini-cli-alias', flag: '-m',
      stdout: JSON.stringify({ response: 'done' }) },
  ]
  for (const item of cases) {
    const { spawnImpl, calls } = fakeSpawn((file, args) => args[0] === '--version'
      ? { code: 0, stdout: '1.2.3\n' } : { code: 0, stdout: item.stdout })
    const result = await executeAssignedTask({
      route: { provider: item.provider, model: 'catalog-only-id', cliModel: item.cliModel },
      task: 'Read the fixture', workspace: cwd, spawnImpl, resolvePortableLaunch: fakePortableLaunch,
      apiFallback: () => { throw new Error('API must not run') },
    })
    const args = calls.at(-1).args
    assert.equal(args[args.indexOf(item.flag) + 1], item.cliModel)
    assert.equal(args.includes('catalog-only-id'), false)
    assert.equal(result.model, 'catalog-only-id')
    assert.equal(result.requestedCliModel, item.cliModel)
    assert.equal(result.actualModel, null)
  }
})

test('invalid explicit CLI bindings fail before a process or API request', async t => {
  const cwd = await workspace(t)
  for (const cliModel of ['alias; echo unsafe', ' alias', {}, 42]) {
    await assert.rejects(executeAssignedTask({
      route: { provider: 'anthropic', model: 'catalog-id', cliModel },
      task: 'Read the fixture', workspace: cwd,
      runVerified: () => { throw new Error('verified runner must not run') },
      spawnImpl: () => { throw new Error('process must not start') },
      apiFallback: () => { throw new Error('API must not run') },
    }), /cliModel/)
  }
  for (const provider of ['minimax', 'mimo']) {
    await assert.rejects(executeAssignedTask({
      route: { provider, model: 'catalog-id', cliModel: 'unqualified-model' },
      task: 'Read the fixture', workspace: cwd,
      runVerified: () => { throw new Error('verified runner must not run') },
    }), /provider\/model/)
  }
})

test('verified CLI success retains usage, reported cost and model evidence without assigning billing', async t => {
  const cwd = await workspace(t)
  const usage = { inputTokens: 139, outputTokens: 262, cacheReadTokens: 0, cacheWriteTokens: 0 }
  for (const reportedCostUsd of [0, 0.25]) {
    const result = await executeAssignedTask({
      route: { provider: 'minimax', model: 'catalog-only-id', cliModel: 'minimax/cli-alias' },
      task: 'Read the fixture', workspace: cwd,
      spawnImpl: () => { throw new Error('portable process must not start') },
      apiFallback: () => { throw new Error('API must not run') },
      runVerified: async options => {
        assert.equal(options.modelId, 'minimax/cli-alias')
        return { status: 'succeeded', finalText: 'done', requestedModel: options.modelId,
          reportedModel: { providerId: 'minimax', modelId: 'cli-alias' },
          modelNotice: 'vendor supplied identity', usage, reportedCostUsd, usageIncomplete: true,
          source: 'verified-fixture', sandboxEnforcement: 'full' }
      },
    })
    assert.deepEqual(result.usage, usage)
    assert.equal(result.reportedCostUsd, reportedCostUsd, 'reported zero is still cost evidence')
    assert.equal(result.usageIncomplete, true)
    assert.equal(result.recommendedModel, 'catalog-only-id')
    assert.equal(result.requestedCliModel, 'minimax/cli-alias')
    assert.deepEqual(result.reportedModel, { providerId: 'minimax', modelId: 'cli-alias' })
    assert.equal(result.actualModel, 'minimax/cli-alias')
    assert.equal(result.modelNotice, 'vendor supplied identity')
    assert.equal(result.source, 'verified-fixture')
    assert.equal(result.sandboxEnforcement, 'full')
    assert.equal(Object.hasOwn(result, 'billing'), false)
    assert.equal(Object.hasOwn(result, 'costUsd'), false)
  }
  const unknown = await executeAssignedTask({
    route: { provider: 'anthropic', model: 'catalog-only-id' },
    task: 'Read the fixture', workspace: cwd,
    runVerified: async options => {
      assert.equal(options.modelId, null)
      return { status: 'succeeded', finalText: 'done' }
    },
  })
  assert.equal(unknown.requestedCliModel, null)
  assert.equal(unknown.actualModel, null)
  assert.equal(Object.hasOwn(unknown, 'usage'), false)
  assert.equal(Object.hasOwn(unknown, 'reportedCostUsd'), false)
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
    resolvePortableLaunch: fakePortableLaunch,
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

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { OFFICIAL_TOOLS, installMethodsFor, getOfficialTool } from '../.dsh-plugin/shared/official-tool-registry.mjs'
import { parseInstallPreferences } from '../.dsh-plugin/shared/tool-install-preferences.mjs'
import { installSummaryMatchesSettings, mutateToolInstallSettings } from '../.dsh-plugin/client/tool-install-state.mjs'

const require = createRequire(import.meta.url)
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// Execute the installed SDK's actual controllers. Only the transport and
// snapshot-store infrastructure are fixtures; queue/revision/recovery/mirror
// behavior is the unmodified SDK implementation, including synchronous ACKs.
async function sdkSettings() {
  const source = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-settings/client'), 'utf8')
  const classSource = name => {
    const start = source.indexOf('var ' + name + ' = class {')
    const end = source.indexOf('\n\t\t};', start)
    assert.ok(start >= 0 && end > start, 'installed SDK class must be present: ' + name)
    return source.slice(start, end + '\n\t\t};'.length)
  }
  const createSnapshotStore = initial => {
    let snapshot = initial
    const listeners = new Set()
    const store = { getSnapshot: () => snapshot,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      set(next) { snapshot = next; for (const listener of listeners) listener() },
      update(update) { const next = structuredClone(snapshot); update(next); store.set(next) },
    }
    return store
  }
  const classes = new Function('_deepseek_ai_dsh_client_store',
    classSource('ConfigFormController') + '\n' + classSource('SettingsDescribeMirror') + '\nreturn { ConfigFormController, SettingsDescribeMirror }')({ createSnapshotStore })
  let view = { ns: 'model-router', revision: 1, base: {}, user: {}, value: {
    toolInstallDir: '', toolNpmRegistry: 'https://registry.npmjs.org/',
    toolInstallMethodsJson: '{}', toolScriptUrlsJson: '{}', toolAllowScriptInstall: true,
  } }
  const writes = []
  const ctx = { remote: { settings: {
    describe: async () => ({ ok: true, value: { writable: true, namespaces: [view] } }),
    mutate(namespace, operations, revision) { const gate = deferred(); writes.push({ namespace, operations, revision, gate }); return gate.promise },
  } } }
  const mirror = new classes.SettingsDescribeMirror(ctx)
  await mirror.load()
  const scope = new classes.ConfigFormController(ctx, { namespace: view.ns, decode: value => value }, mirror, 'host')
  return { scope, writes,
    accept(index) {
      const write = writes[index]
      assert.equal(write.revision, view.revision, 'real SDK preserves the revision fence')
      view = { ...view, revision: view.revision + 1,
        value: { ...view.value, ...Object.fromEntries(write.operations.map(operation => [operation.path[0], operation.value])) } }
      write.gate.resolve({ ok: true, value: view })
    },
    refuse(index) { writes[index].gate.resolve({ ok: false, error: { message: 'revision conflict' } }) },
  }
}

const bundlePromises = new Map()
async function cardHarness(props, { entry = '../.dsh-plugin/client/router-main.jsx', component = 'OfficialToolsCard' } = {}) {
  const frames = new Map()
  let active, tree, effects = []
  const react = {
    Fragment: Symbol('Fragment'),
    createElement(type, input, ...children) { return { type, props: { ...input, children: children.length === 1 ? children[0] : children } } },
    useState(initial) { const frame = active, index = frame.cursor++; if (!Object.hasOwn(frame.slots, index)) frame.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [frame.slots[index], next => { frame.slots[index] = typeof next === 'function' ? next(frame.slots[index]) : next }] },
    useRef(initial) { const index = active.cursor++; return active.slots[index] ??= { current: initial } },
    useEffect(callback, deps) { const frame = active, index = frame.cursor++, previous = frame.slots[index];
      if (!previous || !deps || deps.some((value, position) => !Object.is(value, previous.deps?.[position]))) effects.push(() => { previous?.cleanup?.(); frame.slots[index] = { deps, cleanup: callback() } }) },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps) },
    useMemo(factory, deps) { const index = active.cursor++, previous = active.slots[index];
      if (!previous || deps.some((value, position) => !Object.is(value, previous.deps?.[position]))) active.slots[index] = { deps, value: factory() }; return active.slots[index].value },
  }
  if (!bundlePromises.has(entry)) bundlePromises.set(entry, build({ entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], loader: { '.css': 'text' }, logLevel: 'silent' }).then(result => result.outputFiles[0].text))
  const module = { exports: {} }
  new Function('require', 'module', 'exports', await bundlePromises.get(entry))(name => name === 'react' ? react : require(name), module, module.exports)
  function resolve(node, path) {
    if (Array.isArray(node)) return node.map((child, index) => resolve(child, path + '.' + index))
    if (!node || typeof node !== 'object') return node
    if (typeof node.type === 'function') {
      const id = path + ':' + node.type.name + ':' + (node.props.key ?? '')
      const frame = frames.get(id) ?? { slots: [], cursor: 0 }
      frames.set(id, frame); frame.cursor = 0
      const previous = active; active = frame
      const output = node.type(node.props); active = previous
      return resolve(output, path + '.component')
    }
    return { ...node, props: { ...node.props, children: resolve(node.props.children, path + '.children') } }
  }
  const all = (node, result = []) => { if (Array.isArray(node)) node.forEach(child => all(child, result));
    else if (node && typeof node === 'object') { result.push(node); all(node.props?.children, result) } return result }
  const content = node => Array.isArray(node) ? node.map(content).join(' ') : node && typeof node === 'object' ? content(node.props.children) : node == null || node === false ? '' : String(node)
  const harness = {
    render() { effects = []; tree = resolve(react.createElement(module.exports[component], props), 'root'); effects.forEach(effect => effect()); return harness },
    update(next) { Object.assign(props, next); return this.render() },
    row(id) { const row = all(tree).find(node => node.props.className === 'mr-tool' && all(node).some(child => child.props.className === 'mr-route-provider' && content(child).trim().endsWith(id))); assert.ok(row); return all(row) },
    select(id) { return this.row(id).find(node => node.type === 'select').props },
    install(id) { return this.row(id).find(node => node.type === 'button').props },
    uninstall(id) { return this.row(id).find(node => node.type === 'button' && content(node).trim() === '一键卸载').props },
    retry() { return all(tree).find(node => node.type === 'button' && content(node).trim() === '刷新安装命令').props },
    button(label) { const button = all(tree).find(node => node.type === 'button' && content(node).trim() === label); assert.ok(button); return button.props },
    input(id) { const input = all(tree).find(node => node.type === 'input' && node.props.id === id); assert.ok(input); return input.props },
    directory() { return all(tree).find(node => node.type === 'input' && node.props.placeholder === '留空 = 各厂商默认目录').props },
    command(id) { return this.row(id).find(node => node.type === 'code' && node.props['aria-label']?.endsWith('安装命令'))?.props.children },
    text() { return content(tree) },
    statuses() { return all(tree).filter(node => node.props.role === 'status').map(node => ({ text: content(node), className: node.props.className })) },
    unmount() { for (const frame of frames.values()) for (const slot of frame.slots) slot?.cleanup?.() },
  }
  return harness.render()
}

function summary(scope) {
  const value = scope.getSnapshot().value
  const preferences = parseInstallPreferences(value, { tools: OFFICIAL_TOOLS })
  return { ...preferences, requestedInstallDir: value.toolInstallDir,
    tools: [{ id: 'codex', savedMethodId: preferences.methods.codex ?? null, methodId: preferences.methods.codex ?? 'npm',
      command: 'CMD:' + (preferences.methods.codex ?? 'auto'), uninstallCommand: 'remove',
      methods: installMethodsFor(getOfficialTool('codex')).map(method => ({ id: method.id, label: method.label })) }] }
}

test('real SDK ACK releases method saving while probes hang; stale responses cannot restore an old method', async t => {
  const fixture = await sdkSettings()
  const full = deferred(), previews = []
  const oldSummary = summary(fixture.scope)
  let lists = 0
  const ui = await cardHarness({ settingsScope: fixture.scope, onProbes() {},
    listOfficialTools() { lists += 1; return full.promise },
    loadOfficialInstallSettings() { const gate = deferred(); previews.push({ gate, install: summary(fixture.scope) }); return gate.promise },
  })
  t.after(() => ui.unmount())
  previews[0].gate.resolve({ ok: true, value: { install: previews[0].install } })
  await tick(); ui.render()
  assert.equal(ui.install('codex').disabled, false, 'a confirmed install preview does not wait for a hung initial probe')
  ui.select('codex').onChange({ target: { value: 'pnpm' } })
  await tick(); ui.render()
  assert.equal(fixture.writes.length, 1)
  assert.equal(ui.select('codex').disabled, true)
  assert.match(ui.text(), /保存方式中/)
  fixture.accept(0)
  await tick(); ui.render()
  assert.equal(ui.select('codex').value, 'pnpm', 'selector follows the real SDK snapshot before any probe response')
  assert.equal(ui.select('codex').disabled, false, 'pending preview never blocks another choice')
  assert.doesNotMatch(ui.text(), /保存方式中/)
  assert.equal(ui.install('codex').disabled, true, 'install still waits for the reviewed command')
  assert.equal(lists, 1, 'settings changes use only the fast summary bridge')
  const stalePreview = previews.at(-1)
  ui.select('codex').onChange({ target: { value: 'npm' } })
  await tick(); fixture.accept(1); await tick(); ui.render()
  assert.equal(ui.select('codex').value, 'npm')
  stalePreview.gate.resolve({ ok: true, value: { install: stalePreview.install } })
  previews.at(-1).gate.resolve({ ok: true, value: { install: previews.at(-1).install } })
  await tick(); ui.render()
  assert.equal(ui.command('codex'), 'CMD:npm')
  full.resolve({ ok: true, value: { tools: [{ id: 'codex', installed: false }], install: oldSummary } })
  await tick(); ui.render()
  assert.equal(ui.command('codex'), 'CMD:npm', 'a late full probe cannot replace the current command preview')
  assert.equal(ui.select('codex').value, 'npm')
  assert.equal(ui.install('codex').disabled, false)
})

test('an installed current npm copy cannot disable installation or enable uninstall for a new pnpm target', async t => {
  const fixture = await sdkSettings()
  const previews = []
  const ui = await cardHarness({ settingsScope: fixture.scope, onProbes() {},
    health: { tools: [{ id: 'codex', latestVersion: '1.0.0' }] },
    listOfficialTools: async () => ({ ok: true, value: { tools: [{ id: 'codex', installed: true, version: '1.0.0' }], install: summary(fixture.scope) } }),
    loadOfficialInstallSettings() { const gate = deferred(); previews.push({ gate, install: summary(fixture.scope) }); return gate.promise },
  })
  t.after(() => ui.unmount())
  previews[0].gate.resolve({ ok: true, value: { install: previews[0].install } })
  await tick(); ui.render()
  assert.equal(ui.install('codex').disabled, true)
  assert.equal(ui.uninstall('codex').disabled, false)
  ui.select('codex').onChange({ target: { value: 'pnpm' } })
  await tick(); fixture.accept(0); await tick(); ui.render()
  previews.at(-1).gate.resolve({ ok: true, value: { install: previews.at(-1).install } })
  await tick(); ui.render()
  assert.equal(ui.install('codex').disabled, false)
  assert.equal(ui.uninstall('codex').disabled, true, 'only a fresh probe may establish that the new target is removable')
  assert.doesNotMatch(ui.text(), /已是最新版本/)
  assert.match(ui.text(), /所选安装目标尚未体检/)
})

test('ZCode can switch from the default GitHub archive to npm using the shared settings controls', async t => {
  const fixture = await sdkSettings()
  const previews = []
  const zcodeSummary = () => {
    const value = fixture.scope.getSnapshot().value
    const preferences = parseInstallPreferences(value, { tools: OFFICIAL_TOOLS })
    const methodId = preferences.methods.zcode ?? 'github-release'
    const npm = methodId === 'npm'
    return { ...preferences, requestedInstallDir: value.toolInstallDir,
      tools: [{ id: 'zcode', savedMethodId: preferences.methods.zcode ?? null, methodId,
        command: npm ? 'npm install -g @ljwei-stak/zcode-cli@latest --registry=https://registry.npmjs.org/' : 'GitHub Release archive → ~/.zcode/runtime',
        installDir: npm ? '/shared/npm/bin' : '/home/tester/.zcode/runtime', uninstallCommand: npm ? 'npm uninstall -g @ljwei-stak/zcode-cli' : 'remove archive runtime',
        methods: installMethodsFor(getOfficialTool('zcode')).map(method => ({ id: method.id, label: method.label })) }] }
  }
  const ui = await cardHarness({ settingsScope: fixture.scope, onProbes() {},
    listOfficialTools: async () => ({ ok: true, value: { tools: [{ id: 'zcode', installed: true, version: '3.16.2' }], install: zcodeSummary() } }),
    loadOfficialInstallSettings() { const gate = deferred(); previews.push({ gate, install: zcodeSummary() }); return gate.promise },
  })
  t.after(() => ui.unmount())
  previews[0].gate.resolve({ ok: true, value: { install: previews[0].install } })
  await tick(); ui.render()
  assert.match(ui.command('zcode'), /GitHub Release archive/)
  assert.equal(ui.uninstall('zcode').disabled, false)
  ui.select('zcode').onChange({ target: { value: 'npm' } })
  await tick(); ui.render()
  assert.equal(fixture.writes.length, 1)
  assert.deepEqual(JSON.parse(fixture.writes[0].operations[0].value), { zcode: 'npm' })
  fixture.accept(0); await tick(); ui.render()
  previews.at(-1).gate.resolve({ ok: true, value: { install: previews.at(-1).install } })
  await tick(); ui.render()
  assert.equal(ui.select('zcode').value, 'npm')
  assert.match(ui.command('zcode'), /npm install -g @ljwei-stak\/zcode-cli@latest/)
  assert.equal(ui.install('zcode').disabled, false)
  assert.equal(ui.uninstall('zcode').disabled, true, 'an archive probe must not authorize uninstalling the new npm target')
  assert.match(ui.text(), /所选安装目标尚未体检/)
})

test('real SDK delayed mutation times out visibly, then late ACK follows actual saved state', async () => {
  const fixture = await sdkSettings()
  let settlements = 0
  const pending = mutateToolInstallSettings(fixture.scope,
    [{ op: 'set', path: ['toolInstallMethodsJson'], value: '{"codex":"pnpm"}' }], 1,
    { timeoutMs: 5, onSettled() { settlements += 1 } })
  await assert.rejects(pending, /未收到确认/)
  assert.equal(settlements, 0, 'timeout does not pretend the queued SDK operation has settled')
  assert.equal(fixture.scope.getSnapshot().value.toolInstallMethodsJson, '{}')
  fixture.accept(0); await tick()
  assert.equal(settlements, 1)
  assert.equal(fixture.scope.getSnapshot().value.toolInstallMethodsJson, '{"codex":"pnpm"}')
  const retry = mutateToolInstallSettings(fixture.scope,
    [{ op: 'set', path: ['toolInstallMethodsJson'], value: '{"codex":"npm"}' }], 2)
  await tick(); fixture.accept(1)
  assert.equal(await retry, true)
  assert.equal(fixture.scope.getSnapshot().value.toolInstallMethodsJson, '{"codex":"npm"}')
})

test('a timed-out SDK write keeps installs blocked even after an old preview, and a late ACK recovers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const fixture = await sdkSettings()
  const previews = []
  const ui = await cardHarness({ settingsScope: fixture.scope, onProbes() {},
    listOfficialTools: async () => ({ ok: true, value: { tools: [{ id: 'codex', installed: false }], install: summary(fixture.scope) } }),
    loadOfficialInstallSettings() { const gate = deferred(); previews.push({ gate, install: summary(fixture.scope) }); return gate.promise },
  })
  t.after(() => ui.unmount())
  previews[0].gate.resolve({ ok: true, value: { install: previews[0].install } })
  await tick(); ui.render()
  assert.equal(ui.install('codex').disabled, false)
  ui.select('codex').onChange({ target: { value: 'pnpm' } })
  await tick(); ui.render()
  t.mock.timers.tick(15_000)
  await tick(); ui.render()
  assert.equal(ui.select('codex').disabled, false)
  assert.match(ui.text(), /未收到确认/)
  assert.equal(ui.install('codex').disabled, true)
  ui.retry().onClick()
  previews.at(-1).gate.resolve({ ok: true, value: { install: previews.at(-1).install } })
  await tick(); ui.render()
  assert.equal(ui.install('codex').disabled, true, 'the old confirmed summary cannot authorize a still-ambiguous SDK write')
  fixture.accept(0)
  await tick(); ui.render()
  assert.equal(ui.select('codex').value, 'pnpm')
  previews.at(-1).gate.resolve({ ok: true, value: { install: previews.at(-1).install } })
  await tick(); ui.render()
  assert.equal(ui.install('codex').disabled, false)
  assert.doesNotMatch(ui.text(), /未收到确认/)
})

test('a refused SDK write restores the saved selector and confirms the old commands without another full probe', async t => {
  const fixture = await sdkSettings()
  let lists = 0
  const ui = await cardHarness({ settingsScope: fixture.scope, onProbes() {},
    listOfficialTools: async () => { lists += 1; return { ok: true, value: { tools: [{ id: 'codex', installed: false }], install: summary(fixture.scope) } } },
    loadOfficialInstallSettings: async () => ({ ok: true, value: { install: summary(fixture.scope) } }),
  })
  t.after(() => ui.unmount())
  await tick(); ui.render()
  ui.select('codex').onChange({ target: { value: 'pnpm' } })
  await tick(); fixture.refuse(0); await tick(); ui.render()
  assert.equal(ui.select('codex').value, '')
  assert.equal(ui.select('codex').disabled, false)
  assert.match(ui.text(), /安装方式未被保存/)
  assert.equal(ui.install('codex').disabled, false)
  assert.equal(lists, 1)
})

test('unified settings bound a delayed SDK save while retaining draft mutual exclusion and late-ACK safety', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const fixture = await sdkSettings()
  const previews = []
  const ui = await cardHarness({ settingsScope: fixture.scope, onProbes() {},
    listOfficialTools: async () => ({ ok: true, value: { tools: [{ id: 'codex', installed: false }], install: summary(fixture.scope) } }),
    loadOfficialInstallSettings() { const gate = deferred(); previews.push({ gate, install: summary(fixture.scope) }); return gate.promise },
  })
  t.after(() => ui.unmount())
  previews[0].gate.resolve({ ok: true, value: { install: previews[0].install } })
  await tick(); ui.render()
  ui.directory().onChange({ target: { value: 'D:/AI tools' } }); ui.render()
  assert.equal(ui.select('codex').disabled, true, 'unsaved drafts still exclude method mutations')
  ui.button('保存安装设置').onClick()
  await tick(); ui.render()
  assert.equal(ui.directory().disabled, true)
  t.mock.timers.tick(15_000)
  await tick(); ui.render()
  assert.equal(ui.directory().disabled, false, 'the form does not remain permanently saving')
  assert.equal(ui.directory().value, 'D:/AI tools', 'a failed or uncertain save preserves the draft')
  assert.equal(ui.select('codex').disabled, true)
  ui.button('放弃更改').onClick(); ui.render()
  assert.equal(ui.select('codex').disabled, false)
  assert.equal(ui.install('codex').disabled, true, 'discarding a draft cannot settle the pending SDK request')
  fixture.accept(0)
  await tick(); ui.render()
  previews.at(-1).gate.resolve({ ok: true, value: { install: previews.at(-1).install } })
  await tick(); ui.render()
  assert.equal(ui.directory().value, 'D:/AI tools', 'the late SDK ACK is displayed as the actual saved value')
  assert.equal(ui.install('codex').disabled, false)
})

test('Host-expanded install directories match the original browser settings without local home access', () => {
  for (const directory of ['~/AI/tools', '%USERPROFILE%/AI/tools']) {
    const value = { toolInstallDir: directory, toolInstallMethodsJson: '{ "codex" : "npm" }', toolScriptUrlsJson: '{}' }
    assert.equal(installSummaryMatchesSettings({ requestedInstallDir: directory, installDir: 'C:/Users/Host/AI/tools',
      registry: 'https://registry.npmjs.org/', methods: { codex: 'npm' }, scriptUrls: {}, allowScriptInstall: true }, value), true)
  }
})

const launcherOptions = { entry: '../.dsh-plugin/client/run-launcher.jsx', component: 'RunLauncher' }
const launchPreview = (extra = {}) => ({
  selected: { provider: 'provider-a', model: 'small' },
  workspace: 'D:/experiment', estimatedCost: null, reasons: [],
  budget: { estimateKnown: false, exceeded: null, limited: true },
  decision: { preset: 'economy', packages: [{ id: 'direct', name: '短任务', route: 'provider-a/small',
    estimatedCost: null, channel: 'official-cli', channelDetail: '只读 CLI；请求指定模型，实际模型仍需核验。' }] },
  ...extra,
})

test('launcher reflects a rerun of its own failed run without borrowing another run status', async t => {
  const ui = await cardHarness({ task: '输出 JSON', mode: 'single', budgetUsd: 1,
    ledger: { runs: [] }, previewRun: async () => ({ ok: true, value: launchPreview() }),
    startRun: async () => ({ ok: true, value: { runId: 'first-run', status: 'failed' } }),
  }, launcherOptions)
  t.after(() => ui.unmount())
  ui.button('预览执行计划').onClick(); await tick(); ui.render()
  ui.button('确认执行').onClick(); await tick(); ui.render()
  assert.ok(ui.statuses().some(item => item.className === 'mr-error' && /执行失败/.test(item.text)))

  ui.update({ ledger: { runs: [{ id: 'another-run', status: 'completed' }, { id: 'first-run', status: 'failed' }] } })
  assert.ok(ui.statuses().some(item => item.className === 'mr-error' && /执行失败/.test(item.text)), 'another completed run cannot erase this failure')
  ui.update({ ledger: { runs: [{ id: 'another-run', status: 'failed' }, { id: 'first-run', status: 'completed' }] } })
  assert.ok(ui.statuses().some(item => item.className === 'mr-empty' && /执行完成/.test(item.text)))
  assert.doesNotMatch(ui.text(), /执行失败/, 'the original launch failure must not survive a completed rerun')
  ui.update({ ledger: { runs: [{ id: 'first-run', status: 'paused' }] } })
  assert.ok(ui.statuses().some(item => /等待确认/.test(item.text)), 'later pauses also come from the current run ledger')
})

test('launcher shows channel limits before confirmation and does not approve an unknown cost', async t => {
  const submitted = []
  const ui = await cardHarness({ task: '输出 JSON', mode: 'team', budgetUsd: 1, ledger: { runs: [] },
    previewRun: async () => ({ ok: true, value: launchPreview() }),
    startRun: async request => { submitted.push(request); return { ok: true, value: { status: 'completed', runId: 'new-run' } } },
  }, launcherOptions)
  t.after(() => ui.unmount())
  ui.button('预览执行计划').onClick(); await tick(); ui.render()
  assert.match(ui.text(), /只读 CLI；请求指定模型，实际模型仍需核验/)
  assert.match(ui.text(), /费用未知，无法确认本次费用是否在预算内/)
  assert.doesNotMatch(ui.text(), /本次未超出预算|未超预算/)
  assert.equal(submitted.length, 0, 'preview only must never invoke the model')
  ui.button('确认执行').onClick(); await tick(); ui.render()
  assert.equal(submitted.length, 1)
  assert.equal(submitted[0].planMode, 'team')
  assert.deepEqual(submitted[0].confirmedReasons, [])
})

test('launcher distinguishes a known estimate within limits from an unconfigured budget', async t => {
  let preview = launchPreview({ estimatedCost: 0.002, budget: { estimateKnown: true, exceeded: null, limited: true } })
  const ui = await cardHarness({ task: '输出 JSON', mode: 'single', budgetUsd: 1, ledger: { runs: [] },
    previewRun: async () => ({ ok: true, value: preview }), startRun: async () => ({ ok: true, value: {} }),
  }, launcherOptions)
  t.after(() => ui.unmount())
  ui.button('预览执行计划').onClick(); await tick(); ui.render()
  assert.match(ui.text(), /按已提供单价估算，API 部分未超出预算/)
  ui.button('取消').onClick(); ui.render()
  preview = launchPreview({ estimatedCost: 0.002, budget: { estimateKnown: true, exceeded: null, limited: false } })
  ui.button('预览执行计划').onClick(); await tick(); ui.render()
  assert.doesNotMatch(ui.text(), /API 部分未超出预算|费用未知/)
})

test('official team entry requires team planning and starts with the requested read-only permission', async t => {
  const previews = [], submitted = []
  const ui = await cardHarness({ task: '检查构建', mode: 'single', budgetUsd: 1, ledger: { runs: [] },
    previewRun: async request => { previews.push(request); return { ok: true, value: launchPreview({ executor: request.executor,
      executionMode: request.executionMode, readOnly: true }) } },
    startRun: async request => { submitted.push(request); return { ok: true, value: { status: 'completed', runId: 'team-run' } } },
  }, launcherOptions)
  t.after(() => ui.unmount())
  assert.equal(ui.button('官方工具协作').disabled, true)
  assert.match(ui.text(), /先在上方选择“团队分工”/)
  ui.button('官方工具协作').onClick(); ui.render()
  assert.equal(ui.button('模型路由（只读）')['aria-pressed'], true, 'a disabled entry cannot silently change a single-task request')
  ui.update({ mode: 'direct', directRoute: { provider: 'p', model: 'm' } })
  assert.equal(ui.button('官方工具协作').disabled, true)
  ui.update({ mode: 'team' })
  ui.button('官方工具协作').onClick(); ui.render()
  assert.equal(ui.button('只读检查')['aria-pressed'], true)
  assert.match(ui.text(), /已登录不代表当前任务权限已就绪/)
  ui.button('预览执行计划').onClick(); await tick(); ui.render()
  assert.equal(submitted.length, 0, 'preview never starts an official process')
  assert.equal(previews[0].executor, 'official-team')
  assert.equal(previews[0].executionMode, 'read-only')
  assert.equal(previews[0].planMode, 'team')
  assert.match(ui.text(), /只读检查，不修改工作区文件/)
  assert.match(ui.text(), /不会自动替换为模型目录 API/)
  ui.button('确认执行').onClick(); await tick(); ui.render()
  assert.deepEqual(submitted[0], { ...previews[0], confirmedReasons: [] })
})

test('changing official team permissions invalidates preview and locks controls during preview and execution', async t => {
  const previews = [], submitted = [], gates = [], execution = deferred()
  const ui = await cardHarness({ task: '修复构建', mode: 'team', budgetUsd: 1, ledger: { runs: [] },
    previewRun(request) { const gate = deferred(); gates.push(gate); previews.push(request); return gate.promise },
    startRun(request) { submitted.push(request); return execution.promise },
  }, launcherOptions)
  t.after(() => ui.unmount())
  ui.button('官方工具协作').onClick(); ui.render()
  ui.button('预览执行计划').onClick(); ui.render()
  for (const label of ['模型路由（只读）', '官方工具协作', '只读检查', '编辑文件']) assert.equal(ui.button(label).disabled, true)
  assert.equal(ui.input('mr-launch-workspace').disabled, true)
  gates[0].resolve({ ok: true, value: launchPreview({ executor: 'official-team', executionMode: 'read-only', readOnly: true,
    decision: { packages: [{ id: 'old', name: '旧只读计划', toolId: 'codex', channel: 'official-cli' }] } }) })
  await tick(); ui.render()
  const oldConfirm = ui.button('确认执行')
  ui.button('编辑文件').onClick(); ui.render()
  assert.doesNotMatch(ui.text(), /旧只读计划/)
  oldConfirm.onClick(); await tick(); ui.render()
  assert.equal(submitted.length, 0, 'a stale confirm callback cannot run with different permissions')
  ui.button('预览执行计划').onClick(); ui.render()
  assert.equal(previews[1].executionMode, 'workspace-write')
  gates[1].resolve({ ok: true, value: launchPreview({ executor: 'official-team', executionMode: 'workspace-write', readOnly: false,
    reasons: [{ code: 'workspace-write', zh: '允许编辑任务文件。' }],
    decision: { packages: [{ id: 'edit', name: '修复构建', toolId: 'minimax-code', channel: 'official-cli', channelDetail: '正常工具权限。' }] } }) })
  await tick(); ui.render()
  assert.match(ui.text(), /编辑范围：所选工作区\s+D:\/experiment/)
  assert.match(ui.text(), /独立 Git 工作树中完成后整合/)
  assert.match(ui.text(), /不会自动替换为模型目录 API/)
  assert.match(ui.text(), /minimax-code/)
  assert.match(ui.text(), /正常工具权限/)
  ui.button('全部确认并执行').onClick(); await tick(); ui.render()
  assert.deepEqual(submitted[0], { ...previews[1], confirmedReasons: ['workspace-write'] })
  for (const label of ['模型路由（只读）', '官方工具协作', '只读检查', '编辑文件']) assert.equal(ui.button(label).disabled, true)
  assert.equal(ui.input('mr-launch-workspace').disabled, true)
  execution.resolve({ ok: true, value: { runId: 'edited-run', status: 'completed' } })
  await tick(); ui.render()
  assert.match(ui.text(), /执行完成/)
})

test('switching executor or leaving team mode discards official previews and returns to compatible routing', async t => {
  const previews = [], submitted = [], pending = deferred()
  const ui = await cardHarness({ task: '检查构建', mode: 'team', budgetUsd: 1, ledger: { runs: [] },
    previewRun: async request => { previews.push(request); return previews.length === 2 ? pending.promise : { ok: true, value: launchPreview({ executor: 'official-team',
      decision: { packages: [{ id: 'old', name: '过期官方协作计划', route: 'codex', channel: 'official-cli' }] } }) } },
    startRun: async request => { submitted.push(request); return { ok: true, value: {} } },
  }, launcherOptions)
  t.after(() => ui.unmount())
  ui.button('官方工具协作').onClick(); ui.render()
  ui.button('预览执行计划').onClick(); await tick(); ui.render()
  const staleConfirm = ui.button('确认执行')
  ui.button('模型路由（只读）').onClick(); ui.render()
  staleConfirm.onClick(); await tick(); ui.render()
  assert.equal(submitted.length, 0)
  assert.doesNotMatch(ui.text(), /过期官方协作计划/)
  ui.button('官方工具协作').onClick(); ui.render()
  ui.button('编辑文件').onClick(); ui.render()
  ui.button('预览执行计划').onClick(); ui.render()
  ui.update({ mode: 'single' }); ui.render()
  pending.resolve({ ok: true, value: launchPreview({ executor: 'official-team', readOnly: false,
    decision: { packages: [{ id: 'late', name: '迟到编辑计划', route: 'codex' }] } }) })
  await tick(); ui.render()
  assert.doesNotMatch(ui.text(), /迟到编辑计划/)
  assert.equal(ui.button('模型路由（只读）')['aria-pressed'], true)
  ui.update({ mode: 'team' })
  assert.equal(ui.button('模型路由（只读）')['aria-pressed'], true, 'returning to team mode cannot restore write permission')
  ui.button('预览执行计划').onClick(); await tick(); ui.render()
  assert.equal(Object.hasOwn(previews[2], 'executor'), false)
  assert.equal(Object.hasOwn(previews[2], 'executionMode'), false)
})

test('a blocked official preview explains readiness and cannot be confirmed', async t => {
  const submitted = []
  const ui = await cardHarness({ task: '检查构建', mode: 'team', budgetUsd: 1, ledger: { runs: [] },
    previewRun: async () => ({ ok: true, value: launchPreview({ executor: 'official-team', executionMode: 'read-only', readOnly: true,
      status: 'blocked', reason: '没有支持只读任务的已就绪工具。',
      blocking: [{ message: 'MiniMax 已登录，但当前执行入口只支持编辑文件。' }, '请安装支持只读检查的官方工具。'],
    }) }),
    startRun: async request => { submitted.push(request); return { ok: true, value: {} } },
  }, launcherOptions)
  t.after(() => ui.unmount())
  ui.button('官方工具协作').onClick(); ui.render()
  ui.button('预览执行计划').onClick(); await tick(); ui.render()
  assert.match(ui.text(), /没有支持只读任务的已就绪工具/)
  assert.match(ui.text(), /MiniMax 已登录，但当前执行入口只支持编辑文件/)
  assert.match(ui.text(), /请安装支持只读检查的官方工具/)
  assert.equal(ui.button('确认执行').disabled, true)
  ui.button('确认执行').onClick(); await tick(); ui.render()
  assert.equal(submitted.length, 0, 'the handler also refuses blocked previews')
  assert.equal(ui.button('取消').disabled, false)
})

test('a blocked editable preview cannot be approved even with every confirmation reason', async t => {
  const submitted = []
  const ui = await cardHarness({ task: '修复构建', mode: 'team', budgetUsd: 1, ledger: { runs: [] },
    previewRun: async () => ({ ok: true, value: launchPreview({ executor: 'official-team', executionMode: 'workspace-write', readOnly: false,
      status: 'blocked', reason: '所选 Git 工作区存在未提交改动。', reasons: [{ code: 'workspace-write', zh: '允许编辑任务文件。' }],
    }) }),
    startRun: async request => { submitted.push(request); return { ok: true, value: {} } },
  }, launcherOptions)
  t.after(() => ui.unmount())
  ui.button('官方工具协作').onClick(); ui.render()
  ui.button('编辑文件').onClick(); ui.render()
  ui.button('预览执行计划').onClick(); await tick(); ui.render()
  assert.match(ui.text(), /所选 Git 工作区存在未提交改动/)
  assert.match(ui.text(), /编辑范围：所选工作区/)
  assert.equal(ui.button('全部确认并执行').disabled, true)
  ui.button('全部确认并执行').onClick(); await tick(); ui.render()
  assert.equal(submitted.length, 0)
})

test('official tool rows keep login state separate from the modes their execution entry supports', async t => {
  const fixture = await sdkSettings()
  const ui = await cardHarness({ settingsScope: fixture.scope, onProbes() {},
    health: { tools: [{ id: 'codex', installed: true, login: { state: 'logged-in' } },
      { id: 'minimax-code', installed: true, login: { state: 'logged-in' } },
      { id: 'mimo-code', installed: true, login: { state: 'logged-in' } },
      { id: 'stepcode', installed: true, login: { state: 'logged-in' } }] },
    listOfficialTools: async () => ({ ok: true, value: {
      tools: ['codex', 'minimax-code', 'mimo-code', 'stepcode'].map(id => ({ id, installed: true, version: '1.0.0' })),
      executionCapabilities: [{ id: 'codex', supported: true, modes: ['read-only', 'workspace-write'] },
        { id: 'minimax-code', supported: true, modes: ['workspace-write'] },
        { id: 'mimo-code', supported: true, modes: ['read-only', 'workspace-write'] },
        { id: 'stepcode', supported: false, reason: '尚未核验执行入口。' }],
      executionReadiness: [{ id: 'codex', ready: true, modes: ['read-only', 'workspace-write'], readyModes: ['read-only'] },
        { id: 'minimax-code', ready: true, modes: ['workspace-write'] },
        { id: 'mimo-code', ready: true, modes: ['read-only'] },
        { id: 'stepcode', ready: false, reason: '尚未核验执行入口。' }],
      install: summary(fixture.scope),
    } }),
    loadOfficialInstallSettings: async () => ({ ok: true, value: { install: summary(fixture.scope) } }),
  })
  t.after(() => ui.unmount())
  await tick(); ui.render()
  const rowText = id => ui.row(id).flatMap(node => typeof node.props.children === 'string' ? [node.props.children] : []).join(' ')
  assert.match(rowText('codex'), /支持只读任务；不支持可编辑任务/, 'dynamic readyModes override broader advertised modes')
  assert.match(rowText('minimax-code'), /不支持只读任务；支持可编辑隔离工作区任务（需审批）/)
  assert.match(rowText('mimo-code'), /支持只读任务；不支持可编辑任务/, 'readiness modes override broader static capability')
  assert.match(rowText('stepcode'), /当前不可托管执行：尚未核验执行入口/)
  assert.match(ui.text(), /已登录/, 'login evidence remains visible even for an unsupported executor')
  assert.doesNotMatch(ui.text(), /已登录可用/)
})

test('native environment requires an explicit editable-team selection and resets with read-only or routed execution', async t => {
  const previews = []
  const ui = await cardHarness({ task: '创建验收文件', mode: 'team', budgetUsd: 1, ledger: { runs: [] },
    previewRun: async request => { previews.push(request); return { ok: true, value: launchPreview({ executor: request.executor,
      executionMode: request.executionMode, executionEnvironment: request.executionEnvironment }) } },
    startRun: async () => ({ ok: true, value: {} }),
  }, launcherOptions)
  t.after(() => ui.unmount())
  assert.doesNotMatch(ui.text(), /厂商 CLI 正常环境/)
  ui.button('官方工具协作').onClick(); ui.render()
  assert.doesNotMatch(ui.text(), /厂商 CLI 正常环境/)
  ui.button('编辑文件').onClick(); ui.render()
  assert.equal(ui.button('Harness 受限环境')['aria-pressed'], true)
  assert.equal(ui.button('厂商 CLI 正常环境')['aria-pressed'], false)
  ui.button('厂商 CLI 正常环境').onClick(); ui.render()
  assert.equal(ui.button('厂商 CLI 正常环境')['aria-pressed'], true)
  assert.match(ui.text(), /当前用户权限运行，不经过 Harness 进程沙箱/)
  assert.match(ui.text(), /不是操作系统读写边界；不会自动切换到此环境/)
  ui.button('只读检查').onClick(); ui.render()
  assert.doesNotMatch(ui.text(), /厂商 CLI 正常环境/)
  ui.button('编辑文件').onClick(); ui.render()
  assert.equal(ui.button('Harness 受限环境')['aria-pressed'], true, 'returning to editable permission must not silently restore native execution')
  ui.button('厂商 CLI 正常环境').onClick(); ui.render()
  ui.button('模型路由（只读）').onClick(); ui.render()
  ui.button('预览执行计划').onClick(); await tick(); ui.render()
  assert.equal(Object.hasOwn(previews[0], 'executionEnvironment'), false, 'routed requests never retain a native environment')
  ui.button('取消').onClick(); ui.render()
  ui.button('官方工具协作').onClick(); ui.render()
  assert.equal(ui.button('只读检查')['aria-pressed'], true)
  ui.button('编辑文件').onClick(); ui.render()
  assert.equal(ui.button('Harness 受限环境')['aria-pressed'], true)
})

test('changing to native invalidates an old Harness preview and sends both approvals only after the new preview', async t => {
  const previews = [], submitted = [], gates = [], execution = deferred()
  const ui = await cardHarness({ task: '创建验收文件', mode: 'team', budgetUsd: 1, ledger: { runs: [] },
    previewRun(request) { const gate = deferred(); gates.push(gate); previews.push(request); return gate.promise },
    startRun(request) { submitted.push(request); return execution.promise },
  }, launcherOptions)
  t.after(() => ui.unmount())
  ui.button('官方工具协作').onClick(); ui.render()
  ui.button('编辑文件').onClick(); ui.render()
  ui.button('预览执行计划').onClick(); ui.render()
  assert.equal(Object.hasOwn(previews[0], 'executionEnvironment'), false, 'Harness is the default request environment')
  for (const label of ['Harness 受限环境', '厂商 CLI 正常环境']) assert.equal(ui.button(label).disabled, true)
  gates[0].resolve({ ok: true, value: launchPreview({ executor: 'official-team', executionMode: 'workspace-write', readOnly: false,
    reasons: [{ code: 'workspace-write', zh: '允许编辑任务文件。' }],
    decision: { packages: [{ id: 'harness', name: '旧 Harness 执行计划' }] } }) })
  await tick(); ui.render()
  const oldConfirm = ui.button('全部确认并执行')
  ui.button('厂商 CLI 正常环境').onClick(); ui.render()
  assert.doesNotMatch(ui.text(), /旧 Harness 执行计划/)
  oldConfirm.onClick(); await tick(); ui.render()
  assert.equal(submitted.length, 0, 'the old Harness confirmation cannot authorize a native execution')
  ui.button('预览执行计划').onClick(); ui.render()
  assert.equal(previews[1].executor, 'official-team')
  assert.equal(previews[1].executionMode, 'workspace-write')
  assert.equal(previews[1].executionEnvironment, 'cli-native')
  gates[1].resolve({ ok: true, value: launchPreview({ executor: 'official-team', executionMode: 'workspace-write', executionEnvironment: 'cli-native', readOnly: false,
    reasons: [{ code: 'workspace-write', zh: '在独立 Git 工作树编辑并整合文件。' },
      { code: 'unsandboxed', zh: '以当前用户权限运行，不经过 Harness 进程沙箱。' }],
    decision: { packages: [{ id: 'native', name: '新的原生环境计划', toolId: 'codex', channel: 'official-cli' }] } }) })
  await tick(); ui.render()
  assert.match(ui.text(), /执行前需要确认以下\s+2\s+项/)
  assert.match(ui.text(), /工作树不限制工具访问工作树外资源/)
  assert.equal(submitted.length, 0)
  ui.button('全部确认并执行').onClick(); await tick(); ui.render()
  assert.deepEqual(submitted[0], { ...previews[1], confirmedReasons: ['workspace-write', 'unsandboxed'] })
  for (const label of ['Harness 受限环境', '厂商 CLI 正常环境']) assert.equal(ui.button(label).disabled, true)
  execution.resolve({ ok: true, value: { status: 'cli-completed', runId: 'native-run' } })
  await tick(); ui.render()
  assert.match(ui.text(), /执行完成/)
})

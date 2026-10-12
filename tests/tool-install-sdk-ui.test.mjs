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

let bundlePromise
async function cardHarness(props) {
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
  bundlePromise ??= build({ entryPoints: [fileURLToPath(new URL('../.dsh-plugin/client/router-main.jsx', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], loader: { '.css': 'text' }, logLevel: 'silent' }).then(result => result.outputFiles[0].text)
  const module = { exports: {} }
  new Function('require', 'module', 'exports', await bundlePromise)(name => name === 'react' ? react : require(name), module, module.exports)
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
    render() { effects = []; tree = resolve(react.createElement(module.exports.OfficialToolsCard, props), 'root'); effects.forEach(effect => effect()); return harness },
    row(id) { const row = all(tree).find(node => node.props.className === 'mr-tool' && all(node).some(child => child.props.className === 'mr-route-provider' && content(child).trim().endsWith(id))); assert.ok(row); return all(row) },
    select(id) { return this.row(id).find(node => node.type === 'select').props },
    install(id) { return this.row(id).find(node => node.type === 'button').props },
    uninstall(id) { return this.row(id).find(node => node.type === 'button' && content(node).trim() === '一键卸载').props },
    retry() { return all(tree).find(node => node.type === 'button' && content(node).trim() === '刷新安装命令').props },
    button(label) { const button = all(tree).find(node => node.type === 'button' && content(node).trim() === label); assert.ok(button); return button.props },
    directory() { return all(tree).find(node => node.type === 'input' && node.props.placeholder === '留空 = 各厂商默认目录').props },
    command(id) { return this.row(id).find(node => node.type === 'code' && node.props['aria-label']?.endsWith('安装命令'))?.props.children },
    text() { return content(tree) },
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

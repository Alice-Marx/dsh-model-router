import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import {
  dynamicSourceView, learningEvidenceRows, learningExclusionRows, learningView,
} from '../.dsh-plugin/client/adaptive-state.mjs'

let bundlePromise
async function components(react = React) {
  bundlePromise ??= build({ entryPoints: [fileURLToPath(new URL('../.dsh-plugin/client/router-insights.jsx', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], logLevel: 'silent' }).then(result => result.outputFiles[0].text)
  const module = { exports: {} }
  const require = createRequire(import.meta.url)
  new Function('require', 'module', 'exports', await bundlePromise)(name => name === 'react' ? react : require(name), module, module.exports)
  return module.exports
}

const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function settingsFixture(value = {}, accept = async () => true) {
  let snapshot = { status: 'ready', writable: true, revision: 1, value }
  const listeners = new Set()
  const calls = []
  return { calls, getSnapshot: () => snapshot,
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback) },
    publish(next) { snapshot = { ...snapshot, revision: snapshot.revision + 1, value: { ...snapshot.value, ...next } }; for (const callback of listeners) callback() },
    async mutate(operations, revision) {
      calls.push({ operations, revision })
      const accepted = await accept(operations, revision)
      if (accepted) this.publish(Object.fromEntries(operations.map(operation => [operation.path[0], operation.value])))
      return accepted
    },
  }
}

/** Deterministic handler harness, not a browser or a replacement for React E2E.
 * It executes the actual bundled components/handlers, retains hook slots, and
 * deliberately delivers already-captured handlers twice before a re-render.
 */
async function handlerHarness(componentName, props) {
  const frames = new Map()
  let active
  let effects = []
  const react = {
    Fragment: Symbol('Fragment'),
    createElement(type, input, ...children) { return { type, props: { ...input, children: children.length === 1 ? children[0] : children } } },
    useState(initial) {
      const frame = active
      const index = frame.cursor++
      if (!Object.hasOwn(frame.slots, index)) frame.slots[index] = typeof initial === 'function' ? initial() : initial
      return [frame.slots[index], next => { frame.slots[index] = typeof next === 'function' ? next(frame.slots[index]) : next }]
    },
    useRef(initial) {
      const frame = active
      const index = frame.cursor++
      frame.slots[index] ??= { current: initial }
      return frame.slots[index]
    },
    useEffect(callback, deps) {
      const frame = active
      const index = frame.cursor++
      const previous = frame.slots[index]
      if (!previous || !deps || deps.some((item, position) => !Object.is(item, previous.deps?.[position]))) {
        effects.push(() => { previous?.cleanup?.(); frame.slots[index] = { deps, cleanup: callback() } })
      }
    },
  }
  const loaded = await components(react)
  let currentProps = props
  let tree
  function resolve(node, path) {
    if (Array.isArray(node)) return node.map((child, index) => resolve(child, `${path}.${index}`))
    if (!node || typeof node !== 'object') return node
    if (typeof node.type === 'function') {
      const id = `${path}:${node.type.name}:${node.props.key ?? ''}`
      const frame = frames.get(id) ?? { slots: [], cursor: 0, hookCount: null }
      frames.set(id, frame)
      frame.cursor = 0
      const previous = active
      active = frame
      const output = node.type(node.props)
      active = previous
      if (frame.hookCount !== null) assert.equal(frame.cursor, frame.hookCount, `hook order changed in ${node.type.name}`)
      frame.hookCount = frame.cursor
      return resolve(output, `${path}.component`)
    }
    return { ...node, props: { ...node.props, children: resolve(node.props.children, `${path}.children`) } }
  }
  function flatten(node, all = []) {
    if (Array.isArray(node)) { for (const child of node) flatten(child, all); return all }
    if (node && typeof node === 'object') { all.push(node); flatten(node.props?.children, all) }
    return all
  }
  function content(node) {
    if (Array.isArray(node)) return node.map(content).join(' ')
    if (node && typeof node === 'object') return content(node.props?.children)
    return node === null || node === undefined || node === false ? '' : String(node)
  }
  const harness = {
    render(nextProps = currentProps) {
      currentProps = nextProps
      effects = []
      tree = resolve(react.createElement(loaded[componentName], currentProps), 'root')
      for (const effect of effects) effect()
      return harness
    },
    find(predicate) { const node = flatten(tree).find(predicate); assert.ok(node, 'UI node must exist'); return node.props },
    input(id) { return this.find(node => node.type === 'input' && node.props.id === id) },
    button(label) { return this.find(node => node.type === 'button' && content(node).trim() === label) },
    controlButton(id) {
      const group = flatten(tree).find(node => node.type === 'div' && node.props.className === 'mr-control-group'
        && flatten(node).some(child => child.type === 'input' && child.props.id === id))
      assert.ok(group, `control group must exist for ${id}`)
      return flatten(group).find(node => node.type === 'button').props
    },
    text() { return content(tree) },
    unmount() { for (const frame of frames.values()) for (const slot of frame.slots) slot?.cleanup?.() },
  }
  return harness.render()
}

const cell = (adjustment = 0.01) => ({ feedbackCount: 3, positiveCount: 2, negativeCount: 1,
  effectiveWeight: 2.5, effectiveSampleSize: 2.9, shrinkage: 0.45, adjustment })

test('current settings outrank an older ledger learning flag without inferring satisfaction', () => {
  assert.equal(learningView({ enabled: true, feedbackCount: 5 }, { feedbackLearningEnabled: false }).enabled, false)
  assert.equal(learningView({ enabled: false }, { feedbackLearningEnabled: true }).enabled, true)
  assert.equal(learningView([], {}).available, false)
})

test('evidence projections are limited to known valid Host cells and fixed exclusion categories', () => {
  const cells = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`provider\0model-${index}`, { code: cell(index % 2 ? -0.01 : 0.01) }]))
  cells['bad-route'] = { code: cell() }
  cells['provider\0bad'] = { code: cell(0.5), missing: { adjustment: 0.01 } }
  const view = learningEvidenceRows({ cellStats: cells })
  assert.equal(view.total, 20)
  assert.equal(view.rows.length, 12)
  assert.equal(new Set(view.rows.map(row => row.id)).size, 12)
  assert.equal(view.rows[0].positiveCount, 2)
  assert.equal(learningEvidenceRows({ adjustments: cells }).total, 0, 'legacy adjustments are not evidence counts')
  assert.deepEqual(learningExclusionRows({ exclusionReasons: { unrated: 4, 'cli-model-unverified': 2, SECRET_UNKNOWN: 9 } }), [
    { reason: 'unrated', label: '尚未评价（不是不满意）', count: 4 },
    { reason: 'cli-model-unverified', label: 'CLI 实际模型未核验', count: 2 },
  ])
})

test('dynamic source controls hide disabled data and only accept known public error codes', () => {
  const source = { status: 'stale', source: 'https://public.example/scores.json', version: 'v1', verifiedAt: 10,
    refreshing: true, pending: true, lastAttemptAt: 20, lastSuccessAt: 10, error: 'storage-failed',
    configuredEndpoint: 'https://new.example/scores.json', lastGoodEndpoint: 'https://public.example/scores.json', modelCount: 2 }
  const view = dynamicSourceView(source)
  assert.equal(view.status, 'stale')
  assert.equal(view.errorCode, 'storage-failed')
  assert.equal(view.refreshing, true)
  assert.equal(view.lastSuccessAt, 10)
  const disabled = dynamicSourceView(source, false)
  assert.equal(disabled.status, 'disabled')
  assert.equal(disabled.count, 0)
  assert.equal(disabled.version, null)
  assert.equal(disabled.refreshing, false)
  assert.equal(disabled.endpoint, '')
  assert.ok(!JSON.stringify(disabled).includes('public.example'))
  const privateSource = dynamicSourceView({ status: 'error', error: 'SECRET_ERROR',
    configuredEndpoint: 'https://user:SECRET_AUTH@example.org/', lastGoodEndpoint: 'https://public.example/?token=SECRET_QUERY' })
  assert.equal(privateSource.errorCode, '')
  assert.ok(!JSON.stringify(privateSource).includes('SECRET'))
})

test('cost UI labels old summaries, bounded observed evidence and refresh failures honestly', async () => {
  const { CostControlCard } = await components()
  const ledger = { learning: { enabled: true, feedbackCount: 3, effectiveWeight: 2.5, ignoredCount: 4,
    cellStats: { 'provider\0model': { code: cell() } }, exclusionReasons: { unrated: 4 } },
    dynamicData: { liveBench: { status: 'stale', version: 'SYNTHETIC_V1', modelCount: 2, refreshing: true,
      error: 'refresh-interrupted', lastAttemptAt: 30, lastSuccessAt: 10 } } }
  const html = renderToStaticMarkup(React.createElement(CostControlCard, { ledger, refreshing: true,
    error: 'Synthetic refresh failed', settingsScope: settingsFixture({ feedbackLearningEnabled: false, dynamicDataEnabled: true }) }))
  for (const label of ['学习已停用', '最近一次账本摘要', '正在读取反馈与公开数据摘要', 'Synthetic refresh failed',
    '查看分模型 / 任务类型的已观察反馈', '不是质量置信度', '尚未评价（不是不满意）', '上次公开数据刷新中断',
    '不是本次请求已成功', '不保证每次下载新数据', 'provider/model', '+0.0100']) assert.ok(html.includes(label), `missing ${label}`)
  const offHtml = renderToStaticMarkup(React.createElement(CostControlCard, { ledger, settingsScope: settingsFixture({}) }))
  assert.ok(!offHtml.includes('SYNTHETIC_V1'), 'switching off hides an older active source summary immediately')
})

test('settings saves have a synchronous shared lock and protect newer numeric drafts', async t => {
  const pending = deferred()
  const scope = settingsFixture({}, () => pending.promise)
  let changed = 0
  const ui = await handlerHarness('CostControlCard', { ledger: null, settingsScope: scope, onChanged: async () => { changed += 1 } })
  t.after(() => ui.unmount())
  ui.input('mr-feedbackHalfLifeDays').onChange({ target: { value: '60' } })
  ui.render()
  const save = ui.controlButton('mr-feedbackHalfLifeDays')
  const capturedInput = ui.input('mr-feedbackHalfLifeDays')
  save.onClick()
  save.onClick()
  assert.equal(scope.calls.length, 1, 'two captured handlers in one tick must not mutate twice')
  ui.render()
  assert.equal(ui.input('mr-feedbackHalfLifeDays').disabled, true)
  assert.equal(ui.input('mr-feedbackPriorWeight').disabled, true)
  assert.equal(ui.button('从现在重新学习').disabled, true)
  assert.match(ui.text(), /正在保存设置/)
  capturedInput.onChange({ target: { value: '90' } })
  pending.resolve(true)
  await tick()
  ui.render()
  assert.equal(scope.getSnapshot().value.feedbackHalfLifeDays, 60)
  assert.equal(ui.input('mr-feedbackHalfLifeDays').value, '90', 'a late save must not erase a newer edit')
  assert.equal(ui.input('mr-feedbackHalfLifeDays').disabled, false)
  assert.equal(changed, 1)
})

test('settings conflict and service failure preserve drafts and allow retry with the latest revision', async t => {
  let attempt = 0
  const scope = settingsFixture({}, async () => { attempt += 1; if (attempt === 1) return false; if (attempt === 2) throw new Error('Synthetic service failure'); return true })
  const ui = await handlerHarness('CostControlCard', { settingsScope: scope })
  t.after(() => ui.unmount())
  ui.input('mr-feedbackPriorWeight').onChange({ target: { value: '8' } })
  ui.render().controlButton('mr-feedbackPriorWeight').onClick()
  await tick()
  ui.render()
  assert.equal(ui.input('mr-feedbackPriorWeight').value, '8')
  assert.match(ui.text(), /设置未保存/)
  scope.publish({ feedbackLearningEnabled: false })
  ui.render().controlButton('mr-feedbackPriorWeight').onClick()
  await tick()
  ui.render()
  assert.match(ui.text(), /Synthetic service failure/)
  assert.equal(ui.input('mr-feedbackPriorWeight').disabled, false)
  ui.controlButton('mr-feedbackPriorWeight').onClick()
  await tick()
  ui.render()
  assert.equal(scope.calls.at(-1).revision, 2)
  assert.equal(scope.getSnapshot().value.feedbackPriorWeight, 8)
  assert.equal(ui.input('mr-feedbackPriorWeight').value, '')
})

test('endpoint saves await refresh, preserve later edits and distinguish refresh failure from save failure', async t => {
  const pending = deferred()
  const refresh = deferred()
  const scope = settingsFixture({}, () => pending.promise)
  const ui = await handlerHarness('CostControlCard', { settingsScope: scope, onChanged: () => refresh.promise })
  t.after(() => ui.unmount())
  ui.input('mr-pricingSnapshotEndpoint').onChange({ target: { value: 'https://first.example/prices.json' } })
  ui.render().controlButton('mr-pricingSnapshotEndpoint').onClick()
  pending.resolve(true)
  await tick()
  ui.render()
  assert.equal(ui.input('mr-pricingSnapshotEndpoint').value, 'https://first.example/prices.json')
  ui.input('mr-pricingSnapshotEndpoint').onChange({ target: { value: 'https://second.example/prices.json' } })
  refresh.reject(new Error('Synthetic private upstream error'))
  await tick()
  ui.render()
  assert.equal(scope.getSnapshot().value.pricingSnapshotEndpoint, 'https://first.example/prices.json')
  assert.equal(ui.input('mr-pricingSnapshotEndpoint').value, 'https://second.example/prices.json')
  assert.match(ui.text(), /设置已保存，但摘要刷新失败/)
  assert.ok(!ui.text().includes('Synthetic private upstream error'))
})

test('reset is cancelable, one in-flight operation, and only updates the learning start', async t => {
  const original = globalThis.window
  let confirms = 0
  let confirm = false
  globalThis.window = { confirm: () => { confirms += 1; return confirm } }
  t.after(() => { globalThis.window = original })
  const pending = deferred()
  const scope = settingsFixture({}, () => pending.promise)
  const ledger = { runs: [{ id: 'SYNTHETIC_RUN' }], spent: { today: 12, month: 20 } }
  const ui = await handlerHarness('CostControlCard', { ledger, settingsScope: scope })
  t.after(() => ui.unmount())
  ui.button('从现在重新学习').onClick()
  assert.equal(scope.calls.length, 0)
  confirm = true
  const reset = ui.button('从现在重新学习')
  reset.onClick()
  reset.onClick()
  assert.equal(confirms, 2, 'the second in-flight reset must not repeat confirmation')
  assert.equal(scope.calls.length, 1)
  assert.equal(scope.calls[0].operations[0].path[0], 'feedbackResetAt')
  assert.equal(scope.calls[0].operations.length, 1)
  assert.ok(scope.calls[0].operations[0].value > 0)
  assert.equal(ledger.runs.length, 1)
  assert.equal(ledger.spent.month, 20)
  pending.resolve(true)
  await tick()
  ui.render()
  assert.equal(ui.button('从现在重新学习').disabled, false)
})

test('paused-to-complete run nodes retain hook order and disclose timestamp-bound withdrawal', async t => {
  const base = { id: 'step', provider: 'provider', model: 'model', name: 'Synthetic step', type: 'code',
    ran: true, ok: false, status: 'paused', dependsOn: [], finishedAt: 123 }
  const run = { id: 'run', kind: 'assign', task: 'Synthetic task', status: 'paused', preset: 'balanced', createdAt: 100, packages: [base] }
  const calls = []
  const props = { ledger: { runs: [run] }, routes: [], busy: false, onRate: (...args) => calls.push(args), onRerun: () => {} }
  const ui = await handlerHarness('RunHistoryCard', props)
  t.after(() => ui.unmount())
  const complete = { ...base, ok: true, status: 'succeeded', rating: 1 }
  ui.render({ ...props, ledger: { runs: [{ ...run, status: 'succeeded', packages: [complete] }] } })
  assert.equal(ui.button('👍 有用').title, '再次点击撤回有用评价')
  ui.button('👍 有用').onClick()
  assert.deepEqual(calls[0], ['run', 'step', 'clear', 123])
  ui.render({ ...props, ledger: { runs: [run] } })
  assert.match(ui.text(), /等待确认/)
})

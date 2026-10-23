import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const tick = () => new Promise(resolve => setImmediate(resolve))
const ok = value => ({ ok: true, value })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const epoch = Date.parse('2026-10-23T08:00:00Z')
const preview = { workspace: 'F:/fixture', reasons: [], selected: { provider: 'fixture', model: 'gpt' },
  decision: { preset: 'balanced', packages: [{ id: 'p1', name: '检查输入' }, { id: 'p2', name: '汇总结果' }] } }
const snapshot = (extra = {}) => ({ jobId: 'job-one', status: 'running', startedAt: epoch, finishedAt: null,
  cancelRequested: false, result: null,
  progress: { total: 2, completed: 0, current: { id: 'p1', name: '检查输入' }, stage: 'executing',
    packages: [{ id: 'p1', name: '检查输入', status: 'running' }, { id: 'p2', name: '汇总结果', status: 'pending' }] }, ...extra })

// Same React/esbuild component harness as tool-install-sdk-ui, with local fake
// timers so polling, cancellation races, and cleanup run without real waits.
let bundle
async function launcherHarness(overrides = {}) {
  const { storage = new Map(), ...componentProps } = overrides
  bundle ??= build({ entryPoints: [fileURLToPath(new URL('../.dsh-plugin/client/run-launcher.jsx', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react'], logLevel: 'silent' })
    .then(result => result.outputFiles[0].text)
  const timers = new Map()
  let frame = { slots: [], cursor: 0, unmounted: false }
  let timerId = 0, time = epoch, tree, effects = [], lateUpdates = 0
  const schedule = (callback, delay, repeat = false) => {
    const id = ++timerId
    timers.set(id, { callback, at: time + delay, repeat: repeat ? delay : 0 })
    return id
  }
  class ClockDate extends Date { static now() { return time } }
  const react = {
    createElement(type, input, ...children) { return { type, props: { ...input, children: children.length === 1 ? children[0] : children } } },
    useState(initial) {
      const stateFrame = frame, index = stateFrame.cursor++
      if (!Object.hasOwn(stateFrame.slots, index)) stateFrame.slots[index] = typeof initial === 'function' ? initial() : initial
      return [stateFrame.slots[index], next => { if (stateFrame.unmounted) lateUpdates += 1; stateFrame.slots[index] = typeof next === 'function' ? next(stateFrame.slots[index]) : next }]
    },
    useRef(initial) { return frame.slots[frame.cursor++] ??= { current: initial } },
    useEffect(callback, deps) {
      const index = frame.cursor++, previous = frame.slots[index]
      if (!previous || !deps || deps.some((value, position) => !Object.is(value, previous.deps?.[position]))) {
        effects.push(() => { previous?.cleanup?.(); frame.slots[index] = { deps, cleanup: callback() } })
      }
    },
    useCallback(callback, deps) {
      const index = frame.cursor++, previous = frame.slots[index]
      if (!previous || deps.some((value, position) => !Object.is(value, previous.deps?.[position]))) frame.slots[index] = { deps, value: callback }
      return frame.slots[index].value
    },
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'sessionStorage', await bundle)(
    name => name === 'react' ? react : require(name), module, module.exports,
    (callback, delay) => schedule(callback, delay), id => timers.delete(id),
    (callback, delay) => schedule(callback, delay, true), id => timers.delete(id), ClockDate,
    { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) })
  const props = { task: 'fixture task', mode: 'team', ledger: { runs: [] },
    previewRun: async () => ok(preview), startRun: async () => ok(snapshot()),
    runStatus: async () => ok(snapshot()), cancelRun: async () => ok(snapshot({ status: 'cancelling', cancelRequested: true })), ...componentProps }
  const resolve = node => {
    if (Array.isArray(node)) return node.map(resolve)
    if (!node || typeof node !== 'object') return node
    if (typeof node.type === 'function') return resolve(node.type(node.props))
    return { ...node, props: { ...node.props, children: resolve(node.props.children) } }
  }
  const all = (node, result = []) => {
    if (Array.isArray(node)) node.forEach(child => all(child, result))
    else if (node && typeof node === 'object') { result.push(node); all(node.props?.children, result) }
    return result
  }
  const content = node => Array.isArray(node) ? node.map(content).join(' ') : node && typeof node === 'object'
    ? content(node.props.children) : node == null || node === false ? '' : String(node)
  const ui = {
    render() { frame.cursor = 0; effects = []; tree = resolve(react.createElement(module.exports.RunLauncher, props)); effects.forEach(effect => effect()); return ui },
    update(next) { Object.assign(props, next); return ui.render() },
    text: () => content(tree),
    button(label) { const node = all(tree).find(node => node.type === 'button' && content(node).trim() === label); assert.ok(node, `missing button ${label}`); return node.props },
    progress: () => all(tree).find(node => node.type === 'progress')?.props,
    async advance(ms) {
      const until = time + ms
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at).find(([, timer]) => timer.at <= until)
        if (!next) break
        const [id, timer] = next
        time = timer.at
        if (timer.repeat) timer.at += timer.repeat
        else timers.delete(id)
        timer.callback()
        await tick()
      }
      time = until
      return ui.render()
    },
    async start() {
      ui.button('预览执行计划').onClick(); await tick(); ui.render()
      ui.button('确认执行').onClick(); await tick(); return ui.render()
    },
    unmount() { frame.unmounted = true; for (const slot of frame.slots) slot?.cleanup?.() },
    remount(next = {}) {
      if (!frame.unmounted) ui.unmount()
      frame = { slots: [], cursor: 0, unmounted: false }
      Object.assign(props, next)
      ui.render()
      return ui.render()
    },
    timerCount: () => timers.size,
    lateUpdates: () => lateUpdates,
    storage,
  }
  return ui.render()
}

test('start snapshot immediately shows package progress and a local elapsed clock, then completion refreshes history once', async t => {
  const statuses = [], finished = []
  let next = snapshot()
  const ui = await launcherHarness({ runStatus: async request => { statuses.push(request); return ok(next) }, onStarted: id => finished.push(id) })
  t.after(() => ui.unmount())
  await ui.start()
  assert.match(ui.text(), /当前工作包：检查输入/)
  assert.match(ui.text(), /已处理\s+0\s+\/\s+2/)
  assert.match(ui.text(), /检查输入\s+正在执行/)
  assert.match(ui.text(), /汇总结果\s+等待执行/)
  assert.equal(ui.button('取消执行').disabled, false)
  assert.equal(ui.button('预览执行计划').disabled, true)
  assert.equal(ui.progress().value, 0)
  assert.equal(statuses.length, 0, 'the start response is shown without waiting for the first poll')
  await ui.advance(2000)
  assert.match(ui.text(), /已耗时\s+0 分 02 秒/)
  assert.deepEqual(statuses, [{ jobId: 'job-one' }, { jobId: 'job-one' }])
  next = snapshot({ status: 'completed', finishedAt: epoch + 3000, result: { status: 'completed', runId: 'run-result' } })
  await ui.advance(1000)
  assert.match(ui.text(), /执行完成/)
  assert.match(ui.text(), /结果已记录/)
  assert.deepEqual(finished, ['run-result'])
  assert.equal(ui.timerCount(), 0)
  await ui.advance(4000)
  assert.equal(statuses.length, 3)
})

test('poll transport failures preserve the job, cancellation and ticking clock while retrying serially', async t => {
  const calls = [], pending = deferred()
  const ui = await launcherHarness({ runStatus: request => { calls.push(request); return calls.length === 1 ? Promise.reject(new Error('offline')) : pending.promise } })
  t.after(() => ui.unmount())
  await ui.start(); await ui.advance(1000)
  assert.match(ui.text(), /将自动重试；任务可能仍在执行/)
  assert.equal(ui.button('取消执行').disabled, false)
  assert.equal(ui.button('预览执行计划').disabled, true)
  await ui.advance(4000)
  assert.equal(calls.length, 2, 'a slow status request must not overlap with another poll')
  assert.match(ui.text(), /已耗时\s+0 分 05 秒/)
  pending.resolve(ok(snapshot({ progress: { total: 2, completed: 1, current: { id: 'p2', name: '汇总结果' },
    packages: [{ id: 'p1', name: '检查输入', status: 'succeeded' }, { id: 'p2', name: '汇总结果', status: 'running' }] } })))
  await tick(); ui.render()
  assert.doesNotMatch(ui.text(), /将自动重试/)
  assert.match(ui.text(), /已处理\s+1\s+\/\s+2/)
  assert.match(ui.text(), /当前工作包：汇总结果/)
  assert.deepEqual(calls[1], { jobId: 'job-one' })
})

test('cancel request failure can be retried and successful ACK waits for a Host terminal result', async t => {
  const cancellations = [], finished = []
  let status = snapshot()
  const ui = await launcherHarness({ runStatus: async () => ok(status), onStarted: id => finished.push(id),
    cancelRun: async request => { cancellations.push(request); return cancellations.length === 1 ? { ok: false, error: { message: 'offline' } } : ok(snapshot({ status: 'cancelling', cancelRequested: true })) } })
  t.after(() => ui.unmount())
  await ui.start()
  ui.button('取消执行').onClick(); await tick(); ui.render()
  assert.match(ui.text(), /取消请求未确认/)
  assert.equal(ui.button('取消执行').disabled, false)
  await ui.advance(1000)
  assert.match(ui.text(), /取消请求未确认/, 'ordinary progress refreshes retain the failed cancel feedback')
  ui.button('取消执行').onClick(); await tick(); ui.render()
  assert.match(ui.text(), /正在取消/)
  assert.match(ui.text(), /等待执行结束/)
  assert.doesNotMatch(ui.text(), /取消请求未确认/)
  assert.equal(ui.button('正在取消…').disabled, true)
  assert.equal(finished.length, 0)
  status = snapshot({ status: 'cancelled', cancelRequested: true, finishedAt: epoch + 2000,
    result: { status: 'cancelled', runId: 'cancelled-run' } })
  await ui.advance(1000)
  assert.match(ui.text(), /已取消/)
  assert.match(ui.text(), /结果已记录/)
  assert.deepEqual(finished, ['cancelled-run'])
  assert.deepEqual(cancellations, [{ jobId: 'job-one' }, { jobId: 'job-one' }])
  assert.equal(ui.button('预览执行计划').disabled, false)
})

test('a status response from before cancellation cannot erase the acknowledged cancelling state', async t => {
  const stale = deferred()
  const ui = await launcherHarness({ runStatus: () => stale.promise })
  t.after(() => ui.unmount())
  await ui.start(); await ui.advance(1000)
  ui.button('取消执行').onClick(); await tick(); ui.render()
  stale.resolve(ok(snapshot()))
  await tick(); ui.render()
  assert.match(ui.text(), /正在取消/)
  assert.equal(ui.button('正在取消…').disabled, true)
  assert.doesNotMatch(ui.text(), /取消执行/)
})

test('a delayed cancel ACK retains newer package progress and still enters cancelling', async t => {
  const ack = deferred()
  const progressed = snapshot({ progress: { total: 2, completed: 1, current: { id: 'p2', name: '汇总结果' }, packages: [] } })
  const ui = await launcherHarness({ cancelRun: () => ack.promise, runStatus: async () => ok(progressed) })
  t.after(() => ui.unmount())
  await ui.start()
  const button = ui.button('取消执行')
  button.onClick(); button.onClick(); ui.render()
  assert.equal(ui.button('正在请求取消…').disabled, true)
  await ui.advance(1000)
  ack.resolve(ok(snapshot({ status: 'cancelling', cancelRequested: true })))
  await tick(); ui.render()
  assert.match(ui.text(), /正在取消/)
  assert.match(ui.text(), /已处理\s+1\s+\/\s+2/)
  assert.match(ui.text(), /当前工作包：汇总结果/)
})

test('late cancellation responses cannot replace terminal status or a subsequent job', async t => {
  const oldAck = deferred(), cancelled = []
  let launches = 0
  const ui = await launcherHarness({ startRun: async () => ok(snapshot({ jobId: ++launches === 1 ? 'job-one' : 'job-two' })),
    runStatus: async ({ jobId }) => ok(jobId === 'job-one' ? snapshot({ status: 'completed', result: { status: 'completed', runId: 'first-result' } }) : snapshot({ jobId })),
    cancelRun: request => { cancelled.push(request); return oldAck.promise } })
  t.after(() => ui.unmount())
  await ui.start()
  ui.button('取消执行').onClick(); ui.render()
  await ui.advance(1000)
  assert.match(ui.text(), /执行完成/)
  await ui.start()
  oldAck.resolve(ok(snapshot({ status: 'cancelled', result: { status: 'cancelled', runId: 'first-result' } })))
  await tick(); ui.render()
  assert.match(ui.text(), /当前工作包：检查输入/)
  assert.doesNotMatch(ui.text(), /已取消/)
  assert.equal(ui.button('取消执行').disabled, false)
  assert.deepEqual(cancelled, [{ jobId: 'job-one' }])
})

test('duplicate confirmation is fenced before start resolves and form edits cannot redirect the active job', async t => {
  const start = deferred(), starts = [], polls = [], cancels = []
  const ui = await launcherHarness({ startRun: request => { starts.push(request); return start.promise },
    runStatus: async request => { polls.push(request); return ok(snapshot()) }, cancelRun: async request => { cancels.push(request); return ok(snapshot({ status: 'cancelling' })) } })
  t.after(() => ui.unmount())
  ui.button('预览执行计划').onClick(); await tick(); ui.render()
  const confirm = ui.button('确认执行')
  confirm.onClick(); confirm.onClick(); ui.render()
  assert.equal(starts.length, 1)
  ui.update({ task: 'different task', mode: 'single', planningRevision: 'new revision', packageAssignments: { another: { kind: 'tool', toolId: 'codex' } } })
  start.resolve(ok(snapshot()))
  await tick(); ui.render(); await ui.advance(1000)
  assert.equal(starts.length, 1)
  assert.equal(starts[0].task, 'fixture task')
  assert.deepEqual(polls, [{ jobId: 'job-one' }])
  ui.button('取消执行').onClick(); await tick(); ui.render()
  assert.deepEqual(cancels, [{ jobId: 'job-one' }])
})

test('unmount clears polling without cancelling and ignores an in-flight status response', async () => {
  const pending = deferred(), cancelled = []
  let polls = 0
  const ui = await launcherHarness({ runStatus: () => { polls += 1; return pending.promise }, cancelRun: request => { cancelled.push(request); return Promise.resolve(ok(snapshot())) } })
  await ui.start(); await ui.advance(1000)
  ui.unmount()
  assert.equal(ui.timerCount(), 0)
  pending.resolve(ok(snapshot({ status: 'completed', result: { status: 'completed', runId: 'late' } })))
  await tick()
  assert.equal(ui.timerCount(), 0)
  assert.equal(ui.lateUpdates(), 0)
  assert.equal(polls, 1)
  assert.deepEqual(cancelled, [])
})

test('a snapshot for another job is rejected and retried without replacing the active job', async t => {
  const cancelled = []
  const ui = await launcherHarness({ runStatus: async () => ok(snapshot({ jobId: 'unrelated', status: 'completed', result: { status: 'completed' } })),
    cancelRun: async request => { cancelled.push(request); return ok(snapshot({ status: 'cancelling' })) } })
  t.after(() => ui.unmount())
  await ui.start(); await ui.advance(1000)
  assert.match(ui.text(), /将自动重试/)
  assert.equal(ui.button('取消执行').disabled, false)
  ui.button('取消执行').onClick(); await tick(); ui.render()
  assert.deepEqual(cancelled, [{ jobId: 'job-one' }])
})

test('immediately terminal jobs and old synchronous responses retain their final result contract', async t => {
  for (const value of [snapshot({ status: 'failed', result: { status: 'partial', runId: 'immediate' } }), { status: 'completed', runId: 'legacy' }]) {
    const finished = []
    const ui = await launcherHarness({ startRun: async () => ok(value), onStarted: id => finished.push(id) })
    t.after(() => ui.unmount())
    await ui.start()
    assert.match(ui.text(), value.jobId ? /部分步骤失败/ : /执行完成/)
    assert.deepEqual(finished, [value.result?.runId ?? value.runId])
    assert.equal(ui.timerCount(), 0)
  }
})

test('reopening restores only the stored job ID without resubmitting task data and retains cancellation', async t => {
  const storage = new Map(), polls = [], cancels = []
  let starts = 0
  const original = await launcherHarness({ storage, startRun: async () => { starts += 1; return ok(snapshot()) } })
  await original.start()
  assert.deepEqual([...storage], [['dsh-model-router:active-run-job', 'job-one']], 'only the opaque ID enters browser storage')
  original.unmount()
  assert.equal(storage.size, 1, 'closing the workbench leaves the ID available for recovery')
  const restored = await launcherHarness({ storage, task: '', startRun: async () => { starts += 1; return ok(snapshot()) },
    runStatus: async request => { polls.push(request); return ok(snapshot()) },
    cancelRun: async request => { cancels.push(request); return ok(snapshot({ status: 'cancelled', result: { status: 'cancelled', runId: 'restored' } })) } })
  t.after(() => restored.unmount())
  restored.render()
  assert.match(restored.text(), /正在恢复执行进度/)
  assert.equal(restored.button('取消执行').disabled, false, 'a blank replacement form cannot disable cancellation')
  await restored.advance(0)
  assert.match(restored.text(), /当前工作包：检查输入/)
  assert.deepEqual(polls, [{ jobId: 'job-one' }])
  assert.equal(starts, 1)
  restored.button('取消执行').onClick(); await tick(); restored.render()
  assert.match(restored.text(), /已取消/)
  assert.deepEqual(cancels, [{ jobId: 'job-one' }])
  assert.equal(storage.size, 0, 'the ID is removed only after a confirmed terminal response')
})

test('an expired or unknown restored ID gives explicit history guidance and never starts a replacement job', async t => {
  const storage = new Map([['dsh-model-router:active-run-job', 'expired-job']]), polls = []
  let starts = 0
  const ui = await launcherHarness({ storage, startRun: async () => { starts += 1; return ok(snapshot()) },
    runStatus: async request => { polls.push(request); return ok({ ok: false, error: 'Unknown run job id.' }) } })
  t.after(() => ui.unmount())
  ui.render(); await ui.advance(0)
  assert.match(ui.text(), /无法找到此前的执行，可能已过期或工作台已重新启动/)
  assert.match(ui.text(), /刷新下方执行记录核对结果/)
  assert.equal(starts, 0)
  assert.equal(ui.timerCount(), 0)
  assert.equal(storage.size, 0)
  assert.deepEqual(polls, [{ jobId: 'expired-job' }])
  assert.equal(ui.button('预览执行计划').disabled, false)
})

test('recovery transport failure retains the saved ID and cancellation, then retries the same job', async t => {
  const storage = new Map([['dsh-model-router:active-run-job', 'job-one']]), polls = [], cancels = []
  const ui = await launcherHarness({ storage, runStatus: async request => { polls.push(request); return polls.length === 1 ? Promise.reject(new Error('offline')) : ok(snapshot()) },
    cancelRun: async request => { cancels.push(request); return ok(snapshot({ status: 'cancelling', cancelRequested: true })) } })
  t.after(() => ui.unmount())
  ui.render(); await ui.advance(0)
  assert.match(ui.text(), /将自动重试；任务可能仍在执行/)
  assert.equal(ui.storage.get('dsh-model-router:active-run-job'), 'job-one')
  assert.equal(ui.button('取消执行').disabled, false)
  await ui.advance(1000)
  assert.match(ui.text(), /当前工作包：检查输入/)
  assert.deepEqual(polls, [{ jobId: 'job-one' }, { jobId: 'job-one' }])
  ui.button('取消执行').onClick(); await tick(); ui.render()
  assert.deepEqual(cancels, [{ jobId: 'job-one' }])
})

test('closing while the launch ACK is pending still retains the returned live job for recovery', async () => {
  const started = deferred(), storage = new Map()
  const ui = await launcherHarness({ storage, startRun: () => started.promise })
  ui.button('预览执行计划').onClick(); await tick(); ui.render()
  ui.button('确认执行').onClick(); ui.render()
  ui.unmount()
  started.resolve(ok(snapshot()))
  await tick()
  assert.equal(ui.lateUpdates(), 0)
  assert.deepEqual([...storage], [['dsh-model-router:active-run-job', 'job-one']])
})

test('reopening before the launch ACK blocks duplicate launches and takes over polling and cancellation', async t => {
  const started = deferred(), starts = [], polls = [], cancels = []
  const ui = await launcherHarness({ startRun: request => { starts.push(request); return started.promise },
    runStatus: async request => { polls.push(request); return ok(snapshot()) },
    cancelRun: async request => { cancels.push(request); return ok(snapshot({ status: 'cancelled', result: { status: 'cancelled', runId: 'reopened' } })) } })
  t.after(() => ui.unmount())
  ui.button('预览执行计划').onClick(); await tick(); ui.render()
  const confirm = ui.button('确认执行')
  confirm.onClick(); ui.render()
  ui.unmount(); ui.remount()
  assert.match(ui.text(), /正在等待已确认任务的启动结果/)
  assert.equal(ui.button('预览执行计划').disabled, true)
  ui.button('预览执行计划').onClick(); confirm.onClick(); await tick(); ui.render()
  assert.equal(starts.length, 1)
  assert.equal(ui.storage.size, 0, 'an unacknowledged launch has no job ID to persist')
  started.resolve(ok(snapshot()))
  await tick(); ui.render(); await ui.advance(0)
  assert.match(ui.text(), /当前工作包：检查输入/)
  assert.deepEqual(polls, [{ jobId: 'job-one' }])
  assert.deepEqual([...ui.storage], [['dsh-model-router:active-run-job', 'job-one']])
  ui.button('取消执行').onClick(); await tick(); ui.render()
  assert.match(ui.text(), /已取消/)
  assert.deepEqual(cancels, [{ jobId: 'job-one' }])
  assert.equal(starts.length, 1)
  assert.equal(ui.lateUpdates(), 0)
  assert.equal(ui.timerCount(), 0)
  assert.equal(ui.storage.size, 0)
})

test('a launch failure after reopening releases the pending lock and allows an explicit retry', async t => {
  const started = deferred()
  let starts = 0
  const ui = await launcherHarness({ startRun: () => ++starts === 1 ? started.promise : Promise.resolve(ok(snapshot())) })
  t.after(() => ui.unmount())
  await ui.start(); ui.unmount(); ui.remount()
  started.reject(new Error('fixture launch offline'))
  await tick(); ui.render()
  assert.match(ui.text(), /fixture launch offline/)
  assert.equal(ui.button('预览执行计划').disabled, false)
  assert.equal(starts, 1, 'recovery must never retry a failed launch automatically')
  await ui.start()
  assert.equal(starts, 2)
  assert.match(ui.text(), /当前工作包：检查输入/)
  assert.equal(ui.lateUpdates(), 0)
})

test('a terminal launch ACK after reopening refreshes history once and releases the pending lock', async t => {
  const started = deferred(), finished = []
  const ui = await launcherHarness({ startRun: () => started.promise, onStarted: id => finished.push(id) })
  t.after(() => ui.unmount())
  await ui.start(); ui.unmount(); ui.remount()
  started.resolve(ok(snapshot({ status: 'completed', result: { status: 'completed', runId: 'finished-before-ack' } })))
  await tick(); ui.render()
  assert.match(ui.text(), /执行完成/)
  assert.deepEqual(finished, ['finished-before-ack'])
  assert.equal(ui.button('预览执行计划').disabled, false)
  assert.equal(ui.storage.size, 0)
  assert.equal(ui.timerCount(), 0)
  assert.equal(ui.lateUpdates(), 0)
})

test('preparation, integration, review and saving stages use readable progress text', async t => {
  for (const [stage, expected] of [['starting', '正在启动任务'], ['preparing', '正在准备执行计划'], ['integrating', '正在整合工作包结果'], ['reviewing', '正在检查执行结果'], ['saving', '正在保存执行记录']]) {
    const ui = await launcherHarness({ startRun: async () => ok(snapshot({ progress: { total: 0, completed: 0, current: null, stage, packages: [] } })) })
    t.after(() => ui.unmount())
    await ui.start()
    assert.ok(ui.text().includes(expected))
  }
})

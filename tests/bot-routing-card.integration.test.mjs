import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'

const parent = resolve('tmp/integration/bot-routing-card'); await mkdir(parent, { recursive: true })
const directory = await mkdtemp(join(parent, 'components-')), file = join(directory, 'panels.mjs')
const bundle = await build({ entryPoints: ['apps/integration-client/panels.jsx'], bundle: true, platform: 'node', format: 'esm',
  external: ['react', 'react-dom', 'react-dom/*'], write: false })
await writeFile(file, bundle.outputFiles[0].contents)
const { Tasks, ProductPage } = await import(pathToFileURL(file))

const candidate = { botId: 'worker', name: '写作 Bot', model: { provider: 'fixture', model: 'shared' },
  pricePerMTokUsd: 1, quality: null, machineId: null, machineOnline: false, busy: false }
const view = () => ({ enabled: true, preset: 'balanced', settingsRevision: 1, autoGrant: { machineTools: false, cliTools: false }, candidates: [{ ...candidate }] })
const decision = () => ({ chosen: { botId: 'worker', name: '写作 Bot', score: 0.3 }, preset: 'balanced', pinned: false,
  ranked: [{ ...candidate, score: 0.3 }], rejected: [], binding: null, grant: null })
const snapshot = { tasks: { status: 'available', items: [], plans: [] }, bots: [{ id: 'worker', name: '写作 Bot' }],
  mainBotId: 'main', machines: { items: [] }, availableActions: ['botRoutingInspect', 'botRouting.status'] }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture(handler) {
  const calls = []
  return { calls, dispatch: async (action, payload) => {
    calls.push({ action, payload: structuredClone(payload) })
    if (handler) { const result = handler(action, payload); if (result !== undefined) return result }
    if (action === 'botRoutingInspect') return view()
    if (action === 'botRoutingDecide') return decision()
    if (action === 'botRouting.dispatch') return { accepted: true, planId: 'plan-confirmed', taskId: 'plan-confirmed', packages: [{ taskId: 'child', state: 'ready' }] }
    throw new Error(`Unexpected fixture action: ${action}`)
  } }
}
async function withDom(work) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://routing.fixture/' })
  const replacements = { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const { createRoot } = await import('react-dom/client'), container = document.getElementById('root'), root = createRoot(container)
  const mount = async (f, busy = false) => act(async () => { root.render(React.createElement(Tasks, { snapshot, dispatch: f.dispatch, busy, submissionScope: f })); await new Promise(setImmediate) })
  const remount = async f => { await act(async () => root.render(null)); await mount(f) }
  const mountPage = async api => act(async () => { root.render(React.createElement(ProductPage, { section: 'tasks', productApi: api })); await new Promise(setImmediate) })
  const button = label => [...container.querySelectorAll('button')].find(element => element.textContent.trim() === label)
  const click = async label => { const element = button(label); assert.ok(element, `button exists: ${label}`); await act(async () => { element.click(); await new Promise(setImmediate) }) }
  const type = async text => act(async () => {
    const input = container.querySelector('textarea')
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, text)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  const pasteCode = async text => act(async () => {
    const input = container.querySelector('input[aria-label="已保存的提交核对码"]')
    assert.ok(input, 'saved-code input exists')
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, text)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  const choose = async (label, value) => act(async () => {
    const select = [...container.querySelectorAll('label')].find(element => element.textContent.startsWith(label))?.querySelector('select')
    assert.ok(select, `select exists: ${label}`)
    select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
  const settle = async (pending, method, value) => act(async () => { pending[method](value); await new Promise(setImmediate) })
  try { await work({ container, mount, remount, mountPage, button, click, type, pasteCode, choose, settle, dom }) }
  finally {
    await act(async () => root.unmount()); dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  }
}

test('routing card: an edited task retires its delayed preview without enabling dispatch', async () => {
  await withDom(async ({ container, mount, button, click, type, settle }) => {
    const pending = deferred(), f = fixture(action => action === 'botRoutingDecide' ? pending.promise : undefined)
    await mount(f); await type('旧任务'); await click('预览路由'); await type('新任务')
    await settle(pending, 'resolve', decision())
    assert.doesNotMatch(container.textContent, /选中：写作 Bot/)
    assert.equal(Boolean(button('按此路由创建任务')), false)
    assert.equal(f.calls.filter(call => call.action === 'botRouting.dispatch').length, 0)
  })
})

test('routing card: rapid preview clicks launch only one request before React commits state', async () => {
  await withDom(async ({ mount, button, type, settle }) => {
    const pending = deferred(), f = fixture(action => action === 'botRoutingDecide' ? pending.promise : undefined)
    await mount(f); await type('同一个任务')
    await act(async () => { const target = button('预览路由'); target.click(); target.click() })
    assert.equal(f.calls.filter(call => call.action === 'botRoutingDecide').length, 1)
    await settle(pending, 'resolve', decision())
  })
})

test('routing card: a confirmed submission shows its real plan ID and cannot be created twice', async () => {
  await withDom(async ({ container, mount, button, click, type, settle }) => {
    const pending = deferred(), f = fixture(action => action === 'botRouting.dispatch' ? pending.promise : undefined)
    await mount(f); await type('需要预览的任务'); await click('预览路由')
    await act(async () => { const target = button('按此路由创建任务'); target.click(); target.click() })
    const submitted = f.calls.filter(call => call.action === 'botRouting.dispatch')
    assert.equal(submitted.length, 1)
    assert.equal(submitted[0].payload.text, '需要预览的任务')
    assert.ok(submitted[0].payload.requestKey)
    await settle(pending, 'resolve', { accepted: true, planId: 'plan-real-123', packages: [{ taskId: 'child', state: 'ready' }] })
    assert.match(container.textContent, /已提交：plan-real-123/)
    const create = button('按此路由创建任务')
    assert.ok(!create || create.disabled)
    await type('另一项任务')
    assert.doesNotMatch(container.textContent, /已提交：plan-real-123/)
  })
})

test('routing card: an incomplete submission acknowledgement stays unknown without replay', async () => {
  await withDom(async ({ container, mount, button, click, type }) => {
    const f = fixture(action => action === 'botRouting.dispatch' ? {} : undefined)
    await mount(f); await type('结果待核对的任务'); await click('预览路由'); await click('按此路由创建任务')
    assert.doesNotMatch(container.textContent, /已提交：/)
    assert.match(container.textContent, /提交结果尚未确认/)
    assert.equal(Boolean(button('按此路由创建任务')), false)
    assert.equal(f.calls.filter(call => call.action === 'botRouting.dispatch').length, 1)
  })
})

test('routing card: refreshing candidates invalidates the old preview before the read settles', async () => {
  await withDom(async ({ container, mount, button, click, type, settle }) => {
    const pending = deferred(); let reads = 0
    const f = fixture(action => action === 'botRoutingInspect' && ++reads > 1 ? pending.promise : undefined)
    await mount(f); await type('候选可能变化'); await click('预览路由'); await click('刷新候选')
    assert.equal(Boolean(button('按此路由创建任务')), false)
    assert.doesNotMatch(container.textContent, /选中：写作 Bot/)
    await settle(pending, 'resolve', view())
    assert.equal(f.calls.filter(call => call.action === 'botRouting.dispatch').length, 0)
  })
})

test('routing card: a replaced host cannot receive or display the previous host preview', async () => {
  await withDom(async ({ container, mount, button, click, type, settle }) => {
    const pending = deferred(), old = fixture(action => action === 'botRoutingDecide' ? pending.promise : undefined), next = fixture()
    await mount(old); await type('原宿主任务'); await click('预览路由'); await mount(next)
    await settle(pending, 'resolve', decision())
    assert.equal(Boolean(button('按此路由创建任务')), false)
    assert.doesNotMatch(container.textContent, /选中：写作 Bot/)
    assert.equal(next.calls.filter(call => call.action === 'botRoutingInspect').length, 1)
    assert.equal(next.calls.filter(call => call.action === 'botRouting.dispatch').length, 0)
  })
})

test('routing card: comparison explains unknown quality, rejected Bots and disabled automatic grants', async () => {
  await withDom(async ({ container, mount, click, type }) => {
    const f = fixture(action => action === 'botRoutingDecide' ? { ...decision(), rejected: [{ botId: 'busy', reason: 'BOT_BUSY' }],
      binding: { mode: 'read-only', tools: ['machine_ping', 'fs_read'] }, grant: { required: true, applied: false, autoGrant: false } } : undefined)
    await mount(f); await type('比较候选'); await click('预览路由')
    const preview = container.querySelector('[aria-label="路由预览结果"]')
    assert.ok(preview)
    assert.match(preview.textContent, /查看比较依据/)
    assert.match(preview.textContent, /综合评分/)
    assert.match(preview.textContent, /未知质量按中间值/)
    assert.match(preview.textContent, /正在处理其他任务/)
    assert.match(preview.textContent, /自动授权已关闭/)
    assert.doesNotMatch(preview.textContent, /将授予/)
    assert.equal(f.calls.filter(call => call.action === 'botRouting.dispatch').length, 0)
  })
})

test('routing card: the replacement Host is inspected once its parent read becomes writable', async () => {
  await withDom(async ({ mount, button }) => {
    const old = fixture(), next = fixture()
    await mount(old); await mount(next, true); await mount(next, false)
    assert.equal(next.calls.filter(call => call.action === 'botRoutingInspect').length, 1)
    assert.ok(button('刷新候选'))
    assert.equal(next.calls.filter(call => call.action === 'botRouting.dispatch').length, 0)
  })
})

test('routing card: a preview started in the input event batch captures the latest task', async () => {
  await withDom(async ({ container, mount, button, type, dom }) => {
    const f = fixture(); await mount(f); await type('修改前')
    await act(async () => {
      const input = container.querySelector('textarea')
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, '修改后')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      button('预览路由').click()
      await new Promise(setImmediate)
    })
    assert.equal(f.calls.find(call => call.action === 'botRoutingDecide').payload.text, '修改后')
    assert.equal(f.calls.filter(call => call.action === 'botRouting.dispatch').length, 0)
  })
})

test('routing card: a failed candidate refresh disables old controls until a successful read', async () => {
  await withDom(async ({ container, mount, button, click, type }) => {
    let reads = 0
    const f = fixture(action => action === 'botRoutingInspect' && ++reads === 2 ? Promise.reject(new Error('候选读取离线')) : undefined)
    await mount(f); await type('保留任务'); await click('预览路由'); await click('刷新候选')
    assert.match(container.textContent, /候选读取离线/)
    assert.equal(Boolean(button('按此路由创建任务')), false)
    assert.equal(button('预览路由').disabled, true)
    await click('刷新候选')
    assert.equal(button('预览路由').disabled, false)
    assert.equal(container.querySelector('textarea').value, '保留任务')
    assert.doesNotMatch(container.textContent, /候选读取离线/)
    assert.equal(f.calls.filter(call => call.action === 'botRouting.dispatch').length, 0)
  })
})

test('routing card: a manual selection explains eligibility and dispatches the previewed pin', async () => {
  await withDom(async ({ container, mount, click, type, choose }) => {
    const f = fixture(action => action === 'botRoutingDecide' ? { ...decision(), pinned: true, ranked: [] } : undefined)
    await mount(f); await type('指定给写作 Bot'); await choose('路由方式', 'worker'); await click('预览路由')
    const preview = container.querySelector('[aria-label="路由预览结果"]')
    assert.match(preview.textContent, /手动指定/)
    assert.equal(Boolean(preview.querySelector('[aria-label="候选比较"]')), false)
    await click('按此路由创建任务')
    assert.equal(f.calls.find(call => call.action === 'botRouting.dispatch').payload.pinnedBotId, 'worker')
  })
})

test('routing card: a lost acknowledgement keeps the original key and can find its plan without another submission', async () => {
  await withDom(async ({ container, mount, button, click, type }) => {
    const f = fixture(action => action === 'botRouting.dispatch' ? Promise.reject(new Error('响应丢失'))
      : action === 'botRouting.status' ? { found: true, accepted: true, originBotId: 'main', planId: 'original-plan', planState: 'running', packages: [] } : undefined)
    await mount(f); await type('不可重复创建的任务'); await click('预览路由'); await click('按此路由创建任务')
    assert.ok(button('核对原提交'))
    await click('核对原提交')
    const created = f.calls.find(call => call.action === 'botRouting.dispatch'), checked = f.calls.find(call => call.action === 'botRouting.status')
    assert.deepEqual(checked.payload, { requestKey: created.payload.requestKey, requesterBotId: created.payload.requesterBotId })
    assert.match(container.textContent, /已提交：original-plan/)
    assert.match(container.textContent, /执行中/)
    assert.equal(f.calls.filter(call => call.action === 'botRouting.dispatch').length, 1)
  })
})

test('routing card: an unknown submission survives draft edits, candidate refresh and same-Host page remount', async () => {
  await withDom(async ({ container, mount, remount, button, click, type }) => {
    const f = fixture(action => action === 'botRouting.dispatch' ? {} : action === 'botRouting.status'
      ? { found: false, originBotId: 'main', planId: 'not-yet-visible', planState: null, packages: [] } : undefined)
    await mount(f); await type('保留核对身份'); await click('预览路由'); await click('按此路由创建任务')
    await click('刷新候选'); await type('编辑也不能抹掉未知提交')
    await remount(f)
    assert.ok(button('核对原提交'))
    await click('核对原提交')
    assert.match(container.textContent, /尚未查到原提交/)
    assert.match(container.textContent, /仍可能完成/)
    assert.equal(f.calls.filter(call => call.action === 'botRouting.dispatch').length, 1)
    assert.equal(Boolean(button('按此路由创建任务')), false)
  })
})

test('routing card: pending submission references stay scoped to their original Host', async () => {
  await withDom(async ({ container, mount, button, click, type }) => {
    const original = fixture(action => action === 'botRouting.dispatch' ? {} : undefined), other = fixture()
    await mount(original); await type('原宿主未知提交'); await click('预览路由'); await click('按此路由创建任务')
    await mount(other)
    assert.equal(Boolean(button('核对原提交')), false)
    assert.doesNotMatch(container.textContent, /提交结果尚未确认/)
    await mount(original)
    assert.ok(button('核对原提交'))
    assert.equal(other.calls.filter(call => call.action === 'botRouting.status').length, 0)
  })
})

test('routing card: a late original acknowledgement confirms its saved submission after page remount', async () => {
  await withDom(async ({ container, mount, remount, button, click, type, settle }) => {
    const original = deferred(), lookup = deferred()
    const f = fixture(action => action === 'botRouting.dispatch' ? original.promise : action === 'botRouting.status' ? lookup.promise : undefined)
    await mount(f); await type('原响应迟到'); await click('预览路由'); await click('按此路由创建任务')
    await remount(f); await click('核对原提交')
    await settle(original, 'resolve', { accepted: true, planId: 'late-original-plan', planState: 'running' })
    await settle(lookup, 'resolve', { found: false, originBotId: 'main', planId: 'not-yet-visible', packages: [] })
    assert.match(container.textContent, /已提交：late-original-plan/)
    assert.doesNotMatch(container.textContent, /尚未查到原提交/)
    assert.equal(f.calls.filter(call => call.action === 'botRouting.dispatch').length, 1)
    assert.equal(Boolean(button('按此路由创建任务')), false)
  })
})

test('routing card: a failed or wrong-origin lookup keeps the original identity and never permits replay', async () => {
  await withDom(async ({ container, mount, button, click, type }) => {
    let checks = 0
    const f = fixture(action => action === 'botRouting.dispatch' ? {} : action === 'botRouting.status'
      ? ++checks === 1 ? Promise.reject(new Error('database offline')) : { found: true, accepted: true, originBotId: 'other', planId: 'wrong', packages: [] } : undefined)
    await mount(f); await type('仍需核对'); await click('预览路由'); await click('按此路由创建任务')
    await click('核对原提交')
    assert.match(container.textContent, /原提交核对尚未完成/)
    await click('核对原提交')
    assert.match(container.textContent, /原提交身份不一致/)
    assert.doesNotMatch(container.textContent, /已提交：wrong|尚未查到原提交/)
    assert.deepEqual(f.calls.filter(call => call.action === 'botRouting.status').map(call => call.payload.requestKey),
      [f.calls.find(call => call.action === 'botRouting.dispatch').payload.requestKey, f.calls.find(call => call.action === 'botRouting.dispatch').payload.requestKey])
    assert.equal(Boolean(button('按此路由创建任务')), false)
    assert.equal(f.calls.filter(call => call.action === 'botRouting.dispatch').length, 1)
  })
})

test('routing card: only an explicit dismissal after a missing-record read clears its reminder without resubmitting', async () => {
  await withDom(async ({ container, mount, button, click, type }) => {
    const f = fixture(action => action === 'botRouting.dispatch' ? {} : action === 'botRouting.status'
      ? { found: false, originBotId: 'main', planId: 'not-yet-visible', packages: [] } : undefined)
    await mount(f); await type('已自行核对的任务'); await click('预览路由'); await click('按此路由创建任务')
    assert.equal(Boolean(button('清除本窗口提醒')), false)
    await click('核对原提交')
    assert.match(container.textContent, /清除提醒不会停止原任务/)
    await click('清除本窗口提醒')
    assert.equal(Boolean(button('核对原提交')), false)
    assert.equal(Boolean(button('按此路由创建任务')), false)
    assert.equal(f.calls.filter(call => call.action === 'botRouting.dispatch').length, 1)
  })
})

test('routing card: an in-flight submission exposes a reference-only code even while the Host is busy', async () => {
  await withDom(async ({ container, mount, button, click, type, settle }) => {
    const pending = deferred(), f = fixture(action => action === 'botRouting.dispatch' ? pending.promise : undefined)
    await mount(f); await type('不可进入核对码的私密任务正文'); await click('预览路由'); await click('按此路由创建任务')
    await mount(f, true)
    const code = container.querySelector('input[aria-label="当前提交核对码"]')
    assert.ok(code?.readOnly)
    const request = f.calls.find(call => call.action === 'botRouting.dispatch').payload
    assert.equal(code.value, `dsh-route-v1:main:${request.requestKey}`)
    assert.doesNotMatch(code.value, /私密|text|credential|plan/)
    assert.equal(button('复制核对码').disabled, false)
    await click('复制核对码')
    assert.match(container.textContent, /手动复制|已复制/)
    await settle(pending, 'resolve', {})
    assert.equal(f.calls.filter(call => call.action === 'botRouting.dispatch').length, 1)
  })
})

test('routing card: a saved code in a fresh connection only queries the original identity once', async () => {
  await withDom(async ({ container, mount, button, pasteCode, settle }) => {
    const pending = deferred(), f = fixture(action => action === 'botRouting.status' ? pending.promise : undefined)
    await mount(f); await pasteCode('dsh-route-v1:old-main:original-key')
    await act(async () => { const target = button('核对已保存的提交'); assert.ok(target); target.click(); target.click() })
    assert.deepEqual(f.calls.filter(call => call.action === 'botRouting.status').map(call => call.payload), [{ requesterBotId: 'old-main', requestKey: 'original-key' }])
    await settle(pending, 'resolve', { found: true, accepted: true, originBotId: 'old-main', planId: 'saved-original', planState: 'succeeded', packages: [] })
    assert.match(container.textContent, /已提交：saved-original/)
    assert.match(container.textContent, /已完成/)
    assert.equal(f.calls.filter(call => call.action === 'botRouting.dispatch').length, 0)
    assert.equal(container.querySelector('input[aria-label="当前提交核对码"]').value, 'dsh-route-v1:old-main:original-key')
    assert.equal(Boolean(button('按此路由创建任务')), false)
  })
})

test('routing card: invalid saved codes stay local and a Host replacement clears an unsubmitted code', async () => {
  await withDom(async ({ container, mount, click, pasteCode }) => {
    const original = fixture(), other = fixture()
    await mount(original); await pasteCode('dsh-route-v9:main:key'); await click('核对已保存的提交')
    assert.match(container.textContent, /核对码格式无效或版本不支持/)
    assert.equal(original.calls.filter(call => call.action === 'botRouting.status').length, 0)
    await pasteCode('dsh-route-v1:main:private-reference'); await mount(other)
    assert.equal(container.querySelector('input[aria-label="已保存的提交核对码"]').value, '')
    assert.equal(other.calls.filter(call => call.action === 'botRouting.status').length, 0)
  })
})

test('routing card: owner, unavailable-feature and mismatched-record failures give distinct next steps without dispatch', async () => {
  for (const [code, message] of [['REMOTE_OWNER_REQUIRED', /重新登录宿主拥有者账号/],
    ['BOT_ROUTING_STATUS_UNAVAILABLE', /当前宿主尚不支持原提交核对/], ['BOT_ROUTING_SUBMISSION_IDENTITY_MISMATCH', /原提交身份不一致/]]) {
    await withDom(async ({ container, mount, click, pasteCode }) => {
      const f = fixture(action => action === 'botRouting.status' ? { ok: false, error: { code, message: 'technical failure' } } : undefined)
      await mount(f); await pasteCode('dsh-route-v1:main:key'); await click('核对已保存的提交')
      assert.match(container.textContent, message)
      assert.equal(container.querySelector('input[aria-label="当前提交核对码"]').value, 'dsh-route-v1:main:key')
      assert.equal(f.calls.filter(call => call.action === 'botRouting.dispatch').length, 0)
    })
  }
})

test('routing card: the actual product page preserves a failed owner lookup code for its actionable message', async () => {
  await withDom(async ({ container, mountPage, click, pasteCode }) => {
    const calls = [], api = { snapshot: async () => ({ ...snapshot, schemaVersion: 1, readOnly: null }),
      dispatch: async (action, payload) => {
        calls.push({ action, payload })
        if (action === 'botRoutingInspect') return view()
        throw Object.assign(new Error('REMOTE_OWNER_REQUIRED'), { code: 'REMOTE_OWNER_REQUIRED' })
      } }
    await mountPage(api); await pasteCode('dsh-route-v1:main:from-before-reload'); await click('核对已保存的提交')
    assert.match(container.textContent, /重新登录宿主拥有者账号/)
    assert.equal(calls.filter(call => call.action === 'botRouting.status').length, 1)
    assert.equal(calls.filter(call => call.action === 'botRouting.dispatch').length, 0)
  })
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { build, transform } from 'esbuild'

const parent = resolve('tmp/integration/native-activity-ui')
await mkdir(parent, { recursive: true })
const directory = await mkdtemp(join(parent, 'surface-')), output = join(directory, 'activity.mjs')
const bundle = await build({ entryPoints: ['apps/integration-client/native-activity.jsx'], bundle: true, platform: 'node', format: 'esm', external: ['react', 'react-dom', 'react-dom/*'], write: false, loader: { '.css': 'text' } })
await writeFile(output, bundle.outputFiles[0].contents)
const { NativeActivityCard, NativeActivityCardView, NativeActivityHeader } = await import(pathToFileURL(output))

const botId = 'bot-a', sessionId = 'bot-a:part-7', contextId = 'ctx-9f2'
const now = 1_700_000_000_000
const conversation = 'host-1'
const record = (patch = {}) => {
  const { phase, outcome, ok, ...fields } = patch
  const state = fields.state ?? (phase !== 'completed' && !Number.isSafeInteger(fields.endedAt) ? 'running'
    : ['unknown', 'host-closed', 'host-lost', 'cancelled', 'refused'].includes(outcome) ? 'turn-unconfirmed'
    : outcome === 'succeeded' || ok === true ? 'cli-ok' : outcome === 'failed' || ok === false ? 'cli-error' : 'turn-unconfirmed')
  const startedAt = fields.startedAt ?? 1_700_000_000_000
  return { schemaVersion: 1, callKey: 'call-1', callId: fields.callKey ?? 'call-1', botId,
    mode: 'integration', conversationId: conversation, contextId: null, processGeneration: 'native-fixture', turnId: 't-1',
    toolName: 'Read', toolNameRecorded: true, callIdRecorded: true, toolNameTruncated: false, redacted: false,
    cliOk: state === 'cli-ok' ? true : state === 'cli-error' ? false : null,
    turnOutcome: outcome ?? null, turnSettled: outcome != null,
    startedAt, endedAt: state === 'running' ? null : startedAt + 1, updatedAt: state === 'running' ? startedAt : startedAt + 1,
    cancelRequested: false, stopConfirmed: false, lateCliReturn: false, lateCliOk: null,
    duplicateStarts: 0, duplicateCompletions: 0, ...fields, state }
}
const rescope = (items, scope) => items.map(row => ({ ...row, botId: scope.botId, mode: scope.mode,
  conversationId: scope.conversationId, contextId: scope.contextId }))
const integrationPage = (items, patch = {}) => {
  const scope = { botId, mode: 'integration', conversationId: conversation, contextId: null, sessionId }
  return { schemaVersion: 1, scope, items: rescope(items, scope), nextCursor: null,
    nativeRoute: true, recording: { status: 'ready', failures: 0 }, ...patch }
}
const cardPage = (items, patch = {}, id = contextId) => {
  const scope = { botId, mode: 'independent', conversationId: id, contextId: id, sessionId: null }
  return { schemaVersion: 1, scope, items: rescope(items, scope), nextCursor: null,
    nativeRoute: true, recording: { status: 'ready', failures: 0 }, ...patch }
}

async function withDom(work) {
  const dom = new JSDOM('<!doctype html><html><body data-bot-product-ui="1"><div id="root"></div></body></html>', { url: 'http://activity.fixture/' })
  const replacements = { window: dom.window, document: dom.window.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const { createRoot } = await import('react-dom/client'), container = document.getElementById('root'), root = createRoot(container)
  const settle = async job => act(async () => { await job(); await new Promise(setImmediate) })
  const render = element => settle(() => root.render(element))
  const flush = async () => { for (let n = 0; n < 6; n++) await settle(() => {}) }
  const click = async selector => {
    const element = container.querySelector(selector)
    assert.ok(element, selector)
    await settle(() => element.click())
  }
  const key = async (element, name) => settle(() => element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })))
  try { await work({ container, dom, settle, render, flush, click, key }) }
  finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}

const apiFor = (items, patch = {}) => {
  const calls = []
  return { calls, dispatch: async (action, payload, signal) => { calls.push({ action, payload, signal }); return integrationPage(items, patch) } }
}

test('the integrated header shows the real running step and opens an anchored detail dialog', async t => {
  await withDom(async ({ render, container, flush, click, key }) => {
    const items = [record({ callKey: 'call-run', toolName: 'Bash' }), record({ callKey: 'call-ok', toolName: 'Grep', phase: 'completed', outcome: 'succeeded', startedAt: now - 1000 })]
    const api = apiFor(items)
    await render(React.createElement(NativeActivityHeader, { productApi: api, botId, sessionId, enabled: true, pollMs: 100000 }))
    await flush()
    const chip = container.querySelector('.bp-na-chip')
    assert.ok(chip)
    assert.match(chip.getAttribute('aria-label'), /正在进行：运行命令，已读到 2 条/)
    assert.equal(chip.getAttribute('aria-haspopup'), 'dialog')
    assert.equal(chip.getAttribute('aria-expanded'), 'false')
    assert.equal(chip.dataset.state, 'running')
    assert.equal(container.querySelector('[role=status]').textContent, '正在进行：运行命令，共 2 条已读到')
    assert.equal(container.querySelector('.bp-na-dialog'), null)
    await click('.bp-na-chip')
    const dialog = container.querySelector('[role=dialog]')
    assert.ok(dialog)
    assert.equal(dialog.getAttribute('aria-modal'), 'true')
    assert.equal(dialog.getAttribute('aria-label'), '工具记录')
    assert.deepEqual([...container.querySelectorAll('.bp-na-row-title')].map(node => node.textContent), ['运行命令', '搜索内容'])
    assert.deepEqual([...container.querySelectorAll('.bp-na-state')].map(node => node.textContent), ['进行中', '已返回'])
    assert.match(container.querySelector('.bp-na-scope').textContent, /不是全部历史/)
    await key(document.activeElement, 'Escape')
    assert.equal(container.querySelector('[role=dialog]'), null)
    assert.equal(document.activeElement, chip, 'Escape gives the caret back to the chip that opened the dialog')
  })
})

test('a session the Host does not record shows nothing, and a recorded one with no work shows nothing', async t => {
  await withDom(async ({ render, container, flush }) => {
    const silent = { dispatch: async () => integrationPage([], { nativeRoute: false }) }
    await render(React.createElement(NativeActivityHeader, { productApi: silent, botId, sessionId, enabled: true, pollMs: 100000 }))
    await flush()
    assert.equal(container.childElementCount, 0)
    const recorded = { dispatch: async () => integrationPage([], { nativeRoute: true }) }
    await render(React.createElement(NativeActivityHeader, { productApi: recorded, botId, sessionId, enabled: true, pollMs: 100000 }))
    await flush()
    assert.equal(container.childElementCount, 0, 'an empty record is not dressed up as activity')
    const failing = { dispatch: async () => { throw Object.assign(new Error('private storage detail'), { code: 'STORE_READ_FAILED' }) } }
    await render(React.createElement(NativeActivityHeader, { productApi: failing, botId, sessionId, enabled: true, pollMs: 100000 }))
    await flush()
    assert.match(container.querySelector('.bp-na-note').textContent, /读取工具记录失败/)
    assert.doesNotMatch(container.textContent, /private storage detail/)
  })
})

test('the transcript card keeps the four states apart, and a late return never turns unknown green', async t => {
  await withDom(async ({ render, container, flush, click, key }) => {
    const items = [
      record({ callKey: 'call-run', toolName: 'Bash', phase: 'started', params: { command: 'secret-command' } }),
      record({ callKey: 'call-late', toolName: 'Write', phase: 'completed', outcome: 'unknown', lateCliReturn: true, result: { bytes: 12 }, startedAt: now - 500 }),
      record({ callKey: 'call-bad', toolName: 'Read', phase: 'completed', outcome: 'failed', startedAt: now - 900 }),
      record({ callKey: 'call-stop', toolName: 'Grep', phase: 'completed', outcome: 'cancelled', cancelRequested: true, stopConfirmed: true, image: 'data:image/png;base64,AAAA', startedAt: now - 1200 }),
    ]
    const api = { dispatch: async () => cardPage(items) }
    await render(React.createElement(NativeActivityCardView, { activity: null, controller: null }))
    await render(React.createElement(NativeActivityCard, { productApi: api, botId, contextId, enabled: true, pollMs: 100000 }))
    await flush()
    const card = container.querySelector('.bp-na-card')
    assert.ok(card)
    assert.equal(card.getAttribute('aria-label'), '工具记录')
    assert.match(card.textContent, /已读到 4 条/)
    assert.equal(container.querySelector('.bp-na-list'), null, 'the card stays compact until it is opened')
    await click('.bp-na-card-toggle')
    assert.equal(container.querySelector('.bp-na-card-toggle').getAttribute('aria-expanded'), 'true')
    assert.deepEqual([...container.querySelectorAll('.bp-na-row-title')].map(node => node.textContent), ['运行命令', '写入文件', '读取文件', '搜索内容'])
    assert.deepEqual([...container.querySelectorAll('.bp-na-state')].map(node => node.textContent), ['进行中', '待核对', '返回错误', '待核对'])
    const rows = [...container.querySelectorAll('.bp-na-row')]
    assert.equal(rows[1].dataset.state, 'turn-unconfirmed')
    assert.equal(rows[1].textContent.includes('命令返回较晚，结果仍待核对'), true)
    assert.equal(rows[3].textContent.includes('会话进程已停止'), true)
    // Nothing the observation does not carry is shown, invented or hinted at.
    for (const secret of ['secret-command', 'base64,AAAA', 'bytes', 'params', 'result']) assert.equal(container.textContent.includes(secret), false)
    assert.equal(container.querySelector('.bp-na-detail'), null)
    await click('.bp-na-row-more')
    const detail = container.querySelector('.bp-na-detail')
    assert.ok(detail)
    assert.match(detail.textContent, /记录编号/)
    assert.match(detail.textContent, /宿主报告的名称/)
    assert.match(detail.textContent, /不显示命令内容与返回内容/)
    await key(container.querySelector('.bp-na-row-more'), 'Escape')
    assert.equal(container.querySelector('.bp-na-detail'), null)
    assert.equal(document.activeElement, container.querySelector('.bp-na-row-more'), 'Escape returns the caret to the row that opened')
    await key(container.querySelector('.bp-na-card-toggle'), 'Escape')
    assert.equal(container.querySelector('.bp-na-card-body'), null)
    assert.equal(document.activeElement, container.querySelector('.bp-na-card-toggle'))
  })
})

test('a stop request that is not confirmed yet says so, and a confirmed stop says the other thing', async t => {
  await withDom(async ({ render, container, flush, click }) => {
    const api = { dispatch: async () => cardPage([record({ callKey: 'call-asking', toolName: 'Bash', phase: 'started', cancelRequested: true })]) }
    await render(React.createElement(NativeActivityCard, { productApi: api, botId, contextId, enabled: true, pollMs: 100000 }))
    await flush()
    await click('.bp-na-card-toggle')
    const row = container.querySelector('.bp-na-row')
    assert.equal(row.dataset.state, 'running')
    assert.match(row.textContent, /已请求停止会话，进程停止尚未确认/)
    assert.equal(row.textContent.includes('会话进程已停止'), false)
    await click('.bp-na-row-more')
    assert.match(container.querySelector('.bp-na-detail').textContent, /停止请求[\s\S]*已请求/)
    assert.match(container.querySelector('.bp-na-detail').textContent, /进程停止确认[\s\S]*尚未确认/)
  })
})

test('a degraded recording is visible even when nothing has been recorded yet', async t => {
  await withDom(async ({ render, container, flush, click }) => {
    const api = { dispatch: async () => cardPage([], { nativeRoute: true, recording: { status: 'degraded', failures: 4, code: 'STORE_WRITE_FAILED' } }) }
    await render(React.createElement(NativeActivityCard, { productApi: api, botId, contextId, enabled: true, pollMs: 100000 }))
    await flush()
    assert.match(container.querySelector('.bp-na-note').textContent, /工具记录写入异常/)
    assert.doesNotMatch(container.textContent, /STORE_WRITE_FAILED/)
    await click('.bp-na-card-toggle')
    assert.match(container.querySelector('.bp-na-card-body').textContent, /只显示当前已经读到的 0 条记录/)
  })
})

test('a context change retires the previous read and never shows another conversation', async t => {
  await withDom(async ({ render, container, flush }) => {
    const first = { calls: [], dispatch: async (action, payload, signal) => { first.calls.push({ action, payload, signal }); return cardPage([record({ callKey: 'call-first', toolName: 'Bash' })], {}, 'ctx-one') } }
    const view = api => React.createElement(NativeActivityCard, { productApi: api, botId, contextId: 'ctx-one', enabled: true, pollMs: 100000 })
    await render(view(first))
    await flush()
    assert.match(container.querySelector('.bp-na-card').textContent, /已读到 1 条/)
    assert.deepEqual(first.calls.map(row => row.payload.contextId), ['ctx-one'])
    const reads = first.calls.length
    const second = { calls: [], dispatch: async (action, payload, signal) => { second.calls.push({ action, payload, signal }); return cardPage([record({ callKey: 'call-second', toolName: 'Grep' })], {}, 'ctx-one') } }
    await render(view(second))
    await flush()
    assert.equal(first.calls.length, reads, 'the retired controller stops reading for the old context')
    assert.deepEqual(second.calls.map(row => row.payload.contextId), ['ctx-one'])
    assert.equal(second.calls.every(row => 'sessionId' in row.payload), false)
    assert.match(container.querySelector('.bp-na-card').textContent, /搜索内容/)
    assert.equal(container.textContent.includes('运行命令'), false)
  })
})

test('the activity stylesheet keeps the chat tokens and a 375px friendly layout', async () => {
  const css = await readFile('apps/integration-client/native-activity.css', 'utf8')
  const result = await transform(css, { loader: 'css', minify: true })
  assert.deepEqual(result.warnings, [])
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css.replace(/--bp-chat-[a-z-]+:[^;]*;/g, '')), false, 'colour comes from the chat tokens only')
  assert.ok(css.includes('@media (max-width: 480px)'))
  assert.ok(/body\[data-bot-product-ui\] \.bp-na-chip/.test(css), 'the surface stays inside the product chat scope')
  for (const token of ['--bp-chat-ink', '--bp-chat-muted', '--bp-chat-surface', '--bp-chat-inset', '--bp-chat-line', '--bp-chat-accent', '--bp-chat-warning', '--bp-chat-danger', '--bp-chat-focus']) {
    assert.ok(css.includes(`var(${token})`), token)
  }
  assert.ok(css.includes('html body[data-bot-product-ui]'), 'the dark theme inherits from the chat tokens, so both appearances hold')
})

test('an older Host that does not advertise the action is never polled', async () => {
  await withDom(async ({ render, flush, container }) => {
    const calls = []
    const old = { snapshot: async () => ({ schemaVersion: 1, availableActions: [] }), dispatch: async action => { calls.push(action); throw new Error('not available') } }
    await render(React.createElement(NativeActivityHeader, { productApi: old, botId, sessionId }))
    await flush()
    assert.deepEqual(calls, [])
    assert.equal(container.childElementCount, 0)
    const current = { snapshot: async () => ({ schemaVersion: 1, availableActions: ['nativeActivity.list'] }),
      dispatch: async action => { calls.push(action); return integrationPage([record()]) } }
    await render(React.createElement(NativeActivityHeader, { productApi: current, botId, sessionId }))
    await flush()
    assert.deepEqual(calls, ['nativeActivity.list'])
    assert.ok(container.querySelector('.bp-na-chip'))
  })
})

test('the latest-four crop expands to every loaded row without another tool request', async () => {
  await withDom(async ({ render, flush, click, container }) => {
    const rows = Array.from({ length: 7 }, (_unused, index) => record({ callKey: `call-${index}`, startedAt: now - index }))
    let reads = 0
    const api = { dispatch: async () => { reads++; return cardPage(rows) } }
    await render(React.createElement(NativeActivityCard, { productApi: api, botId, contextId, enabled: true, pollMs: 100000 }))
    await flush(); await click('.bp-na-card-toggle')
    assert.equal(container.querySelectorAll('.bp-na-row').length, 4)
    const expand = [...container.querySelectorAll('button')].find(node => node.textContent.includes('查看已读取的'))
    await act(async () => expand.click())
    assert.equal(container.querySelectorAll('.bp-na-row').length, 7)
    assert.equal(reads, 1)
  })
})

test('two surfaces retain their shared stylesheet until the last surface leaves', async () => {
  await withDom(async ({ render, flush }) => {
    const api = apiFor([record()])
    const header = React.createElement(NativeActivityHeader, { key: 'header', productApi: api, botId, sessionId, enabled: true, pollMs: 100000 })
    const card = React.createElement(NativeActivityCard, { key: 'card', productApi: { dispatch: async () => cardPage([record()]) }, botId, contextId, enabled: true, pollMs: 100000 })
    await render(React.createElement(React.Fragment, null, header, card)); await flush()
    assert.equal(document.head.querySelectorAll('style[data-bot-native-activity]').length, 1)
    await render(React.createElement(React.Fragment, null, card)); await flush()
    assert.equal(document.head.querySelectorAll('style[data-bot-native-activity]').length, 1)
    await render(null)
    assert.equal(document.head.querySelectorAll('style[data-bot-native-activity]').length, 0)
  })
})

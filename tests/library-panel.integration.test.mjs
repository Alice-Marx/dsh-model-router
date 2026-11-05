import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import React, { act } from 'react'
import { build } from 'esbuild'
import { createBotLibrary } from '../packages/orchestration/src/bot-library.mjs'
import { createProductReadModel } from '../modules/bot-runtime/read-model.mjs'

const require = createRequire(resolve('tests/fixtures/integration-host/package.json'))
const { JSDOM } = require('jsdom')
const parent = resolve('tmp/integration/library-panel'); fs.mkdirSync(parent, { recursive: true })
const dir = fs.mkdtempSync(join(parent, 'case-')), compiled = join(dir, 'panel.mjs')
await build({ entryPoints: ['apps/integration-client/library-panel.jsx'], outfile: compiled, bundle: true, platform: 'node', format: 'esm', external: ['react'] })
const { LibraryPanel } = await import(pathToFileURL(compiled))

test('a user uploads and downloads unchanged binary bytes through the real authenticated product channel', async () => {
  const library = createBotLibrary({ root: join(dir, 'files'), fs })
  const channel = createProductReadModel({ runtime: { readOnly: () => undefined }, actions: {
    'library.list': input => library.list(input.botId, input.relativePath),
    'library.upload': input => library.upload(input.botId, input.relativePath, input.contentBase64),
    'library.download': input => library.download(input.botId, input.relativePath),
  } })
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const globals = ['window', 'document', 'Element', 'HTMLElement', 'FileReader', 'File', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(globals.map(key => [key, globalThis[key]]))
  for (const key of globals) globalThis[key] = key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key]
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL, downloads = []
  URL.createObjectURL = blob => { downloads.push(blob); return 'blob:fixture-download' }; URL.revokeObjectURL = () => {}
  dom.window.HTMLAnchorElement.prototype.click = () => {}
  const { createRoot } = await import('react-dom/client')
  const container = dom.window.document.getElementById('root'), root = createRoot(container)
  const dispatch = (action, payload) => channel.dispatch({ action, payload }, { kind: 'owner' })
  try {
    await act(async () => root.render(React.createElement(LibraryPanel, { snapshot: { bots: [{ id: 'bot-a', name: 'Research' }] }, dispatch })))
    const bytes = Uint8Array.from([37, 80, 68, 70, 0, 255, 128, 10])
    const file = new dom.window.File([bytes], 'source.pdf', { type: 'application/pdf' })
    const input = container.querySelector('input[type=file]')
    Object.defineProperty(input, 'files', { value: [file] })
    await act(async () => {
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
      const deadline = Date.now() + 2000
      while (!fs.existsSync(join(dir, 'files/bot-a/source.pdf')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    })
    assert.deepEqual(fs.readFileSync(join(dir, 'files/bot-a/source.pdf')), Buffer.from(bytes))
    assert.match(container.textContent, /source\.pdf/u)
    assert.match(container.textContent, /已上传 1 个文件/u)
    const download = [...container.querySelectorAll('button')].find(button => button.textContent === '下载')
    await act(async () => download.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    assert.equal(downloads.length, 1)
    assert.deepEqual(Buffer.from(await downloads[0].arrayBuffer()), Buffer.from(bytes))
  } finally {
    await act(async () => root.unmount()); dom.window.close()
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value }
  }
})

test('a user searches real private text files through the authenticated owner channel and opens/edits the exact matching path and line', async () => {
  const library = createBotLibrary({ root: join(dir, 'search-files'), fs }), calls = []
  const original = 'heading\nNeedle own evidence\nlast line\nsecond needle match'
  library.write('bot-a', 'notes/project.md', original)
  library.write('bot-b', 'notes/private.md', 'needle SECRET BOT B')
  library.upload('bot-a', 'raw.bin', Buffer.from('needle binary excluded').toString('base64'))
  const channel = createProductReadModel({ runtime: { readOnly: () => undefined }, actions: {
    'library.list': input => library.list(input.botId, input.relativePath),
    'library.search': input => ({ results: library.search(input.botId, input.query) }),
    'library.read': input => ({ content: library.read(input.botId, input.relativePath) }),
    'library.write': input => library.write(input.botId, input.relativePath, input.content),
  } })
  await assert.rejects(channel.dispatch({ action: 'library.search', payload: { botId: 'bot-a', query: 'needle' } }, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const globals = ['window', 'document', 'Element', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(globals.map(key => [key, globalThis[key]]))
  for (const key of globals) globalThis[key] = key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key]
  const { createRoot } = await import('react-dom/client')
  const container = dom.window.document.getElementById('root'), root = createRoot(container)
  const dispatch = (action, payload) => { calls.push({ action, payload }); return channel.dispatch({ action, payload }, { kind: 'owner' }) }
  const button = label => [...container.querySelectorAll('button')].find(item => item.textContent === label)
  try {
    await act(async () => root.render(React.createElement(LibraryPanel, { snapshot: { bots: [{ id: 'bot-a', name: 'Research' }, { id: 'bot-b', name: 'Other' }] }, dispatch })))
    const query = container.querySelector('input[aria-label="资料库文本查询"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(query, 'needle')
      query.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.equal(button('搜索文本').disabled, false)
    await act(async () => button('搜索文本').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    assert.deepEqual(calls.find(item => item.action === 'library.search').payload, { botId: 'bot-a', query: 'needle' })
    const results = container.querySelector('[aria-label="资料库搜索结果"]')
    assert.match(results.textContent, /notes\/project\.md:2/u); assert.match(results.textContent, /notes\/project\.md:4/u)
    assert.match(results.textContent, /Needle own evidence/u); assert.doesNotMatch(results.textContent, /SECRET BOT B|binary excluded/u)
    await act(async () => button('notes/project.md:2').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    const editor = container.querySelector('textarea[aria-label="资料内容"]')
    assert.equal(editor.value, original); assert.equal(editor.value.slice(editor.selectionStart, editor.selectionEnd), 'Needle own evidence')
    const updated = original.replace('own evidence', 'verified on disk')
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(editor, updated)
      editor.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => button('保存').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    assert.equal(fs.readFileSync(join(dir, 'search-files/bot-a/notes/project.md'), 'utf8'), updated)
    assert.equal(fs.existsSync(join(dir, 'search-files/bot-a/project.md')), false, 'search-result editing must retain the exact nested path')
    assert.equal(library.read('bot-b', 'notes/private.md'), 'needle SECRET BOT B')
  } finally {
    await act(async () => root.unmount()); dom.window.close()
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value }
  }
})

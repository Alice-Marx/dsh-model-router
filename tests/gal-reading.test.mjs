import test from 'node:test'
import assert from 'node:assert/strict'
import { isStoryPausePoint, readingAction, isGalShortcutTarget } from '../.dsh-plugin/client/gal-reading.mjs'

const dialogue = { id: 'line-01', speaker: 'claude', text: '留一点时间，让她自己把这句话说完。' }

test('manual reading always waits for the user', () => {
  for (const done of [false, true]) {
    for (const node of [dialogue, null, { ...dialogue, choices: [{ id: 'yes' }] }]) {
      assert.equal(readingAction({ node, mode: 'manual', paused: false, done, readBefore: true, skipUnread: true }), 'wait')
    }
  }
})

test('unknown reading modes wait instead of silently advancing the story', () => {
  for (const mode of [undefined, null, '', 'invalid', 'AUTO', 1]) {
    for (const done of [false, true]) {
      assert.equal(readingAction({ node: dialogue, mode, paused: false, done, readBefore: true, skipUnread: true }), 'wait')
    }
  }
})

test('auto reading waits for the text to finish then advances one ordinary line', () => {
  assert.equal(readingAction({ node: dialogue, mode: 'auto', paused: false, done: false }), 'wait')
  assert.equal(readingAction({ node: dialogue, mode: 'auto', paused: false, done: true }), 'advance')
  assert.equal(readingAction({ node: { ...dialogue, choices: [] }, mode: 'auto', done: true }), 'advance')
})

test('skip reading reveals and advances already-read text without choosing a branch', () => {
  assert.equal(readingAction({ node: dialogue, mode: 'skip', paused: false, done: false, readBefore: true }), 'reveal')
  assert.equal(readingAction({ node: dialogue, mode: 'skip', paused: false, done: true, readBefore: true }), 'advance')
})

test('skip stops at unread text until the user explicitly permits skipping it', () => {
  for (const done of [false, true]) {
    assert.equal(readingAction({ node: dialogue, mode: 'skip', done, readBefore: false, skipUnread: false }), 'stop')
  }
  assert.equal(readingAction({ node: dialogue, mode: 'skip', done: false, readBefore: false, skipUnread: true }), 'reveal')
  assert.equal(readingAction({ node: dialogue, mode: 'skip', done: true, readBefore: false, skipUnread: true }), 'advance')
})

test('choices, naming inputs, endings and missing nodes are automatic pause points', () => {
  const stops = [
    null,
    undefined,
    { ...dialogue, choices: [{ id: 'accept', text: '接受' }, { id: 'decline', text: '拒绝' }] },
    { ...dialogue, input: { kind: 'name', default: '衔雪' } },
    { ...dialogue, ending: { id: 'true-end', title: '回声之城' } },
  ]
  for (const node of stops) {
    assert.equal(isStoryPausePoint(node), true)
    for (const mode of ['auto', 'skip']) {
      for (const done of [false, true]) {
        assert.equal(readingAction({ node, mode, done, readBefore: true, skipUnread: true }), 'stop')
      }
    }
  }
  assert.equal(isStoryPausePoint(dialogue), false)
  assert.equal(isStoryPausePoint({ ...dialogue, choices: [] }), false)
})

test('pause suspends both reveal and advancement for auto and skip', () => {
  for (const mode of ['auto', 'skip']) {
    for (const done of [false, true]) {
      assert.equal(readingAction({ node: dialogue, mode, paused: true, done, readBefore: true, skipUnread: true }), 'wait')
      assert.equal(readingAction({ node: { ...dialogue, choices: [{ id: 'yes' }] }, mode, paused: true, done }), 'wait')
    }
  }
})

test('keyboard shortcuts do not take control of text fields or interactive controls', () => {
  for (const selector of ['input', 'textarea', 'select', 'button', 'a', '[role="button"]']) {
    const target = {
      closest(query) {
        assert.ok(query.split(',').map(item => item.trim()).includes(selector), `shortcut guard must include ${selector}`)
        return { matches: selector }
      },
    }
    assert.equal(isGalShortcutTarget(target), false, `${selector} retains its keys`)
  }
  assert.equal(isGalShortcutTarget({ closest() { return null } }), true)
  assert.equal(isGalShortcutTarget(null), true)
  assert.equal(isGalShortcutTarget({}), true)
})

test('every editable content mode keeps typing keys, including empty and plaintext-only attributes', () => {
  for (const mode of ['', 'true', 'plaintext-only']) {
    const editable = {
      closest(selector) {
        assert.ok(selector.includes('[contenteditable]:not([contenteditable="false"])'))
        return { contentEditable: mode }
      },
    }
    assert.equal(isGalShortcutTarget(editable), false)
  }
  const notEditable = {
    closest(selector) {
      assert.ok(selector.includes(':not([contenteditable="false"])'))
      return null
    },
  }
  assert.equal(isGalShortcutTarget(notEditable), true)
})

test('keyboard guard checks ancestors so nested icons in a button retain their keys', () => {
  const target = { closest(selector) { assert.ok(selector.includes('button')); return { tagName: 'BUTTON' } } }
  assert.equal(isGalShortcutTarget(target), false)
})

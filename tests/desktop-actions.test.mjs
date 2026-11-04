import test from 'node:test'
import assert from 'node:assert/strict'
import { createDesktopActions, framePoint, parseDesktopAct, parseDesktopView } from '../packages/orchestration/src/desktop-actions.mjs'

const frame = { width: 1920, height: 1080 }

test('desktop: a closed view request names one machine, root and Bot', () => {
  assert.deepEqual(parseDesktopView({ botId: 'session-1', machineId: 'machine-1', rootId: 'project' }),
    { botId: 'session-1', machineId: 'machine-1', rootId: 'project' })
  for (const broken of [
    null,
    { botId: 'session-1', machineId: 'machine-1' },
    { botId: 'session-1', machineId: 'machine-1', rootId: 'project', endpoint: 'http://evil' },
    { botId: 'ses sion', machineId: 'machine-1', rootId: 'project' },
  ]) assert.throws(() => parseDesktopView(broken), /INVALID_DESKTOP_REQUEST/)
})

test('desktop: an action must carry the frame it was seen on', () => {
  const request = parseDesktopAct({ botId: 'session-1', machineId: 'machine-1', rootId: 'project', screenshotId: 'shot_abcdefgh', action: { tool: 'click', x: 10, y: 20 } })
  assert.equal(request.tool, 'desktop_click')
  assert.deepEqual(request.args, { screenshotId: 'shot_abcdefgh', x: 10, y: 20 })
  for (const broken of [
    { botId: 'session-1', machineId: 'machine-1', rootId: 'project', action: { tool: 'click', x: 1, y: 1 } },
    { botId: 'session-1', machineId: 'machine-1', rootId: 'project', screenshotId: 'shot_abcdefgh', action: { tool: 'rm', path: '/' } },
    { botId: 'session-1', machineId: 'machine-1', rootId: 'project', screenshotId: 'shot_abcdefgh', action: { tool: 'click', x: 1, y: 1, path: '/etc' } },
    { botId: 'session-1', machineId: 'machine-1', rootId: 'project', screenshotId: 'shot_abcdefgh', action: { tool: 'key', key: 'F13' } },
    { botId: 'session-1', machineId: 'machine-1', rootId: 'project', screenshotId: 'shot_abcdefgh', action: { tool: 'type', text: '' } },
  ]) assert.throws(() => parseDesktopAct(broken), /INVALID_DESKTOP_(FRAME|ACTION|REQUEST)/)
})

test('desktop: a click maps from the rendered box back to frame pixels', () => {
  // The box is wider than the frame ratio, so the image is letterboxed horizontally.
  assert.deepEqual(framePoint({ clientX: 480, clientY: 270, rect: { width: 960, height: 540 }, frame }), { x: 960, y: 540 })
  assert.deepEqual(framePoint({ clientX: 0, clientY: 0, rect: { width: 960, height: 540 }, frame }), { x: 0, y: 0 })
  assert.deepEqual(framePoint({ clientX: 959, clientY: 539, rect: { width: 960, height: 540 }, frame }), { x: 1918, y: 1078 })
  assert.throws(() => framePoint({ clientX: 2000, clientY: 10, rect: { width: 960, height: 540 }, frame }), /POINT_OUTSIDE_FRAME/)
  assert.throws(() => framePoint({ clientX: 1, clientY: 1, rect: { width: 0, height: 0 }, frame }), /INVALID_FRAME_GEOMETRY/)
})

test('desktop: a view returns the frame as base64 and keeps the single-use id', async () => {
  const calls = []
  const actions = createDesktopActions({
    directory: { forBot: botId => ({ botId }) },
    uuid: () => '11111111-2222-4333-8444-555555555555',
    now: () => 1_700_000_000_000,
    machines: {
      async call(subject, input) {
        calls.push({ kind: 'call', input })
        return { status: 'succeeded', operationId: 'op-1', value: { artifactId: 'art-1', mediaType: 'image/png', screenshotId: 'shot_abcdefgh', width: 1920, height: 1080 } }
      },
      async download(subject, input) {
        calls.push({ kind: 'download', input })
        return { content: Buffer.from('png-bytes').toString('base64') }
      },
    },
  })
  const view = await actions.view({ botId: 'session-1', machineId: 'machine-1', rootId: 'project' })
  assert.equal(view.mediaType, 'image/png')
  assert.equal(view.screenshotId, 'shot_abcdefgh')
  assert.equal(Buffer.from(view.base64, 'base64').toString(), 'png-bytes')
  assert.equal(calls[0].input.tool, 'desktop_screenshot')
  assert.equal(calls[1].input.artifactId, 'art-1')
  assert.match(calls[0].input.taskId, /^owner-desktop-/)
})

test('desktop: an action is recorded with an operation id and never reuses the frame', async () => {
  const calls = []
  const actions = createDesktopActions({
    directory: { forBot: botId => ({ botId }) },
    uuid: () => '11111111-2222-4333-8444-555555555555',
    machines: {
      async call(subject, input) { calls.push(input); return { status: 'succeeded', operationId: input.operationId, value: { clicked: true } } },
      async download() { throw new Error('unused') },
    },
  })
  const result = await actions.act({ botId: 'session-1', machineId: 'machine-1', rootId: 'project', screenshotId: 'shot_abcdefgh', action: { tool: 'click', x: 5, y: 6 } })
  assert.equal(result.tool, 'desktop_click')
  assert.equal(calls[0].tool, 'desktop_click')
  assert.deepEqual(calls[0].args, { screenshotId: 'shot_abcdefgh', x: 5, y: 6 })
  assert.match(calls[0].operationId, /^owner-op-/)
})

test('desktop: an unknown Bot is refused before the machine is touched', async () => {
  let called = false
  const actions = createDesktopActions({
    directory: { forBot: () => undefined },
    machines: { call: async () => { called = true }, download: async () => ({}) },
  })
  await assert.rejects(actions.view({ botId: 'session-ghost', machineId: 'machine-1', rootId: 'project' }), /UNKNOWN_BOT/)
  assert.equal(called, false)
})

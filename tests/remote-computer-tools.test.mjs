import test from 'node:test'
import assert from 'node:assert/strict'
import { registerRemoteComputerTools, remoteSessionIdentity } from '../packages/orchestration/src/remote-computer-tools.mjs'

function harness() {
  const tools = new Map(), calls = [], downloads = [], submissions = [], attachments = []
  const subject = { botId: 'bot-a' }
  const ctx = {
    tools: { register: tool => { tools.set(tool.name, tool); return () => {} } },
    get: name => name === 'attachments' ? { saveImage: async value => { attachments.push(value); return { attachmentId: 'image-1', mediaType: value.mediaType } } } : undefined,
  }
  // A mutating Agent tool answers with its operation record; the product tool must read the
  // value inside it, not the record itself.
  const machines = {
    call: async (_subject, input) => {
      calls.push(input)
      if (input.tool === 'desktop_screenshot') return { schemaVersion: 1, machineId: 'machine-1', operationId: input.operationId, tool: 'desktop_screenshot',
        status: 'succeeded', result: { mediaType: 'image/png', artifactId: 'artifact-1', screenshotId: 'shot-1', width: 800, height: 600 }, error: null }
      if (input.tool === 'desktop_click') return { schemaVersion: 1, machineId: 'machine-1', operationId: input.operationId, tool: 'desktop_click', status: 'succeeded', result: { completed: true }, error: null }
      return { status: 'succeeded', tool: input.tool, operationId: input.operationId ?? null }
    },
    download: async (_subject, input) => { downloads.push(input); return { content: Buffer.from('png-fixture').toString('base64') } },
  }
  const taskService = { submit: async (_subject, input) => { submissions.push(input); return { taskId: 'task-1', state: 'ready' } } }
  registerRemoteComputerTools(ctx, { runtime: { load: async () => {} }, directory: { forAgent: () => subject }, machines, taskService })
  return { tools, calls, downloads, submissions, attachments }
}

const exec = { agent: { id: 'session-1' } }

test('remote computer facade registers routing, command, browser, desktop and operation tools', () => {
  const { tools } = harness()
  assert.deepEqual([...tools.keys()].sort(), ['remote_computer_browser', 'remote_computer_command', 'remote_computer_desktop', 'remote_computer_list', 'remote_computer_operation', 'remote_computer_ping', 'remote_computer_read', 'remote_computer_write'].sort())
})

test('one Bot chat keeps one derived remote identity, never one per call', () => {
  assert.deepEqual(remoteSessionIdentity(exec), { taskId: 'remote-task-session-1', attemptId: 'remote-attempt-session-1' })
  assert.deepEqual(remoteSessionIdentity({ sessionId: 'session-2' }), { taskId: 'remote-task-session-2', attemptId: 'remote-attempt-session-2' })
  assert.throws(() => remoteSessionIdentity({}), /REMOTE_SESSION_IDENTITY_REQUIRED/u)
})

test('desktop screenshot is read from the operation result, downloaded once and attached as an image', async () => {
  const { tools, calls, downloads, attachments } = harness()
  const result = await tools.get('remote_computer_desktop').execute({ machineId: 'machine-1', rootId: 'project', tool: 'desktop_screenshot', args: {} }, exec)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].taskId, 'remote-task-session-1')
  assert.equal(calls[0].attemptId, 'remote-attempt-session-1')
  assert.match(calls[0].operationId, /^operation-/u)
  assert.deepEqual(calls[0].args, {})
  assert.equal(downloads.length, 1)
  assert.equal(downloads[0].artifactId, 'artifact-1')
  assert.equal(downloads[0].operationId, calls[0].operationId)
  assert.equal(attachments[0].mediaType, 'image/png')
  assert.equal(Buffer.from(attachments[0].data).toString(), 'png-fixture')
  assert.match(result.text, /shot-1/u)
  assert.match(result.text, /screenshot-pixels/u)
  assert.ok(!result.text.includes('cG5nLWZpeHR1cmU'))
  const blocks = tools.get('remote_computer_desktop').output.render({}, result)
  assert.deepEqual(blocks[1], { type: 'image', attachment: { attachmentId: 'image-1', mediaType: 'image/png' } })
})

test('two desktop actions of one chat share the owner and never download an artifact', async () => {
  const { tools, calls, downloads } = harness()
  const first = await tools.get('remote_computer_desktop').execute({ machineId: 'machine-1', rootId: 'project', tool: 'desktop_screenshot', args: {} }, exec)
  const second = await tools.get('remote_computer_desktop').execute({ machineId: 'machine-1', rootId: 'project', tool: 'desktop_click', args: { screenshotId: 'shot-1', x: 10, y: 20 } }, exec)
  assert.equal(calls[0].taskId, calls[1].taskId)
  assert.equal(calls[0].attemptId, calls[1].attemptId)
  assert.notEqual(calls[0].operationId, calls[1].operationId)
  assert.equal(downloads.length, 1)
  const metadata = JSON.parse(first.text)
  assert.equal(second.taskId, metadata.taskId)
  assert.equal(second.attemptId, metadata.attemptId)
})

test('a failed desktop operation reports its status instead of an empty success', async () => {
  const tools = new Map(), downloads = []
  const ctx = { tools: { register: tool => { tools.set(tool.name, tool); return () => {} } }, get: () => undefined }
  const machines = {
    call: async (_subject, input) => ({ schemaVersion: 1, operationId: input.operationId, tool: input.tool, status: 'unknown', result: { possiblyApplied: true }, error: { code: 'OUTCOME_UNKNOWN' } }),
    download: async (_subject, input) => { downloads.push(input); return { content: '' } },
  }
  registerRemoteComputerTools(ctx, { runtime: { load: async () => {} }, directory: { forAgent: () => ({ botId: 'bot-a' }) }, machines })
  const value = await tools.get('remote_computer_desktop').execute({ machineId: 'machine-1', rootId: 'project', tool: 'desktop_click', args: {} }, exec)
  assert.equal(value.operationStatus, 'unknown')
  assert.deepEqual(value.error, { code: 'OUTCOME_UNKNOWN' })
  assert.equal(value.possiblyApplied, true)
  assert.equal(downloads.length, 0)
})

test('command and file write enter their durable Task backends', async () => {
  const { tools, submissions } = harness()
  const base = { requestKey: 'request-1', machineId: 'machine-1', rootId: 'project' }
  await tools.get('remote_computer_command').execute({ ...base, workspaceRelativePath: '', argv: ['git', 'status'], timeoutMs: 1000 }, { agent: {} })
  await tools.get('remote_computer_write').execute({ ...base, relativePath: 'result.txt', content: 'ok', expectedHash: null }, { agent: {} })
  assert.equal(submissions[0].backend, 'remote-command')
  assert.deepEqual(submissions[0].input.argv, ['git', 'status'])
  assert.equal(submissions[1].backend, 'remote-write')
  assert.equal(submissions[1].input.expectedHash, null)
  assert.equal(Object.hasOwn(submissions[0].input, 'requestKey'), false)
})

test('operation status and cancellation derive the same identity and never accept a forged task', async () => {
  const { tools, calls } = harness()
  await tools.get('remote_computer_operation').execute({ machineId: 'machine-1', rootId: 'project', action: 'status', operationId: 'operation-1' }, exec)
  await tools.get('remote_computer_operation').execute({ machineId: 'machine-1', rootId: 'project', action: 'cancel', operationId: 'operation-1' }, exec)
  assert.deepEqual(calls.map(call => [call.tool, call.operationId, call.args, call.taskId]), [
    ['operation_status', 'operation-1', { operationId: 'operation-1' }, 'remote-task-session-1'],
    ['operation_cancel', 'operation-1', { operationId: 'operation-1' }, 'remote-task-session-1'],
  ])
  assert.equal(Object.hasOwn(tools.get('remote_computer_operation').parameters, 'taskId'), false)
  assert.equal(Object.hasOwn(tools.get('remote_computer_desktop').parameters, 'taskId'), false)
})

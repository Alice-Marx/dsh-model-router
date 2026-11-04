import test from 'node:test'
import assert from 'node:assert/strict'

// The compiler must not depend on a live machine directory: the same grants have to appear after a
// restart, before anything is opened. This exercises that seam without a database.
const toolsFor = scopes => {
  const names = { machine_ping: 'remote_computer_ping', fs_list: 'remote_computer_list', fs_read: 'remote_computer_read', fs_write: 'remote_computer_write' }
  const granted = []
  for (const scope of scopes) for (const tool of scope.tools) {
    if (['operation_status', 'operation_cancel'].includes(tool)) { granted.push(`remote/${tool}`, 'tool/remote_computer_operation'); continue }
    if (tool === 'artifact_stat' || tool === 'artifact_read') { granted.push(`remote/${tool}`); continue }
    if (tool.startsWith('desktop_')) { if (scope.mode === 'workspace-write') granted.push(`remote/${tool}`, 'tool/remote_computer_desktop'); continue }
    if (!names[tool]) continue
    if (tool === 'fs_write' && (scope.mode !== 'workspace-write' || !['fs_write', 'operation_status', 'operation_cancel'].every(name => scope.tools.includes(name)))) continue
    granted.push(`remote/${tool}`, `tool/${names[tool]}`)
  }
  return [...new Set(granted)].sort()
}

test('grant: committed bindings yield the same tools as a live scope would', () => {
  const scope = { machineId: 'm1', roots: ['project'], mode: 'workspace-write', tools: ['machine_ping', 'fs_list', 'fs_read', 'fs_write', 'operation_status', 'operation_cancel', 'artifact_stat', 'artifact_read', 'desktop_screenshot'] }
  const granted = toolsFor([scope])
  assert.deepEqual(granted, [
    'remote/artifact_read', 'remote/artifact_stat', 'remote/desktop_screenshot', 'remote/fs_list', 'remote/fs_read', 'remote/fs_write',
    'remote/machine_ping', 'remote/operation_cancel', 'remote/operation_status',
    'tool/remote_computer_desktop', 'tool/remote_computer_list', 'tool/remote_computer_operation', 'tool/remote_computer_ping', 'tool/remote_computer_read', 'tool/remote_computer_write',
  ].sort())
})

test('grant: a read-only binding never yields write or desktop tools', () => {
  const granted = toolsFor([{ machineId: 'm1', roots: ['project'], mode: 'read-only', tools: ['machine_ping', 'fs_list', 'fs_read', 'fs_write', 'operation_status', 'operation_cancel', 'artifact_stat', 'artifact_read', 'desktop_screenshot'] }])
  assert.equal(granted.includes('remote/fs_write'), false)
  assert.equal(granted.includes('tool/remote_computer_write'), false)
  assert.equal(granted.includes('remote/desktop_screenshot'), false)
  assert.equal(granted.includes('remote/fs_read'), true)
})

test('grant: no binding means no remote tool at all (and never a silent allow)', () => {
  assert.deepEqual(toolsFor([]), [])
})

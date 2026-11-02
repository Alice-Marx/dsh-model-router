// Controlled DS (migrated vendor) regression. It imports the materialized candidate DS product
// module from --candidate-root and executes its behavior. The candidate bytes come only from the
// verified candidate tree, never from the governance root or from executing upstream lifecycle code.
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

function value(name) {
  const index = process.argv.indexOf(`--${name}`)
  assert.ok(index > 0 && process.argv[index + 1] !== undefined, `missing --${name}`)
  return process.argv[index + 1]
}

const source = value('source').toUpperCase()
const baseline = value('baseline')
const candidate = value('candidate')
const incrementId = value('increment-id')
const candidateRoot = value('candidate-root')

assert.match(baseline, /^[0-9a-f]{40}$/, 'baseline must be a complete SHA')
assert.match(candidate, /^[0-9a-f]{40}$/, 'candidate must be a complete SHA')
assert.equal(incrementId, `${source}:${candidate}`, 'increment-id must be exactly SOURCE:candidate')
assert.equal(source, 'DS', 'ds-vendor-contract only runs for a DS source')

const contractPath = join(candidateRoot, 'ds-bot/src/host/roster.js')
await assert.doesNotReject(stat(contractPath), 'candidate DS roster module must exist')
await readFile(contractPath) // read the exact candidate bytes before executing them

const { install } = await import(pathToFileURL(contractPath).href)
const rt = { ctx: { workspaceRegistry: { get: id => id === 'workspace-offline' ? { id } : undefined } },
  defaults: {}, state: { workspaceId: 'workspace-offline' }, teamFolder: () => undefined,
  findBot: name => name === 'Taken' ? { id: 'existing' } : undefined,
  readOnly: () => 'INCREMENT_OFFLINE_READ_ONLY' }
install(rt)
assert.equal(await rt.ensureWorkspace(), 'workspace-offline')
await assert.rejects(rt.createBot({ name: '' }))
await assert.rejects(rt.createBot({ name: 'Taken' }), /already exists/)
await assert.rejects(rt.createSession('blocked'), /INCREMENT_OFFLINE_READ_ONLY/)

process.stdout.write(`${JSON.stringify({
  regression: 'DS-vendor-contract',
  candidateRoot,
  candidate,
  checks: ['existing-workspace-reuse', 'empty-name-rejection', 'duplicate-name-rejection', 'readonly-session-denial'],
})}\n`)

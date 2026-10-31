import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

const executeFile = promisify(execFile)
const fail = (code, details) => { throw Object.assign(new Error(code), { code, ...(details ? { details } : {}) }) }
const ID = /^[-A-Za-z0-9_.]{1,128}$/

async function canonical(path, directory) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) fail('MIGRATION_REMOTE_CLIENT_INPUT_INVALID')
  const resolved = await realpath(path).catch(() => fail('MIGRATION_REMOTE_CLIENT_INPUT_INVALID'))
  const info = await lstat(resolved).catch(() => fail('MIGRATION_REMOTE_CLIENT_INPUT_INVALID'))
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) fail('MIGRATION_REMOTE_CLIENT_INPUT_INVALID')
  return resolved
}

function validateClients(clients) {
  if (!Array.isArray(clients) || clients.length < 1 || clients.length > 64) fail('MIGRATION_REMOTE_CLIENT_INPUT_INVALID')
  const seen = new Set()
  for (const client of clients) {
    if (!client || Object.keys(client).some(key => !['configPath', 'machineId', 'clientId'].includes(key)) || !ID.test(client.machineId ?? '') || !ID.test(client.clientId ?? '')) fail('MIGRATION_REMOTE_CLIENT_INPUT_INVALID')
    const key = `${client.machineId}\0${client.clientId}`
    if (seen.has(key)) fail('MIGRATION_REMOTE_CLIENT_INPUT_INVALID')
    seen.add(key)
  }
}

async function inspect(client, Database) {
  const configPath = await canonical(client.configPath, false)
  const bytes = await readFile(configPath)
  if (bytes.length > 65536) fail('MIGRATION_REMOTE_CLIENT_INPUT_INVALID')
  let config
  try { config = JSON.parse(bytes.toString('utf8')) } catch { fail('MIGRATION_REMOTE_CLIENT_INPUT_INVALID') }
  const dataDir = await canonical(config?.dataDir, true)
  const file = await canonical(join(dataDir, 'agent.sqlite'), false)
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    db.pragma('busy_timeout=5000')
    const machine = db.prepare("SELECT value FROM meta WHERE key='machineId'").get()
    if (machine?.value !== client.machineId) fail('MIGRATION_REMOTE_CLIENT_IDENTITY_MISMATCH', { machineId: client.machineId, clientId: client.clientId })
    const row = db.prepare('SELECT id,revoked,revision FROM clients WHERE id=?').get(client.clientId)
    if (!row) fail('MIGRATION_REMOTE_CLIENT_IDENTITY_MISMATCH', { machineId: client.machineId, clientId: client.clientId })
    if (![0, 1].includes(row.revoked)) fail('MIGRATION_REMOTE_CLIENT_STATE_INVALID', { machineId: client.machineId, clientId: client.clientId })
    return { ...client, configPath, configSha256: createHash('sha256').update(bytes).digest('hex'), alreadyRevoked: row.revoked === 1 }
  } finally { db.close() }
}

export async function quarantineMigrationRemoteClients({ Database, cli = '/usr/local/bin/dsh-remote-agent', runtime, clients, execute = executeFile, signal } = {}) {
  if (typeof Database !== 'function' || typeof execute !== 'function') fail('MIGRATION_REMOTE_CLIENT_SERVICES_REQUIRED')
  validateClients(clients)
  const executable = await canonical(cli, false), launcher = runtime === undefined ? executable : await canonical(runtime, false)
  const prefix = runtime === undefined ? [] : [executable]
  const rows = []
  for (const client of clients) rows.push(await inspect(client, Database))
  const completed = []
  for (const row of rows) {
    if (signal?.aborted) fail('MIGRATION_REMOTE_CLIENT_CANCELLED', { completed })
    try {
      if (!row.alreadyRevoked) await execute(launcher, [...prefix, 'revoke', row.configPath, row.clientId], { timeout: 10000, windowsHide: true, maxBuffer: 65536, signal })
      const verified = await inspect(row, Database)
      if (verified.configSha256 !== row.configSha256) fail('MIGRATION_REMOTE_CLIENT_CONFIG_CHANGED', { machineId: row.machineId, clientId: row.clientId })
      if (!verified.alreadyRevoked) fail('MIGRATION_REMOTE_CLIENT_REVOKE_UNCONFIRMED', { machineId: row.machineId, clientId: row.clientId })
      completed.push({ machineId: row.machineId, clientId: row.clientId, configSha256: row.configSha256, revoked: true, alreadyRevoked: row.alreadyRevoked })
    } catch (error) {
      if (['MIGRATION_REMOTE_CLIENT_IDENTITY_MISMATCH', 'MIGRATION_REMOTE_CLIENT_CONFIG_CHANGED', 'MIGRATION_REMOTE_CLIENT_STATE_INVALID'].includes(error?.code)) throw error
      throw Object.assign(new Error('MIGRATION_REMOTE_CLIENT_REVOKE_UNCONFIRMED'), { code: 'MIGRATION_REMOTE_CLIENT_REVOKE_UNCONFIRMED', details: { machineId: row.machineId, clientId: row.clientId, completed }, cause: error })
    }
  }
  return Object.freeze({
    schemaVersion: 1,
    clients: completed,
    declaredCredentialAdmissionBlocked: true,
    persistentDeclaredExclusion: true,
    externalRestartBlocked: false,
    persistentExternalExclusion: false,
    stopWriteProvable: false,
  })
}

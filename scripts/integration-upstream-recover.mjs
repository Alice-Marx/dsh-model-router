import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateIncludedIncrements, validateIncludedRegressionEvidence } from './integration-progress.mjs'

const MARKER = 'docs/integration/inclusion-transaction.json'
const LOCKS = ['docs/integration/baseline.json', 'docs/integration/feature-inventory.json', 'docs/integration/included-increments.json']
const SOURCE = 'modules/bot-runtime/SOURCE.json'
const HASH = /^[0-9a-f]{64}$/
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
const portable = path => typeof path === 'string' && path && !path.includes('\\') && !path.includes(':')
  && !path.split('/').some(part => !part || part === '.' || part === '..')

async function controlled(root, path, directory = false) {
  assert.ok(portable(path), 'Recovery path must be repository-relative and portable')
  const canonical = await realpath(root)
  let current = root
  for (const [index, part] of path.split('/').entries()) {
    current = join(current, part)
    const info = await lstat(current)
    assert.ok(!info.isSymbolicLink(), `Recovery path must not contain links: ${path}`)
    assert.ok((index < path.split('/').length - 1 || directory) ? info.isDirectory() : info.isFile(), `Recovery path type is invalid: ${path}`)
  }
  const part = relative(canonical, await realpath(current))
  assert.ok(part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part), 'Recovery path escapes project')
  return current
}

async function atomicWrite(path, bytes) {
  const temporary = `${path}.${process.pid}.recovery.tmp`
  const handle = await open(temporary, 'wx')
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  await rename(temporary, path)
}

async function verifyVendor(directory, manifest) {
  const paths = []
  const walk = async (base, prefix = '') => {
    const info = await lstat(base)
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Recovery vendor must be a non-linked directory')
    for (const entry of await readdir(base, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, absolute = join(base, entry.name)
      const info = await lstat(absolute)
      assert.ok(!info.isSymbolicLink(), `Recovery vendor link refused: ${path}`)
      if (info.isDirectory()) await walk(absolute, path)
      else { assert.ok(info.isFile()); paths.push(`vendor/ds-bot/${path}`) }
    }
  }
  await walk(directory)
  assert.deepEqual(paths.sort(), manifest.files.map(file => file.path).sort(), 'Recovery vendor paths differ')
  for (const file of manifest.files) {
    assert.ok(portable(file.path) && file.path.startsWith('vendor/ds-bot/'), 'Invalid recovery manifest path')
    const bytes = await readFile(join(directory, file.path.slice('vendor/ds-bot/'.length)))
    assert.equal(hash(bytes), file.sha256, `Recovery vendor byte mismatch: ${file.path}`)
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), file.gitBlob, `Recovery vendor blob mismatch: ${file.path}`)
  }
}

// Deliberate owner action, never a normal gate's implicit repair. The caller must
// bind the exact current marker and provide a reason; all preflight is read-only.
export async function recoverInclusionTransaction({ root, output, markerSha256, reason }) {
  root = resolve(root)
  assert.ok(portable(output) && output.startsWith('tmp/integration/'), 'Recovery output must be below tmp/integration/')
  assert.ok(HASH.test(markerSha256 ?? ''), 'Recovery requires the exact marker SHA256')
  assert.ok(typeof reason === 'string' && reason.trim(), 'Recovery requires an explicit reason')
  const markerPath = await controlled(root, MARKER), markerBytes = await readFile(markerPath)
  assert.equal(hash(markerBytes), markerSha256, 'Recovery marker binding is stale')
  const marker = JSON.parse(markerBytes)
  assert.equal(marker.output, output, 'Recovery output differs from marker')
  assert.equal(marker.kind, 'included-increment-transaction')
  assert.ok(Number.isSafeInteger(marker.ownerPid) && marker.ownerPid > 0, 'Recovery needs a recorded process owner')
  try { process.kill(marker.ownerPid, 0); assert.fail('Inclusion owner is still live; recovery refused') }
  catch (error) { if (error.code !== 'ESRCH') throw error }
  const evidence = await controlled(root, output, true)
  const transaction = JSON.parse(await readFile(await controlled(root, `${output}/transaction.json`)))
  assert.equal(transaction.id, marker.id)
  assert.equal(transaction.ownerPid, marker.ownerPid)
  assert.equal(transaction.sourceRepository, marker.sourceRepository)
  assert.deepEqual(transaction.beforeSha256, marker.beforeSha256)
  assert.deepEqual(transaction.afterSha256, marker.afterSha256)
  assert.ok(['MR', 'DS'].includes(transaction.sourceRepository), 'Recovery source is invalid')
  const paths = [...LOCKS, ...(transaction.sourceRepository === 'DS' ? [SOURCE] : [])]
  assert.deepEqual(Object.keys(transaction.beforeSha256).sort(), [...paths].sort(), 'Recovery originals are incomplete')
  const originals = new Map()
  for (const path of paths) {
    const bytes = await readFile(await controlled(root, `${output}/originals/${path}`))
    assert.equal(hash(bytes), transaction.beforeSha256[path], `Recovery original hash mismatch: ${path}`)
    const current = await readFile(await controlled(root, path))
    assert.ok([transaction.beforeSha256[path], transaction.afterSha256?.[path]].includes(hash(current)), `Recovery refuses unrelated current bytes: ${path}`)
    originals.set(path, bytes)
  }
  const [baseline, inventory, includedIncrements] = LOCKS.map(path => JSON.parse(originals.get(path)))
  validateIncludedIncrements({ baseline, inventory, includedIncrements })
  await validateIncludedRegressionEvidence(root, includedIncrements)
  let vendor, backup, oldManifest, candidateManifest, moveCandidate = false, restoreVendor = false
  if (transaction.sourceRepository === 'DS') {
    oldManifest = JSON.parse(originals.get(SOURCE))
    assert.equal(oldManifest.commit, baseline.repositories.DS.commit)
    const candidateBytes = await readFile(await controlled(root, `${output}/SOURCE.candidate.json`))
    candidateManifest = JSON.parse(candidateBytes)
    await controlled(root, 'modules/bot-runtime/vendor', true)
    assert.equal(hash(candidateBytes), transaction.dsMigration.after.manifestSha256)
    assert.equal(hash(originals.get(SOURCE)), transaction.dsMigration.before.manifestSha256)
    vendor = join(root, 'modules/bot-runtime/vendor/ds-bot')
    backup = join(evidence, 'ds-vendor-original')
    const backupInfo = await lstat(backup).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (backupInfo) {
      await controlled(root, `${output}/ds-vendor-original`, true)
      await verifyVendor(backup, oldManifest)
      const current = await lstat(vendor).catch(error => { if (error.code === 'ENOENT') return null; throw error })
      if (current) { await verifyVendor(vendor, candidateManifest); moveCandidate = true }
      restoreVendor = true
    } else await verifyVendor(vendor, oldManifest)
  }
  const handle = await open(join(evidence, 'recovery.lock'), 'wx')
  try {
    // Recheck owner-approved marker after exclusive admission and before mutation.
    assert.equal(hash(await readFile(markerPath)), markerSha256, 'Recovery marker changed during preflight')
    transaction.state = 'recovering'
    await atomicWrite(markerPath, jsonBytes({ ...transaction, output }))
    if (moveCandidate) await rename(vendor, join(evidence, 'ds-vendor-recovery-candidate'))
    if (restoreVendor) await rename(backup, vendor)
    for (const [path, bytes] of originals) await atomicWrite(join(root, path), bytes)
    for (const [path, bytes] of originals) assert.deepEqual(await readFile(join(root, path)), bytes)
    if (oldManifest) await verifyVendor(vendor, oldManifest)
    transaction.state = 'recovered-rolled-back'
    transaction.recovery = { reason: reason.trim(), recoveredAt: new Date().toISOString(), markerSha256 }
    await atomicWrite(join(evidence, 'transaction.json'), jsonBytes(transaction))
    await atomicWrite(join(evidence, 'recovery-result.json'), jsonBytes({ status: 'rolled-back', id: transaction.id,
      restoredSha256: transaction.beforeSha256, ...transaction.recovery }))
    await rm(markerPath)
    return { status: 'rolled-back', id: transaction.id }
  } catch (error) {
    transaction.state = 'recovery-required'
    transaction.recoveryError = error.message
    await atomicWrite(join(evidence, 'transaction.json'), jsonBytes(transaction)).catch(() => {})
    await atomicWrite(markerPath, jsonBytes({ ...transaction, output })).catch(() => {})
    throw error
  } finally { await handle.close(); await rm(join(evidence, 'recovery.lock')) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = { '--root': 'root', '--output': 'output', '--marker-sha256': 'markerSha256', '--reason': 'reason' }[args[index]]
    assert.ok(key && options[key] === undefined && args[index + 1], 'Invalid or duplicate recovery option')
    options[key] = args[index + 1]
  }
  assert.ok(options.root, 'Recovery requires an explicit --root')
  process.stdout.write(`${JSON.stringify(await recoverInclusionTransaction(options))}\n`)
}

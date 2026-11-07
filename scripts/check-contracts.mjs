// Verify every committed contract, lock published versions, and check that the
// product channel's actions are all declared. Run by `npm run check:contracts`
// and by the test plan, because a gate nobody runs is a comment.
import {readFile, readdir, writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {assertSchema, validate} from '../contracts/validate.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONTRACTS = join(ROOT, 'contracts')
const LOCK_NAME = 'LOCK.json'

const hash = (text) => createHash('sha256').update(text).digest('hex')
const fail = (message) => { const error = new Error(message); error.code = 'CONTRACT_CHECK_FAILED'; throw error }

async function readJson(path) {
  const text = await readFile(path, 'utf8')
  try { return {value: JSON.parse(text), text} } catch { fail(`${path} is not valid JSON`) }
}

async function contractDirs() {
  const out = []
  for (const name of await readdir(CONTRACTS)) {
    if (name === 'validate.mjs' || name === 'README.md') continue
    const nameDir = join(CONTRACTS, name)
    for (const version of await readdir(nameDir)) {
      const dir = join(nameDir, version)
      const entries = await readdir(dir)
      if (!entries.includes('schema.json')) continue
      out.push({id: `${name}/${version}`, dir})
    }
  }
  return out.sort((left, right) => left.id.localeCompare(right.id))
}

/** A published version is immutable: its bytes are locked and a change means v2. */
async function verifyLock({id, dir}) {
  const schema = await readFile(join(dir, 'schema.json'), 'utf8')
  const fixtures = (await readdir(join(dir, 'fixtures'))).sort()
  const files = {}
  for (const name of fixtures) files[`fixtures/${name}`] = hash(await readFile(join(dir, 'fixtures', name), 'utf8'))
  const digest = hash(JSON.stringify({schema: hash(schema), files: Object.entries(files).sort()}))
  const lockPath = join(dir, LOCK_NAME)
  let lock = null
  try { lock = JSON.parse(await readFile(lockPath, 'utf8')) } catch { lock = null }
  if (!lock) {
    await writeFile(lockPath, JSON.stringify({id, schemaHash: hash(schema), files, digest}, null, 2) + '\n')
    return {id, locked: 'created', digest}
  }
  if (lock.digest !== digest) {
    const changed = []
    if (lock.schemaHash !== hash(schema)) changed.push('schema.json')
    for (const [name, value] of Object.entries(files)) if (lock.files?.[name] !== value) changed.push(name)
    for (const name of Object.keys(lock.files ?? {})) if (!Object.hasOwn(files, name)) changed.push(`${name} (removed)`)
    fail(`${id} is published and must not change (${changed.join(', ')}). Add ${id.replace(/v\d+$/, 'v')}2 and point callers at it.`)
  }
  return {id, locked: 'unchanged', digest}
}

async function verifyFixtures({id, dir}) {
  const {value: schema} = await readJson(join(dir, 'schema.json'))
  assertSchema(schema, `contracts/${id}/schema.json`)
  const fixtures = (await readdir(join(dir, 'fixtures'))).sort()
  if (!fixtures.length) fail(`${id} has no fixtures: a schema nobody feeds is a guess`)
  const checked = []
  for (const name of fixtures) {
    const {value} = await readJson(join(dir, 'fixtures', name))
    try { validate(schema, value, '$') } catch (error) {
      fail(`${id}.fixtures.${fixtures.indexOf(name)} (${name}): ${error.message}`)
    }
    checked.push(name)
  }
  return {id, fixtures: checked}
}

/**
 * Every dotted action registered in the composition must be declared, with the
 * caller class the code actually enforces. A new action, or one whose caller
 * class changed, fails here before a client can rely on it.
 */
async function verifyProductActions({write = false} = {}) {
  const source = await readFile(join(ROOT, 'packages/orchestration/src/product-composition.mjs'), 'utf8')
  const declared = JSON.parse(await readFile(join(CONTRACTS, 'product-action/v1/actions.json'), 'utf8'))
  const names = new Set([...source.matchAll(/'([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)':/g)].map((match) => match[1]))
  // The check must live inside this action's own entry: a window of lines would
  // pick up the next action's guard and call an ungated action owner-only.
  const entryOf = (name) => {
    const at = source.indexOf(`'${name}':`)
    if (at < 0) return ''
    const open = source.indexOf('{', at)
    const arrow = source.indexOf('=>', at)
    if (open < 0 && arrow < 0) return source.slice(at, at + 200)
    if (arrow < 0) return source.slice(at, open + 400)
    // A one-expression entry ends at the closing paren of the map entry; a block
    // entry ends at its matching brace. Scan brackets to find it either way.
    let depth = 0, started = false, index = arrow + 2
    for (; index < source.length && index < at + 4000; index++) {
      const ch = source[index]
      if (ch === '{' || ch === '(') { depth++; started = true; continue }
      if (ch === '}' || ch === ')') { depth--; if (started && depth === 0) { index++; break } }
    }
    return source.slice(at, index)
  }
  const ownerGated = (name) => {
    const entry = entryOf(name)
    return /ownerOnly\(/.test(entry) || /context\?\.kind\s*!==\s*'owner'/.test(entry) || /context\.kind\s*!==\s*'owner'/.test(entry)
  }
  if (write) {
    // Regenerate the frozen table from the code, so it stays a consequence of the
    // composition instead of a hand-kept list that drifts.
    const next = {}
    for (const name of [...names].sort()) next[name] = {caller: ownerGated(name) ? 'owner' : 'bot'}
    await writeFile(join(CONTRACTS, 'product-action/v1/actions.json'), JSON.stringify({
      $comment: 'Generated by scripts/check-contracts.mjs --write, then frozen: changing a caller class is a contract change.',
      actions: next,
    }, null, 2) + '\n')
    return {actions: Object.keys(next).length, regenerated: true}
  }
  const missing = [...names].filter((name) => !Object.hasOwn(declared.actions, name))
  if (missing.length) fail(`these product actions are registered but not declared in contracts/product-action/v1/actions.json: ${missing.join(', ')}`)
  const phantom = Object.keys(declared.actions).filter((name) => !names.has(name))
  if (phantom.length) fail(`these actions are declared but no longer registered: ${phantom.join(', ')}`)
  for (const [name, entry] of Object.entries(declared.actions)) {
    if (!['owner', 'bot'].includes(entry.caller)) fail(`${name} must declare caller "owner" or "bot"`)
    if (entry.caller === 'owner' && !ownerGated(name)) fail(`${name} is declared owner-only but the composition does not gate it on the owner`)
  }
  return {actions: Object.keys(declared.actions).length}
}

/**
 * The other direction of drift: a handler that reads a key its contract does not
 * declare. Without this, a payload shape can pass its own fixture while the code
 * quietly depends on a field nobody promised.
 */
async function verifyHandlerReads() {
  const source = await readFile(join(ROOT, 'packages/orchestration/src/product-composition.mjs'), 'utf8')
  const {value: schema} = await readJson(join(CONTRACTS, 'task-action-payload/v1/schema.json'))
  const declared = new Map()
  for (const branch of schema.oneOf) {
    declared.set(branch.properties.action.const, new Set(Object.keys(branch.properties)))
  }
  const lineOf = (name) => {
    const at = source.indexOf(`'${name}':`)
    if (at < 0) return ''
    return source.slice(at, source.indexOf('\n', at) + 1)
  }
  const undeclared = []
  for (const [action, keys] of declared) {
    const entry = lineOf(action)
    for (const match of entry.matchAll(/payload\??\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (!keys.has(match[1])) undeclared.push(`${action} reads payload.${match[1]} which its contract does not declare`)
    }
  }
  if (undeclared.length) fail(undeclared.join('\n'))
  return {actions: declared.size}
}

async function main() {
  const results = []
  for (const contract of await contractDirs()) {
    const lock = await verifyLock(contract)
    const fixtures = await verifyFixtures(contract)
    results.push({...lock, fixtures: fixtures.fixtures})
  }
  const actions = await verifyProductActions({write: process.argv.includes('--write')})
  const reads = await verifyHandlerReads()
  process.stdout.write(JSON.stringify({status: 'passed', contracts: results, productActions: actions.actions, taskActionPayloads: reads.actions}, null, 2) + '\n')
}

main().catch((error) => {
  process.stderr.write(`check-contracts: ${error.message}\n`)
  process.exitCode = 1
})

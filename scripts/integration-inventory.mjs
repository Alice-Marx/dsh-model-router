import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify, isDeepStrictEqual } from 'node:util'
import { assertNoInclusionTransaction, validateIncludedIncrements, validateIncludedRegressionEvidence } from './integration-progress.mjs'

const execute = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const digest = text => createHash('sha256').update(text).digest('hex')
const git = async (directory, ...args) => (await execute('git', ['-C', directory, ...args], {
  encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024,
})).stdout

export function parseTree(text) {
  const entries = new Map()
  for (const line of text.trimEnd().split('\n')) {
    const split = line.indexOf('\t')
    if (split < 0) throw new Error('Malformed git tree')
    const [mode, kind, gitBlob, size] = line.slice(0, split).trim().split(/\s+/)
    if (!/^\d{6}$/.test(mode) || kind !== 'blob' || !/^[a-f0-9]{40}$/.test(gitBlob) || !/^\d+$/.test(size)) throw new Error('Unsupported git tree entry')
    const path = line.slice(split + 1)
    if (entries.has(path)) throw new Error(`Duplicate git tree path ${path}`)
    entries.set(path, { path, gitBlob, bytes: Number(size) })
  }
  return entries
}

function globPattern(pattern) {
  return new RegExp('^'+pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')+'$')
}

export function featureSources(feature, tree) {
  const side = feature.sourceDescription.startsWith('MR ') ? 'MR' : feature.sourceDescription.startsWith('DS ') ? 'DS' : 'new'
  let previous = side === 'DS' ? 'ds-bot/src/host' : '.dsh-plugin/shared'
  const files = []
  for (const match of feature.sourceDescription.matchAll(/`([^`]+)`/g)) {
    const token = match[1]
    let path
    if (side === 'DS') {
      path = ['app/', 'docker/', 'browser-plugins/'].includes(token) ? token
        : token.startsWith('src/') || token === 'web-search.js' ? `ds-bot/${token}` : `${previous}/${token}`
    } else path = token.includes('/') ? token : `${previous}/${token}`
    let matches = [...tree.keys()].filter(item => path.endsWith('/') ? item.startsWith(path) : globPattern(path).test(item))
    if (!matches.length && !token.includes('/')) {
      const candidates = [...tree.keys()].filter(item => item.endsWith(`/${token}`))
      if (candidates.length === 1) matches = candidates
    }
    if (!matches.length) throw new Error(`${feature.id}: unresolved source ${path}`)
    if (path.endsWith('/')) {
      files.push({ path, kind: 'directory', fileCount: matches.length,
        treeFingerprintSha256: digest(matches.sort().map(item => `${item}:${tree.get(item).gitBlob}`).join('\n')) })
    } else {
      files.push(...matches.map(item => tree.get(item)))
      previous = posix.dirname(path)
    }
  }
  if (feature.id === 'F33') files.push(tree.get('.dsh-plugin/client/run-launcher.jsx'))
  if (feature.id === 'F38') files.push(tree.get('.dsh-plugin/client/official-harness.jsx'))
  if (files.some(item => !item) || (!files.length && feature.id !== 'F40')) throw new Error(`${feature.id}: missing source evidence`)
  return { side, files }
}

export async function buildInventory({ root = ROOT, dsRoot, mrRoot = root, baseline: stagedBaseline }) {
  const base = join(root, 'docs/integration')
  const baseline = stagedBaseline ?? JSON.parse(await readFile(join(base, 'baseline.json'), 'utf8'))
  const scope = JSON.parse(await readFile(join(base, 'scope.json'), 'utf8'))
  for (const side of ['MR', 'DS']) if (!/^[a-f0-9]{40}$/.test(baseline.repositories[side].commit)) throw new Error('Full frozen commit required')
  const { MR, DS } = baseline.repositories
  if ((await git(dsRoot, 'rev-parse', 'HEAD')).trim() !== DS.commit) throw new Error('DS checkout is not at the frozen commit')
  const [mrTree, dsTree] = await Promise.all([
    git(mrRoot, 'ls-tree', '-r', '-l', MR.commit).then(parseTree),
    git(dsRoot, 'ls-tree', '-r', '-l', DS.commit).then(parseTree),
  ])
  const features = scope.features.map(feature => {
    const { side, files } = featureSources(feature, feature.sourceDescription.startsWith('MR ') ? mrTree : dsTree)
    return { id: feature.id, title: feature.title, repository: side,
      commit: side === 'MR' ? MR.commit : side === 'DS' ? DS.commit : null,
      sources: files, destination: feature.decision, acceptanceIds: feature.acceptanceIds,
      reviewStatus: files.length ? 'source-mapped' : 'new-component', behaviorVerified: false }
  })
  const namedToolRegistrations = []
  for (const [repository, directory, commit, paths] of [
    ['MR', mrRoot, MR.commit, ['.dsh-plugin/index.mjs']],
    ['DS', dsRoot, DS.commit, [...dsTree.keys()].filter(path => path.startsWith('ds-bot/src/host/') && path.endsWith('.js'))],
  ]) {
    for (const path of paths) {
      const text = await git(directory, 'show', `${commit}:${path}`)
      for (const match of text.matchAll(/(?:ctx|c)\.tools\.register\(defineTool\(\{\s*name:\s*['"]([^'"]+)['"]/g)) {
        namedToolRegistrations.push({ repository, path, line: text.slice(0, match.index).split('\n').length,
          name: match[1], kind: 'static-tool-registration', behaviorVerified: false })
      }
    }
  }
  return { schemaVersion: 1, baseline: { MR: MR.commit, DS: DS.commit },
    coverageMeaning: 'Static provenance mapping and named registrations; not a completed behavior or UI audit',
    features, namedToolRegistrations }
}

function parseMainArgs(args) {
  const options = { root: ROOT, write: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--write') {
      if (options.write) throw new Error('Duplicate --write')
      options.write = true
      continue
    }
    if (!['--root', '--mr-root', '--ds-root'].includes(arg) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('Usage: node scripts/integration-inventory.mjs --ds-root <frozen-checkout> [--root <project-root>] [--mr-root <mr-checkout>] [--write]')
    }
    const key = { '--root': 'root', '--mr-root': 'mrRoot', '--ds-root': 'dsRoot' }[arg]
    if (options[key] !== undefined && (key !== 'root' || options.root !== ROOT)) throw new Error(`Duplicate ${arg}`)
    options[key] = resolve(args[index + 1])
    index += 1
  }
  if (!options.dsRoot) throw new Error('Usage: node scripts/integration-inventory.mjs --ds-root <frozen-checkout> [--root <project-root>] [--mr-root <mr-checkout>] [--write]')
  return options
}

async function main(args) {
  const options = parseMainArgs(args)
  await assertNoInclusionTransaction(options.root)
  const base = join(options.root, 'docs/integration')
  const read = async name => JSON.parse(await readFile(join(base, name), 'utf8'))
  const [baseline, inventory, includedIncrements] = await Promise.all([
    read('baseline.json'), read('feature-inventory.json'), read('included-increments.json'),
  ])
  validateIncludedIncrements({ baseline, inventory, includedIncrements })
  await validateIncludedRegressionEvidence(options.root, includedIncrements)
  const result = await buildInventory(options)
  validateIncludedIncrements({ baseline, inventory: result, includedIncrements })
  const file = join(base, 'feature-inventory.json')
  if (options.write) await writeFile(file, JSON.stringify(result, null, 2)+'\n')
  else if (!isDeepStrictEqual(inventory, result)) throw new Error('Source inventory differs from frozen Git blobs; review before updating')
  process.stdout.write(`Frozen inventory ${options.write ? 'written' : 'verified'}: ${result.features.length} groups, ${result.namedToolRegistrations.length} static registrations; included increments ${includedIncrements.increments.length}.\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
}

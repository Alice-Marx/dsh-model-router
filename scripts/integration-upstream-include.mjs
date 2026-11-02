import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual, promisify } from 'node:util'
import { buildProposal, validateDocument } from './integration-upstream-proposal.mjs'
import { buildInventory } from './integration-inventory.mjs'
import { assertNoInclusionTransaction, validateIncludedIncrements, validateIncludedRegressionEvidence } from './integration-progress.mjs'

const executeFile = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FULL_SHA = /^[0-9a-f]{40}$/
const HASH = /^[0-9a-f]{64}$/
const SOURCES = new Set(['mr', 'ds'])
const RISK_AREAS = ['config', 'data', 'cli', 'native', 'platform']
const SCOPE_CATALOG_PATH = 'docs/integration/scope.json'
const DS_SOURCE_MANIFEST = 'modules/bot-runtime/SOURCE.json'
const TRANSACTION_MARKER = 'docs/integration/inclusion-transaction.json'
const LOCK_PATHS = [
  'docs/integration/baseline.json',
  'docs/integration/feature-inventory.json',
  'docs/integration/included-increments.json',
]
const USAGE = [
  'Usage: node scripts/integration-upstream-include.mjs --source <mr|ds> --candidate <full-40-hex-sha>',
  '  --proposal <tmp/integration/.../proposal.json> --approval <tmp/integration/.../approval.json>',
  '  --output <tmp/integration/...> --ds-root <frozen-or-candidate-ds-checkout>',
  '  [--root <project-root>] [--source-root <source-checkout>] [--mr-root <mr-checkout>]',
  'Only explicit include approvals are accepted. Regressions come from the fixed impact catalog and run with execFile argv, never a shell,',
  'against an isolated candidate source tree materialized from the exact full SHA and verified against its Git object blobs.',
].join('\n')

// Fixed, checked-in allowlist of controlled regressions. Every entry names a test-owned .mjs file
// that really reads/executes the materialized candidate product bytes; approval text is never a command.
// featureIds/requirementIds/acceptanceIds bind a regression to frozen scope ids; productPaths record which
// candidate product bytes the script exercises (for evidence, not selection by filename alone).
// R/T associations select a bounded regression, not full requirement/scenario acceptance.
export const REGRESSION_CATALOG = Object.freeze({
  'F23-router-contract': {
    file: 'tests/fixtures/increment-regressions/f23-router-contract.mjs',
    productPaths: ['.dsh-plugin/shared/router.mjs', '.dsh-plugin/shared/harness-plan.mjs'],
    repositories: ['MR'], featureIds: ['F23'], requirementIds: ['R04', 'R14'], acceptanceIds: ['T55', 'T56'],
  },
  'F40-cli-runtime-contract': {
    file: 'tests/fixtures/increment-regressions/f40-cli-runtime-contract.mjs',
    productPaths: ['packages/cli-runtime/src'],
    repositories: ['MR'], featureIds: ['F40'], requirementIds: ['R15'], acceptanceIds: ['T32', 'T39', 'T40'],
  },
  'DS-vendor-contract': {
    file: 'tests/fixtures/increment-regressions/ds-vendor-contract.mjs',
    productPaths: ['ds-bot/src/host/roster.js'],
    repositories: ['DS'], featureIds: ['F01'], requirementIds: ['R03', 'R19'], acceptanceIds: ['T02', 'T04'],
  },
})

function requireValue(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function gitBlob(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function portablePath(path, label) {
  requireValue(typeof path === 'string' && path && !path.includes('\\') && !isAbsolute(path)
    && !/^[A-Za-z]:/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..'),
  `${label}: invalid repository-relative path`)
  return path
}

function temporaryPath(path, label) {
  portablePath(path, label)
  requireValue(path.startsWith('tmp/integration/') && path.length > 'tmp/integration/'.length,
    `${label} must name a file or directory below tmp/integration/`)
  return path
}

export function parseArgs(argv) {
  const named = new Map()
  for (let index = 0; index < argv.length;) {
    const arg = argv[index]
    requireValue(arg.startsWith('--'), `Unexpected positional argument ${arg}`)
    const name = arg.slice(2)
    requireValue(['source', 'candidate', 'proposal', 'approval', 'output', 'root', 'source-root', 'mr-root', 'ds-root', 'help'].includes(name),
      `Unknown option ${arg}`)
    requireValue(!named.has(name), `Duplicate option ${arg}`)
    if (name === 'help') {
      requireValue(argv.length === 1, '--help cannot be combined with other options')
      return { help: true }
    }
    const value = argv[index + 1]
    requireValue(value && !value.startsWith('--'), `${arg} requires a value`)
    named.set(name, value)
    index += 2
  }
  for (const name of ['source', 'candidate', 'proposal', 'approval', 'output', 'ds-root']) {
    requireValue(named.has(name), `Missing --${name}. Usage:\n${USAGE}`)
  }
  const sourceId = named.get('source')
  requireValue(SOURCES.has(sourceId), `Unknown source ${sourceId}: expected mr or ds`)
  const candidate = named.get('candidate')
  requireValue(/^[0-9a-fA-F]{40}$/.test(candidate), 'Candidate must be a complete 40-hex commit SHA')
  return {
    sourceId,
    candidate: candidate.toLowerCase(),
    proposal: temporaryPath(named.get('proposal'), '--proposal'),
    approval: temporaryPath(named.get('approval'), '--approval'),
    output: temporaryPath(named.get('output'), '--output'),
    root: resolve(named.get('root') ?? ROOT),
    sourceRoot: named.has('source-root') ? resolve(named.get('source-root')) : null,
    mrRoot: named.has('mr-root') ? resolve(named.get('mr-root')) : null,
    dsRoot: resolve(named.get('ds-root')),
  }
}

async function readJsonFile(path) {
  const bytes = await readFile(path)
  return { bytes, sha256: sha256(bytes), value: JSON.parse(bytes.toString('utf8')) }
}

async function readTemporaryJson(root, path, label) {
  const canonicalRoot = await realpath(root)
  const absolute = resolve(root, path)
  const info = await lstat(absolute)
  requireValue(info.isFile() && !info.isSymbolicLink(), `${label} must be a regular non-link file`)
  const canonical = await realpath(absolute)
  const part = relative(canonicalRoot, canonical)
  requireValue(part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part), `${label} escapes the project root`)
  return { ...await readJsonFile(absolute), path }
}

async function prepareEvidenceDirectory(root, output) {
  const target = resolve(root, output)
  const canonicalRoot = await realpath(root)
  let current = resolve(root, 'tmp/integration')
  const integrationInfo = await lstat(current)
  requireValue(integrationInfo.isDirectory() && !integrationInfo.isSymbolicLink(), 'tmp/integration must be a real directory')
  for (const segment of output.split('/').slice(2)) {
    current = join(current, segment)
    const info = await lstat(current).catch(error => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (info) requireValue(info.isDirectory() && !info.isSymbolicLink(), `Evidence output contains a link or non-directory: ${output}`)
  }
  const existing = await readdir(target).catch(error => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  requireValue(existing === null || existing.length === 0,
    `Evidence output must be new or empty; a non-empty directory may require bounded recovery inspection: ${output}`)
  await mkdir(target, { recursive: true })
  const canonical = await realpath(target)
  const part = relative(canonicalRoot, canonical)
  requireValue(part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part), 'Evidence output escapes the project root')
  return target
}

async function atomicWrite(path, bytes) {
  const temporary = join(dirname(path), `.${path.split(/[\\/]/).pop()}.${process.pid}.${Date.now()}.tmp`)
  let handle
  try {
    handle = await open(temporary, 'wx')
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporary, path)
  } finally {
    if (handle) await handle.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
  }
}

function fileKey(file) {
  return `${file.oldPath ?? ''}\0${file.path}`
}

function bindingView(proposal) {
  return {
    sha256: proposal.sha256,
    mechanicalSha256: proposal.value.mechanicalSha256,
    generator: proposal.value.generator,
    inputs: proposal.value.inputs.map(input => ({ path: input.path, sha256: input.sha256 })),
  }
}

export function selectAffectedRegressions(impact) {
  const source = typeof impact?.sourceRepository === 'object' ? impact.sourceRepository?.id : impact?.sourceRepository
  requireValue(source === undefined || source === 'MR' || source === 'DS', 'Regression impact source must be MR or DS')
  const features = new Set()
  const requirements = new Set()
  const acceptance = new Set()
  for (const coverage of impact?.featureCoverage ?? []) {
    features.add(coverage.featureId)
    for (const id of coverage.requirementIds ?? []) requirements.add(id)
    for (const id of coverage.acceptanceIds ?? []) acceptance.add(id)
  }
  const merge = (values, set) => { for (const value of values ?? []) set.add(value) }
  merge(impact?.features, features)
  merge(impact?.requirements, requirements)
  merge(impact?.acceptance, acceptance)
  return Object.entries(REGRESSION_CATALOG)
    .filter(([_id, regression]) => !source || regression.repositories.includes(source))
    .filter(([_id, regression]) => regression.featureIds.some(id => features.has(id))
      || regression.requirementIds.some(id => requirements.has(id))
      || regression.acceptanceIds.some(id => acceptance.has(id)))
    .map(([id, regression]) => ({ id, ...regression }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

// Frozen scope catalogs, used to validate reviewer-added F/R/T ids before they can select regressions.
export async function loadScopeCatalog(root) {
  const bytes = await readFile(join(root, SCOPE_CATALOG_PATH))
  const scope = JSON.parse(bytes.toString('utf8'))
  requireValue(scope?.schemaVersion === 1, 'scope catalog: unsupported schema')
  const ids = kind => new Set((scope[kind] ?? []).map(item => item?.id).filter(id => typeof id === 'string'))
  const catalog = {
    features: ids('features'),
    requirements: ids('requirements'),
    acceptance: ids('acceptance'),
  }
  requireValue(catalog.features.size === 40 && catalog.requirements.size === 32 && catalog.acceptance.size === 63,
    'scope catalog: frozen F/R/T counts changed')
  return catalog
}

function validIds(values, catalog, kind, label) {
  requireValue(Array.isArray(values), `${label}: ${kind} ids must be an array`)
  const seen = new Set()
  for (const id of values) {
    requireValue(typeof id === 'string' && catalog.has(id),
      `${label}: ${kind} ${JSON.stringify(id)} is not a frozen scope ${kind === 'features' ? 'feature' : kind === 'requirements' ? 'requirement' : 'acceptance'} id`)
    requireValue(!seen.has(id), `${label}: duplicate ${kind} id ${id}`)
    seen.add(id)
  }
  return seen
}

// One candidate-bound effective impact = mechanical proposal coverage + valid reviewer additions from
// unknown files. Reviewer-added ids are scope-validated here, BEFORE regression selection, and rejected
// when nonexistent (F999/R999/T999), duplicated, or missing a matching review row later.
export function computeEffectiveImpact({ proposal, approval, catalog }) {
  const features = new Set(proposal.featureCoverage.map(entry => entry.featureId))
  const requirements = new Set(proposal.featureCoverage.flatMap(entry => entry.requirementIds ?? []))
  const acceptance = new Set(proposal.featureCoverage.flatMap(entry => entry.acceptanceIds ?? []))
  const added = { features: [], requirements: [], acceptance: [] }
  const fileDispositions = []
  for (const review of approval.fileReviews ?? []) {
    if (review.disposition !== 'frt-impact-confirmed') continue
    const file = (proposal.files ?? []).find(item => `${item.oldPath ?? ''}\0${item.path}` === `${review.oldPath ?? ''}\0${review.path}`)
    requireValue(file && file.mapping.kind === 'unknown',
      `${review.path}: frt-impact-confirmed additions are only valid on an unknown file`)
    const confirmed = {
      features: validIds(review.featureIds ?? [], catalog.features, 'features', `${review.path}`),
      requirements: validIds(review.requirementIds ?? [], catalog.requirements, 'requirements', `${review.path}`),
      acceptance: validIds(review.acceptanceIds ?? [], catalog.acceptance, 'acceptance', `${review.path}`),
    }
    requireValue(confirmed.features.size + confirmed.requirements.size + confirmed.acceptance.size > 0,
      `${review.path}: frt-impact-confirmed needs at least one valid F/R/T id`)
    for (const id of confirmed.features) { if (!features.has(id)) { features.add(id); added.features.push(id) } }
    for (const id of confirmed.requirements) { if (!requirements.has(id)) { requirements.add(id); added.requirements.push(id) } }
    for (const id of confirmed.acceptance) { if (!acceptance.has(id)) { acceptance.add(id); added.acceptance.push(id) } }
    fileDispositions.push({ path: review.path, ...(review.oldPath === undefined ? {} : { oldPath: review.oldPath }),
      disposition: 'frt-impact-confirmed',
      featureIds: [...confirmed.features], requirementIds: [...confirmed.requirements], acceptanceIds: [...confirmed.acceptance] })
  }
  return {
    sourceRepository: proposal.sourceRepository.id,
    features: [...features].sort(), requirements: [...requirements].sort(), acceptance: [...acceptance].sort(),
    addedFeatures: added.features.sort(), addedRequirements: added.requirements.sort(), addedAcceptance: added.acceptance.sort(),
    fileDispositions,
    behaviorVerified: false,
  }
}

// Materialize the exact candidate object tree into an isolated directory and verify every file against
// its Git blob, so a dirty governance root cannot masquerade as candidate evidence.
export async function materializeCandidate(repoRoot, candidate, targetDir) {
  requireValue(FULL_SHA.test(candidate ?? ''), 'A complete candidate SHA is required to materialize candidate source')
  await mkdir(targetDir, { recursive: true })
  requireValue((await lstat(targetDir)).isDirectory() && !(await lstat(targetDir)).isSymbolicLink()
    && (await readdir(targetDir)).length === 0, 'Candidate target must be an empty non-link directory')
  // git archive applies core.autocrlf/export-subst/export-ignore. Read raw objects
  // instead: neither worktree settings nor archive filters may alter evidence.
  const listing = await executeFile('git', ['-C', repoRoot, 'ls-tree', '-r', '-z', candidate],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 })
  const tree = new Map()
  for (const line of listing.stdout.split('\0').filter(Boolean)) {
    const split = line.indexOf('\t')
    const [mode, kind, blob] = line.slice(0, split).trim().split(/\s+/)
    const path = line.slice(split + 1)
    portablePath(path, 'candidate tree')
    requireValue(!path.split('/').some(part => part.toLowerCase() === '.git')
      && ['100644', '100755'].includes(mode) && kind === 'blob' && /^[a-f0-9]{40}$/.test(blob),
    `candidate tree: unsupported entry ${path}`)
    tree.set(path, { blob, mode })
  }
  const objects = await new Promise((resolveObjects, rejectObjects) => {
    const child = spawn('git', ['-C', repoRoot, 'cat-file', '--batch'], { windowsHide: true, shell: false })
    const chunks = [], errors = []
    let length = 0, overflow = false
    child.on('error', rejectObjects)
    child.stdin.on('error', rejectObjects)
    child.stdout.on('data', chunk => {
      length += chunk.length
      if (length > 256 * 1024 * 1024) { overflow = true; child.kill(); return }
      chunks.push(chunk)
    })
    child.stderr.on('data', chunk => { if (errors.length < 16) errors.push(chunk) })
    child.on('close', code => {
      if (overflow || code !== 0) rejectObjects(new Error(`Candidate Git object read failed: ${overflow ? 'size limit' : Buffer.concat(errors).toString('utf8')}`))
      else resolveObjects(Buffer.concat(chunks))
    })
    child.stdin.end([...tree.values()].map(({ blob }) => `${blob}\n`).join(''))
  })
  let offset = 0
  for (const [path, { blob, mode }] of tree) {
    const end = objects.indexOf(10, offset)
    const [actualBlob, kind, sizeText] = objects.subarray(offset, end).toString('ascii').split(' ')
    const size = Number(sizeText)
    requireValue(end >= offset && actualBlob === blob && kind === 'blob' && Number.isSafeInteger(size) && size >= 0
      && end + size + 1 < objects.length && objects[end + size + 1] === 10, `Malformed candidate Git blob: ${path}`)
    const data = objects.subarray(end + 1, end + size + 1)
    requireValue(gitBlob(data) === blob, `Candidate Git object mismatch: ${path}`)
    const absolute = join(targetDir, path)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, data, { flag: 'wx' })
    if (mode === '100755' && process.platform !== 'win32') await chmod(absolute, 0o755)
    const bytes = await readFile(join(targetDir, path))
    requireValue(gitBlob(bytes) === blob, `candidate materialization mismatch: ${path} does not equal the ${candidate} Git blob`)
    offset = end + size + 2
  }
  requireValue(offset === objects.length, 'Unexpected trailing candidate Git object bytes')
  const candidateTreeSha256 = sha256([...tree.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([path, { blob, mode }]) => `${path}\0${mode}\0${blob}\n`).join(''))
  return { candidateTreeSha256, fileCount: tree.size, candidate }
}

function validateReviewRows(rows, expectedIds, kind) {
  requireValue(Array.isArray(rows), `${kind} reviews must be an array`)
  const byId = new Map()
  for (const row of rows) {
    requireValue(row && typeof row.id === 'string' && !byId.has(row.id), `${kind} review ids must be unique`)
    requireValue(row.status === 'affected' && typeof row.reason === 'string' && row.reason.trim(),
      `${kind} ${row.id}: explicit affected disposition and reason are required`)
    byId.set(row.id, row)
  }
  requireValue(byId.size === expectedIds.size && [...expectedIds].every(id => byId.has(id)),
    `${kind} reviews must cover exactly the candidate-bound impact set: ${[...expectedIds].sort().join(', ') || 'empty'}`)
}

function validateApproval({ approval, proposal, proposalBinding, selectedRegressions, effectiveImpact, source }) {
  requireValue(approval?.schemaVersion === 1 && approval.kind === 'candidate-increment-approval',
    'Approval must use the candidate-increment-approval schema')
  requireValue(approval.decision === 'include', 'Approval does not explicitly decide include')
  requireValue(approval.sourceRepository === proposal.sourceRepository.id
    && isDeepStrictEqual(approval.commits, proposal.commits), 'Approval source/baseline/candidate do not match the proposal')
  requireValue(approval.proposal?.sha256 === proposalBinding.sha256
    && approval.proposal.mechanicalSha256 === proposalBinding.mechanicalSha256
    && isDeepStrictEqual(approval.proposal.generator, proposalBinding.generator)
    && isDeepStrictEqual(approval.proposal.inputs, proposalBinding.inputs),
  'Approval is stale: proposal bytes, mechanical hash, generator or source inputs differ')
  requireValue(typeof approval.reviewer?.id === 'string' && approval.reviewer.id.trim()
    && !Number.isNaN(Date.parse(approval.reviewer.reviewedAt ?? '')), 'Reviewer identity and reviewedAt are required')
  requireValue(typeof approval.targetVersion === 'string'
    && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(approval.targetVersion), 'A non-empty semantic targetVersion is required')

  const expectedFiles = new Map(proposal.files.map(file => [fileKey(file), file]))
  requireValue(Array.isArray(approval.fileReviews) && approval.fileReviews.length === expectedFiles.size,
    'Every candidate file needs exactly one reviewer disposition')
  const reviewed = new Set()
  for (const review of approval.fileReviews) {
    const key = `${review.oldPath ?? ''}\0${review.path}`
    const file = expectedFiles.get(key)
    requireValue(file && !reviewed.has(key), `File review does not match a candidate diff row: ${review.path}`)
    reviewed.add(key)
    requireValue(typeof review.reason === 'string' && review.reason.trim(), `${review.path}: reviewer reason is required`)
    if (file.mapping.kind === 'unknown') {
      requireValue(['no-frt-impact', 'frt-impact-confirmed'].includes(review.disposition),
        `${review.path}: unknown file requires explicit no-frt-impact or frt-impact-confirmed`)
      const ids = {
        features: review.featureIds ?? [], requirements: review.requirementIds ?? [], acceptance: review.acceptanceIds ?? [],
      }
      for (const [kind, values] of Object.entries(ids)) {
        requireValue(Array.isArray(values) && values.every(id => typeof id === 'string' && id), `${review.path}: invalid ${kind} ids`)
        if (review.disposition === 'no-frt-impact') requireValue(values.length === 0, `${review.path}: no-frt-impact cannot add F/R/T ids`)
      }
      if (review.disposition === 'frt-impact-confirmed') {
        requireValue(Object.values(ids).some(values => values.length > 0), `${review.path}: frt-impact-confirmed needs at least one F/R/T id`)
      }
    } else requireValue(review.disposition === 'mapping-confirmed', `${review.path}: direct/inferred mapping must remain visible and confirmed`)
  }
  requireValue(reviewed.size === expectedFiles.size, 'Not every unknown/candidate file was disposed by the reviewer')

  validateReviewRows(approval.featureReviews, new Set(effectiveImpact.features), 'F')
  validateReviewRows(approval.requirementReviews, new Set(effectiveImpact.requirements), 'R')
  validateReviewRows(approval.acceptanceReviews, new Set(effectiveImpact.acceptance), 'T')

  for (const kind of ['interface', 'data']) {
    const migration = approval.migrations?.[kind]
    requireValue(migration && ['required', 'none'].includes(migration.status)
      && typeof migration.reason === 'string' && migration.reason.trim()
      && (migration.status === 'none' || (typeof migration.plan === 'string' && migration.plan.trim())),
    `${kind} migration review must be required with a plan or none with a reason`)
  }
  const dsMigration = validateDsMigration(approval.dsMigration, source)
  requireValue(Array.isArray(approval.risks) && approval.risks.length === RISK_AREAS.length,
    'All five risk areas require reviewer disposition')
  for (const area of RISK_AREAS) {
    const matches = approval.risks.filter(risk => risk.area === area)
    requireValue(matches.length === 1 && ['accepted', 'mitigated', 'none'].includes(matches[0].status)
      && typeof matches[0].reason === 'string' && matches[0].reason.trim(),
    `${area}: risk remains review-required until an explicit disposition and reason are supplied`)
  }
  requireValue(isDeepStrictEqual(approval.regressionIds, selectedRegressions.map(regression => regression.id)),
    'Approval regressionIds do not match the F/R/T impact-derived controlled regression set')
  return {
    reviewer: approval.reviewer,
    files: approval.fileReviews,
    features: approval.featureReviews,
    requirements: approval.requirementReviews,
    acceptance: approval.acceptanceReviews,
    migrations: approval.migrations,
    risks: approval.risks,
    dsMigration,
  }
}

// DS inclusion must bind an explicit candidate SOURCE/vendor migration plan and before/after manifest
// hashes. Without it a DS increment cannot advance baseline/inventory/SOURCE/vendor consistently.
function validateDsMigration(dsMigration, source) {
  if (source !== 'DS') {
    requireValue(dsMigration === undefined || dsMigration === null,
      'dsMigration is only valid for a DS source')
    return null
  }
  requireValue(dsMigration && typeof dsMigration === 'object', 'DS inclusion requires an explicit dsMigration review')
  requireValue(['required', 'none'].includes(dsMigration.status)
    && typeof dsMigration.reason === 'string' && dsMigration.reason.trim(),
    'DS dsMigration needs status required|none and a reason')
  requireValue(dsMigration.vendorSource === 'candidate',
    'DS dsMigration.vendorSource must be candidate: vendor bytes are materialized from the candidate object tree')
  for (const side of ['before', 'after']) {
    const manifest = dsMigration[side]
    requireValue(manifest && HASH.test(manifest.manifestSha256 ?? '') && Number.isInteger(manifest.fileCount)
      && manifest.fileCount > 0, `DS dsMigration.${side} needs manifestSha256 and a positive fileCount`)
  }
  if (dsMigration.status === 'required') {
    requireValue(typeof dsMigration.plan === 'string' && dsMigration.plan.trim(),
      'DS dsMigration.status=required needs a plan')
  }
  return {
    status: dsMigration.status,
    reason: dsMigration.reason,
    vendorSource: dsMigration.vendorSource,
    before: { manifestSha256: dsMigration.before.manifestSha256, fileCount: dsMigration.before.fileCount },
    after: { manifestSha256: dsMigration.after.manifestSha256, fileCount: dsMigration.after.fileCount },
    ...(dsMigration.plan === undefined ? {} : { plan: dsMigration.plan }),
  }
}

async function assertControlledScript(root, relativePath) {
  portablePath(relativePath, 'regression script')
  requireValue(relativePath.startsWith('tests/') && relativePath.endsWith('.mjs'), 'Regression script must be a test-owned .mjs file')
  const canonicalRoot = await realpath(root)
  const absolute = resolve(root, relativePath)
  const info = await lstat(absolute)
  requireValue(info.isFile() && !info.isSymbolicLink(), `Controlled regression is missing or linked: ${relativePath}`)
  const canonical = await realpath(absolute)
  const part = relative(canonicalRoot, canonical)
  requireValue(part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part), 'Controlled regression escapes the project root')
  return absolute
}

// Preflight the fixed catalog before any write: every registered script must be a regular, non-link,
// test-owned .mjs inside the root. Approval text is never consulted as a command.
export async function preflightRegressionCatalog(root) {
  const harness = {}
  for (const [id, regression] of Object.entries(REGRESSION_CATALOG)) {
    const absolute = await assertControlledScript(root, regression.file)
    harness[id] = { file: regression.file, sha256: sha256(await readFile(absolute)) }
  }
  return harness
}

async function runOneRegression(root, regression, context, outputDirectory, outputRelative, candidate, harness) {
  const script = await assertControlledScript(root, regression.file)
  const args = [script,
    '--source', context.sourceRepository.toLowerCase(),
    '--baseline', context.commits.baseline,
    '--candidate', context.commits.candidate,
    '--increment-id', context.id,
    '--candidate-root', candidate.candidateRoot,
  ]
  const startedAt = new Date().toISOString()
  const result = await new Promise(resolveResult => {
    execFile(process.execPath, args, {
      cwd: candidate.candidateRoot,
      shell: false,
      windowsHide: true,
      timeout: 30_000,
      killSignal: 'SIGTERM',
      maxBuffer: 4 * 1024 * 1024,
      env: {
        PATH: process.env.PATH ?? '',
        SystemRoot: process.env.SystemRoot ?? '',
        windir: process.env.windir ?? '',
        TEMP: process.env.TEMP ?? '',
        TMP: process.env.TMP ?? '',
      },
    }, (error, stdout, stderr) => resolveResult({ error, stdout, stderr }))
  })
  const finishedAt = new Date().toISOString()
  const stem = regression.id.replace(/[^A-Za-z0-9.-]/g, '-')
  const stdoutPath = join(outputDirectory, `${stem}.stdout.log`)
  const stderrPath = join(outputDirectory, `${stem}.stderr.log`)
  const stdout = Buffer.from(result.stdout ?? '', 'utf8')
  const stderr = Buffer.from(result.stderr ?? '', 'utf8')
  await writeFile(stdoutPath, stdout)
  await writeFile(stderrPath, stderr)
  const exitCode = result.error ? (typeof result.error.code === 'number' ? result.error.code : null) : 0
  return {
    id: regression.id,
    status: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
    signal: result.error?.signal ?? null,
    startedAt,
    finishedAt,
    command: {
      executable: process.execPath,
      args: [regression.file, ...args.slice(1)],
      cwd: 'candidate-root',
      shell: false,
      timeoutMs: 30_000,
    },
    candidateRoot: candidate.candidateRoot,
    candidateTreeSha256: candidate.candidateTreeSha256,
    harnessSha256: harness[regression.id]?.sha256 ?? null,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    logFiles: {
      stdout: `${outputRelative}/${stem}.stdout.log`,
      stderr: `${outputRelative}/${stem}.stderr.log`,
    },
    error: result.error ? { code: String(result.error.code), message: result.error.message } : null,
  }
}

export async function runAffectedRegressions({ root, repoRoot, regressions, context, outputDirectory, outputRelative, harness }) {
  const staging = await mkdtemp(join(tmpdir(), 'k47-candidate-'))
  const candidateRoot = join(staging, 'tree')
  try {
    const { candidateTreeSha256 } = await materializeCandidate(repoRoot, context.commits.candidate, candidateRoot)
    const candidate = { candidateRoot, candidateTreeSha256 }
    const results = []
    for (const regression of regressions) {
      results.push(await runOneRegression(root, regression, context, outputDirectory, outputRelative, candidate, harness))
    }
    return { results, candidate }
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}

async function regularFiles(directory, prefix = '') {
  const info = await lstat(directory)
  requireValue(info.isDirectory() && !info.isSymbolicLink(), `DS vendor directory must be non-linked: ${prefix}`)
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    portablePath(path, 'DS vendor')
    const absolute = join(directory, entry.name), current = await lstat(absolute)
    requireValue(!current.isSymbolicLink(), `DS vendor link is unsupported: ${path}`)
    if (current.isDirectory()) files.push(...await regularFiles(absolute, path))
    else { requireValue(current.isFile(), `DS vendor entry must be a regular file: ${path}`); files.push(path) }
  }
  return files.sort()
}

export async function buildDsManifest(candidateRoot, previousManifest, candidate) {
  requireValue(previousManifest?.schemaVersion === 1 && FULL_SHA.test(candidate), 'DS SOURCE identity is invalid')
  const paths = ['LICENSE', 'NOTICE', ...await regularFiles(join(candidateRoot, 'ds-bot'), 'ds-bot')].sort()
  const files = []
  for (const sourcePath of paths) {
    const path = sourcePath === 'LICENSE' ? 'vendor/ds-bot/UPSTREAM_LICENSE'
      : sourcePath === 'NOTICE' ? 'vendor/ds-bot/UPSTREAM_NOTICE' : `vendor/${sourcePath}`
    requireValue(!files.some(file => file.path === path), `DS candidate vendor mapping collision: ${path}`)
    const bytes = await readFile(join(candidateRoot, sourcePath))
    files.push({ path, sourcePath, sha256: sha256(bytes), gitBlob: gitBlob(bytes) })
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return { ...previousManifest, commit: candidate, files }
}

async function stageDsMigration({ root, repoRoot, candidate, review, outputDirectory, baseline }) {
  const before = await readJsonFile(join(root, DS_SOURCE_MANIFEST))
  requireValue(before.value.commit === baseline && Array.isArray(before.value.files), 'DS SOURCE does not match the pre-inclusion baseline')
  requireValue(before.sha256 === review.before.manifestSha256 && before.value.files.length === review.before.fileCount,
    'DS migration before-manifest binding is stale')
  const vendor = join(root, 'modules/bot-runtime/vendor/ds-bot')
  const oldPaths = (await regularFiles(vendor)).map(path => `vendor/ds-bot/${path}`)
  requireValue(isDeepStrictEqual(oldPaths, before.value.files.map(file => file.path).sort()), 'DS vendor contains missing or untracked files; refuse migration')
  for (const file of before.value.files) {
    portablePath(file.path, 'DS SOURCE path'); portablePath(file.sourcePath, 'DS SOURCE sourcePath')
    const bytes = await readFile(join(root, 'modules/bot-runtime', file.path))
    requireValue(sha256(bytes) === file.sha256 && gitBlob(bytes) === file.gitBlob, `DS vendor before bytes differ: ${file.path}`)
  }
  const tree = join(outputDirectory, 'ds-candidate-tree')
  const materialized = await materializeCandidate(repoRoot, candidate, tree)
  const after = await buildDsManifest(tree, before.value, candidate), afterBytes = jsonBytes(after)
  requireValue(sha256(afterBytes) === review.after.manifestSha256 && after.files.length === review.after.fileCount,
    'DS migration after-manifest binding is stale')
  const stagedVendor = join(outputDirectory, 'ds-vendor-candidate')
  await mkdir(stagedVendor)
  for (const file of after.files) {
    const destination = join(stagedVendor, file.path.slice('vendor/ds-bot/'.length))
    await mkdir(dirname(destination), { recursive: true })
    const bytes = await readFile(join(tree, file.sourcePath))
    await writeFile(destination, bytes, { flag: 'wx' })
    requireValue(gitBlob(await readFile(destination)) === file.gitBlob, `DS staged vendor differs: ${file.path}`)
  }
  await atomicWrite(join(outputDirectory, 'SOURCE.candidate.json'), afterBytes)
  return { before, after, afterBytes, vendor, stagedVendor, backupVendor: join(outputDirectory, 'ds-vendor-original'),
    candidateTreeSha256: materialized.candidateTreeSha256,
    evidence: { before: review.before, after: review.after, candidateTreeSha256: materialized.candidateTreeSha256,
      added: after.files.filter(file => !before.value.files.some(old => old.path === file.path)).map(file => file.path),
      deleted: before.value.files.filter(file => !after.files.some(next => next.path === file.path)).map(file => file.path) } }
}

export async function includeIncrement(options) {
  const {
    root = ROOT, sourceId, candidate, proposal: proposalPath, approval: approvalPath,
    output, dsRoot, sourceRoot, mrRoot,
  } = options
  requireValue(SOURCES.has(sourceId) && FULL_SHA.test(candidate ?? ''), 'A source and complete candidate SHA are required')
  await assertNoInclusionTransaction(root)
  const source = sourceId.toUpperCase()
  const [baselineFile, inventoryFile, ledgerFile, proposal, approvalFile] = await Promise.all([
    readJsonFile(join(root, LOCK_PATHS[0])),
    readJsonFile(join(root, LOCK_PATHS[1])),
    readJsonFile(join(root, LOCK_PATHS[2])),
    readTemporaryJson(root, proposalPath, '--proposal'),
    readTemporaryJson(root, approvalPath, '--approval'),
  ])
  validateIncludedIncrements({ baseline: baselineFile.value, inventory: inventoryFile.value, includedIncrements: ledgerFile.value })
  await validateIncludedRegressionEvidence(root, ledgerFile.value)
  validateDocument(proposal.value)
  requireValue(proposal.value.sourceRepository.id === source, 'Proposal source differs from include source')
  requireValue(proposal.value.commits.candidate === candidate, 'Candidate does not match the proposal')
  requireValue(proposal.value.commits.baseline === baselineFile.value.repositories[source].commit,
    'Baseline drift: proposal baseline differs from the current isolated baseline')
  requireValue(!proposal.value.relationship.zeroDelta && candidate !== proposal.value.commits.baseline,
    'A non-zero increment is required')

  const repositories = {
    MR: mrRoot ?? (source === 'MR' ? sourceRoot ?? root : root),
    DS: dsRoot,
  }
  if (source === 'DS') repositories.DS = sourceRoot ?? dsRoot
  const rebuilt = await buildProposal({
    root, sourceId, candidate, generatedAt: proposal.value.generatedAt, repositories,
  })
  requireValue(rebuilt.document.mechanicalSha256 === proposal.value.mechanicalSha256
    && isDeepStrictEqual(rebuilt.document.files, proposal.value.files)
    && isDeepStrictEqual(rebuilt.document.functionalSnapshot, proposal.value.functionalSnapshot)
    && rebuilt.document.generator.sha256 === proposal.value.generator.sha256,
  'Stale proposal: current objects or generator no longer reproduce the mechanical diff')
  const currentInputs = rebuilt.document.inputs.map(input => ({ path: input.path, sha256: input.sha256 }))
  requireValue(isDeepStrictEqual(currentInputs, proposal.value.inputs.map(input => ({ path: input.path, sha256: input.sha256 }))),
    'Stale proposal: a source input hash changed')
  const proposalBinding = bindingView(proposal)
  const catalog = await loadScopeCatalog(root)
  const effectiveImpact = computeEffectiveImpact({ proposal: proposal.value, approval: approvalFile.value, catalog })
  const selectedRegressions = selectAffectedRegressions(effectiveImpact)
  requireValue(selectedRegressions.length > 0, 'No controlled affected regression is registered for this candidate impact set')
  const review = validateApproval({
    approval: approvalFile.value, proposal: proposal.value, proposalBinding, selectedRegressions, effectiveImpact, source,
  })
  const harness = await preflightRegressionCatalog(root)
  const repoRoot = repositories[source]
  const outputDirectory = await prepareEvidenceDirectory(root, output)
  const originals = new Map([
    [LOCK_PATHS[0], baselineFile.bytes],
    [LOCK_PATHS[1], inventoryFile.bytes],
    [LOCK_PATHS[2], ledgerFile.bytes],
  ])
  const beforeSha256 = Object.fromEntries([...originals].map(([path, bytes]) => [path, sha256(bytes)]))
  const id = `${source}:${candidate}`
  const transactionPath = join(outputDirectory, 'transaction.json')
  const transaction = {
    schemaVersion: 1,
    kind: 'included-increment-transaction',
    id,
    sourceRepository: source,
    ownerPid: process.pid,
    startedAt: new Date().toISOString(),
    state: 'prepared',
    beforeSha256,
    locks: LOCK_PATHS,
    recovery: 'On a non-complete state, do not include again; inspect originals recorded in inclusion-result.json and the ledger-chain gate.',
  }
  let transactionStarted = false
  let finalized = false
  let regressions = []
  let markerOwned = false, dsMigration = null, vendorMoved = false, vendorPublished = false
  const markerPath = join(root, TRANSACTION_MARKER)
  try {
    // Exclusive creation is the concurrency admission point. A crash leaves the
    // marker in place; every normal gate rejects it, even before lock mutation.
    const marker = await open(markerPath, 'wx')
    markerOwned = true
    try { await marker.writeFile(jsonBytes({ ...transaction, output })); await marker.sync() } finally { await marker.close() }
    await atomicWrite(transactionPath, jsonBytes(transaction))
    transactionStarted = true
    const nextBaseline = structuredClone(baselineFile.value)
    nextBaseline.repositories[source].commit = candidate
    const nextInventory = await buildInventory({ root, dsRoot: repositories.DS, mrRoot: repositories.MR, baseline: nextBaseline })
    if (source === 'DS') {
      dsMigration = await stageDsMigration({ root, repoRoot, candidate, review: review.dsMigration,
        outputDirectory, baseline: proposal.value.commits.baseline })
      originals.set(DS_SOURCE_MANIFEST, dsMigration.before.bytes)
      beforeSha256[DS_SOURCE_MANIFEST] = dsMigration.before.sha256
      transaction.locks = [...LOCK_PATHS, DS_SOURCE_MANIFEST, 'modules/bot-runtime/vendor/ds-bot']
      transaction.dsMigration = dsMigration.evidence
    }
    // Persist exact originals before the first publication, not just hashes, so
    // bounded recovery can restore the pre-transaction bytes after process death.
    for (const [path, bytes] of originals) {
      const backup = join(outputDirectory, 'originals', path)
      await mkdir(dirname(backup), { recursive: true }); await writeFile(backup, bytes, { flag: 'wx' })
    }
    const mutablePaths = [...originals.keys()]
    const pendingLedger = structuredClone(ledgerFile.value)
    const record = {
      id,
      sourceRepository: source,
      commits: { baseline: proposal.value.commits.baseline, candidate },
      targetVersion: approvalFile.value.targetVersion,
      proposal: proposalBinding,
      approvalSha256: approvalFile.sha256,
      functionalSnapshot: structuredClone(proposal.value.functionalSnapshot),
      effectiveImpact,
      review,
      regressions: [],
      regressionSummary: { status: 'pending', total: selectedRegressions.length, passed: 0, failed: 0 },
      status: 'regression-pending',
      includedAt: null,
    }
    pendingLedger.increments.push(record)
    transaction.state = 'candidate-staged-regressions-pending'
    await atomicWrite(transactionPath, jsonBytes(transaction))
    await atomicWrite(markerPath, jsonBytes({ ...transaction, output }))
    await options.onBoundary?.({ point: 'candidate-staged' })

    regressions = await runAffectedRegressions({
      root,
      repoRoot,
      regressions: selectedRegressions,
      context: record,
      outputDirectory,
      outputRelative: output,
      harness,
    })
    const candidateTree = regressions.candidate
    regressions = regressions.results
    const failed = regressions.filter(regression => regression.status !== 'passed')
    requireValue(failed.length === 0,
      `Affected regression failed: ${failed.map(regression => `${regression.id} exit=${regression.exitCode ?? 'unknown'}`).join(', ')}`)

    record.regressions = regressions
    record.regressionSummary = {
      status: 'passed', total: regressions.length,
      passed: regressions.length, failed: 0,
    }
    record.status = 'included'
    record.includedAt = new Date().toISOString()
    validateIncludedIncrements({
      baseline: nextBaseline, inventory: nextInventory, includedIncrements: pendingLedger,
    })
    await validateIncludedRegressionEvidence(root, pendingLedger)
    // Reject concurrent governance edits rather than clobbering another writer.
    for (const [path, bytes] of originals) requireValue((await readFile(join(root, path))).equals(bytes), `Inclusion input changed during staging: ${path}`)
    transaction.afterSha256 = Object.fromEntries([
      [LOCK_PATHS[0], sha256(jsonBytes(nextBaseline))],
      [LOCK_PATHS[1], sha256(jsonBytes(nextInventory))],
      [LOCK_PATHS[2], sha256(jsonBytes(pendingLedger))],
      ...(dsMigration ? [[DS_SOURCE_MANIFEST, sha256(dsMigration.afterBytes)]] : []),
    ])
    transaction.state = 'publishing'
    await atomicWrite(transactionPath, jsonBytes(transaction))
    await atomicWrite(markerPath, jsonBytes({ ...transaction, output }))
    if (dsMigration) {
      await rename(dsMigration.vendor, dsMigration.backupVendor); vendorMoved = true
      await options.onBoundary?.({ point: 'vendor-original-moved' })
      await rename(dsMigration.stagedVendor, dsMigration.vendor); vendorPublished = true
      await options.onBoundary?.({ point: 'vendor-published' })
      await atomicWrite(join(root, DS_SOURCE_MANIFEST), dsMigration.afterBytes)
      await options.onBoundary?.({ point: 'source-published' })
    }
    await atomicWrite(join(root, LOCK_PATHS[0]), jsonBytes(nextBaseline))
    await options.onBoundary?.({ point: 'baseline-published' })
    await atomicWrite(join(root, LOCK_PATHS[1]), jsonBytes(nextInventory))
    await options.onBoundary?.({ point: 'inventory-published' })
    await atomicWrite(join(root, LOCK_PATHS[2]), jsonBytes(pendingLedger))
    await options.onBoundary?.({ point: 'ledger-published' })
    transaction.state = 'completed'
    await atomicWrite(transactionPath, jsonBytes(transaction))
    const result = {
      schemaVersion: 1,
      kind: 'included-increment-result',
      status: 'included',
      id,
      sourceRepository: source,
      commits: record.commits,
      targetVersion: record.targetVersion,
      proposal: proposalBinding,
      approvalSha256: approvalFile.sha256,
      functionalSnapshot: structuredClone(proposal.value.functionalSnapshot),
      effectiveImpact,
      candidateTreeSha256: candidateTree.candidateTreeSha256,
      ...(dsMigration ? { dsMigration: dsMigration.evidence } : {}),
      review,
      regressions,
      beforeSha256,
      afterSha256: Object.fromEntries(await Promise.all(mutablePaths.map(async path => [path, sha256(await readFile(join(root, path)))]))),
      recovery: 'completed; no rollback needed',
    }
    await atomicWrite(join(outputDirectory, 'inclusion-result.json'), jsonBytes(result))
    await rm(markerPath)
    markerOwned = false
    finalized = true
    return { result, record, outputDirectory }
  } catch (error) {
    let recovery = 'not-started'
    let recoveryError = null
    if (markerOwned && !finalized) {
      try {
        if (dsMigration && vendorMoved) {
          // Keep the failed candidate for inspection, never delete arbitrary work.
          if (vendorPublished) await rename(dsMigration.vendor, join(outputDirectory, 'ds-vendor-failed'))
          await rename(dsMigration.backupVendor, dsMigration.vendor)
        }
        for (const [path, bytes] of originals) await atomicWrite(join(root, path), bytes)
        for (const [path, bytes] of originals) {
          requireValue((await readFile(join(root, path))).equals(bytes), `Rollback hash mismatch: ${path}`)
        }
        recovery = 'rolled-back'
      } catch (rollbackFailure) {
        recovery = 'recovery-required'
        recoveryError = rollbackFailure.message
      }
      transaction.state = recovery === 'rolled-back' ? 'failed-rolled-back' : 'recovery-required'
      transaction.error = error.message
      transaction.recoveryError = recoveryError
      await atomicWrite(transactionPath, jsonBytes(transaction)).catch(() => {})
      if (recovery === 'rolled-back') { await rm(markerPath); markerOwned = false }
      else await atomicWrite(markerPath, jsonBytes({ ...transaction, output })).catch(() => {})
    }
    const result = {
      schemaVersion: 1,
      kind: 'included-increment-result',
      status: 'failed',
      id,
      sourceRepository: source,
      commits: { baseline: proposal.value.commits.baseline, candidate },
      proposal: proposalBinding,
      approvalSha256: approvalFile.sha256,
      regressions,
      beforeSha256,
      afterSha256: Object.fromEntries(await Promise.all(LOCK_PATHS.map(async path => [path, sha256(await readFile(join(root, path)))]))),
      error: error.message,
      recovery,
      recoveryError,
    }
    await atomicWrite(join(outputDirectory, 'inclusion-result.json'), jsonBytes(result)).catch(() => {})
    error.message = `${error.message}; inclusion status=failed, recovery=${recovery}; evidence=${output}/inclusion-result.json`
    throw error
  }
}

async function main(argv) {
  const options = parseArgs(argv)
  if (options.help) {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  const { result, outputDirectory } = await includeIncrement(options)
  process.stdout.write([
    `Included ${result.id} for ${result.targetVersion}; affected regressions ${result.regressions.length}/${result.regressions.length} passed.`,
    `Updated isolated baseline/inventory/ledger only under ${options.root}; evidence ${join(outputDirectory, 'inclusion-result.json')}`,
    '',
  ].join('\n'))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}

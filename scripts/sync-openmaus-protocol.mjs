import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const target = join(root, 'modules/openmaus-protocol')
const commit = '1bc4749aa8307d7d6998bf86de4ef6478460dd93'
const paths = ['companion/src/e2e/credentials.ts', 'companion/src/e2e/noise.ts', 'companion/src/e2e/descriptor.ts', 'companion/src/e2e/yamux.ts', 'companion/src/e2e/session.ts', 'companion/src/e2e/phone.ts', 'companion/src/e2e/vectors/v1.json', 'companion/src/e2e/vectors/v1.sha256', 'companion/src/e2e/README.md', 'LICENSE']
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

export async function syncOpenmausProtocol({ source, check = false } = {}) {
  if (!source) {
    const manifest = JSON.parse(await readFile(join(target, 'SOURCE.json'), 'utf8'))
    if (manifest.commit !== commit || manifest.files.length !== paths.length || new Set(manifest.files.map(file => file.source)).size !== paths.length) throw new Error('OPENMAUS_PROTOCOL_PROVENANCE_MISMATCH')
    for (const item of manifest.files) {
      if (!paths.includes(item.source) || item.target !== `vendor/${item.source}`) throw new Error('OPENMAUS_PROTOCOL_MEMBER_MISMATCH')
      if (hash(await readFile(join(target, item.target))) !== item.sha256) throw new Error(`OPENMAUS_PROTOCOL_BYTES_CHANGED: ${item.target}`)
    }
    return { status: 'passed', commit, files: manifest.files.length }
  }
  const checkout = resolve(source)
  if (execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim() !== commit) throw new Error('OPENMAUS_PROTOCOL_SOURCE_COMMIT_MISMATCH')
  const files = []
  for (const path of paths) {
    const checkedOut = await readFile(join(checkout, path)), relative = `vendor/${path}`
    const pinned = execFileSync('git', ['-C', checkout, 'show', `${commit}:${path}`], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
    if (checkedOut.toString('utf8').replaceAll('\r\n', '\n') !== pinned.toString('utf8').replaceAll('\r\n', '\n')) throw new Error(`OPENMAUS_PROTOCOL_SOURCE_DIRTY: ${path}`)
    const bytes = pinned
    if (check) {
      if (hash(await readFile(join(target, relative))) !== hash(bytes)) throw new Error(`OPENMAUS_PROTOCOL_BYTES_CHANGED: ${relative}`)
    } else {
      await mkdir(dirname(join(target, relative)), { recursive: true }); await writeFile(join(target, relative), bytes)
    }
    files.push({ source: path, target: relative, sha256: hash(bytes), bytes: bytes.length })
  }
  if (!check) await writeFile(join(target, 'SOURCE.json'), JSON.stringify({ schemaVersion: 1, upstream: 'https://github.com/milind-soni/OpenMausBot', commit, license: 'Apache-2.0', files }, null, 2) + '\n')
  return { status: 'passed', commit, files: files.length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--source')
  console.log(JSON.stringify(await syncOpenmausProtocol({ check: process.argv.includes('--check'), ...(index < 0 ? {} : { source: process.argv[index + 1] }) })))
}

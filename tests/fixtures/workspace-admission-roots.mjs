import { mkdirSync, statSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const digest = (dev, ino, generation) => createHash('sha256').update(`${dev}:${ino}:${generation}`).digest('hex')
const identityOfDirectory = directory => { const s = statSync(directory); return { dev: s.dev, ino: s.ino, generation: Math.round(s.birthtimeMs) } }

/** Verified identity snapshot for a real directory, built by a trusted producer. */
export function identityOf(directory) {
  const absolute = resolve(directory), chain = []
  let current = absolute
  for (let depth = 0; depth < 64; depth++) {
    const id = identityOfDirectory(current), key = digest(id.dev, id.ino, id.generation)
    if (!chain.includes(key)) chain.push(key)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return { key: chain[0], ancestors: chain, path: absolute, platform: process.platform }
}

/** A second absolute path for the same physical directory. */
export function makeAlias(target, linkPath) {
  try { symlinkSync(target, linkPath, 'dir') } catch { execFileSync('cmd.exe', ['/c', 'mklink', '/J', linkPath, target], { windowsHide: true }) }
  const a = identityOfDirectory(target), b = identityOfDirectory(linkPath)
  if (a.dev !== b.dev || a.ino !== b.ino) throw Error('FIXTURE_ALIAS_NOT_SAME_OBJECT')
  return linkPath
}

/** Synthetic physical tree: parent/{child,sibling} plus an independent root. */
export function syntheticTree(base) {
  const roots = join(base, 'roots')
  const tree = { roots, parent: join(roots, 'parent'), child: join(roots, 'parent', 'child'), sibling: join(roots, 'parent', 'sibling'), other: join(roots, 'other') }
  for (const path of Object.values(tree)) mkdirSync(path, { recursive: true })
  return tree
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const plan = resolve(import.meta.dirname, '../docs/integration/plan')
async function documents(directory) {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...await documents(path))
    else if (entry.name.endsWith('.md')) found.push(path)
  }
  return found
}

test('integration docs: all bundled local links resolve inside the portable plan', async () => {
  const base = await realpath(plan)
  let checked = 0
  for (const file of await documents(plan)) {
    const text = await readFile(file, 'utf8')
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^https?:\/\//.test(match[1])) continue
      const target = match[1].split('#')[0]
      if (!target) continue
      assert.ok(!isAbsolute(target) && !/^[A-Za-z]:/.test(target), 'no personal drive link')
      const actual = await realpath(resolve(file, '..', target))
      const part = relative(base, actual)
      assert.ok(part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part), 'link stays in source bundle')
      checked++
    }
  }
  assert.ok(checked >= 10)
})

test('integration docs: approved original proposal and review image retain their source bytes', async () => {
  const manifest = JSON.parse(await readFile(join(plan, '20261026_baseline_manifest.json'), 'utf8'))
  for (const [file, expected] of [
    ['references/20261026_original_proposal.md', manifest.originalProposalSha256],
    ['references/20261026_grok_review.png', manifest.reviewScreenshotSha256],
  ]) {
    assert.equal(createHash('sha256').update(await readFile(join(plan, file))).digest('hex'), expected)
  }
})

test('integration docs: combined plan includes each frozen R/F/T entry once', async () => {
  const text = await readFile(join(plan, '20261026_master_plan.md'), 'utf8')
  for (const [prefix, total] of [['R', 32], ['F', 40], ['T', 63]]) {
    const ids = [...text.matchAll(new RegExp(`^\\| (${prefix}\\d{2}) \\|`, 'gm'))].map(match => match[1])
    assert.equal(ids.length, total)
    assert.equal(new Set(ids).size, total)
  }
})

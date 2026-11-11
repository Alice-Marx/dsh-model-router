// Render both READMEs through GitHub's own Markdown API and check the formulas.
//
// The local checker can only prove the source is well formed: six paired display
// formulas, thirty-three paired inline expressions, matching counts across the
// two languages. Whether GitHub actually renders them as math is a different
// question, and it is the one readers see. This asks github.com.
//
// Requires an authenticated gh CLI (the same one used for releases).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = join(ROOT, 'tmp/gh-render')
const EXPECTED = { display: 6, inline: 33 }

/** GitHub's renderer, not ours. `gh api markdown` is the documented endpoint. */
function render(readmePath) {
  mkdirSync(OUT, { recursive: true })
  const body = join(OUT, `${readmePath.replace(/[^a-z]/gi, '-')}.json`)
  writeFileSync(body, JSON.stringify({ text: readFileSync(join(ROOT, readmePath), 'utf8'), mode: 'gfm' }))
  return execFileSync('gh', ['api', '-X', 'POST', 'markdown', '--input', body], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

const report = []
let failed = false
for (const readme of ['README.md', 'README.zh.md']) {
  const html = render(readme)
  const display = (html.match(/js-display-math/g) ?? []).length
  const inline = (html.match(/js-inline-math/g) ?? []).length
  // The failure this must catch is a formula regressing into a code block, not a
  // dollar sign in prose: README quotes real prices ($1/million, $0.0035), and
  // those are correct as text. So look inside every <code> for LaTeX.
  const codeBlocks = [...html.matchAll(/<code[^>]*>([\s\S]*?)<\/code>/g)].map((match) => match[1])
  const latexInCode = codeBlocks.filter((text) => /\$\$|\\frac|\\sum|\\prod|\\sqrt|\\left|\\begin\{/.test(text))
  const escaped = latexInCode.length
  const firstLeak = latexInCode[0]?.replace(/\s+/g, ' ').slice(0, 80) ?? null
  const ok = display === EXPECTED.display && inline === EXPECTED.inline && escaped === 0
  if (!ok) failed = true
  report.push({ readme, display, inline, expectedDisplay: EXPECTED.display, expectedInline: EXPECTED.inline, formulaInCode: escaped, firstLeak, ok })
}

process.stdout.write(`${JSON.stringify({ status: failed ? 'failed' : 'passed', renderer: 'github', mode: 'gfm', report }, null, 2)}\n`)
if (failed) process.exitCode = 1

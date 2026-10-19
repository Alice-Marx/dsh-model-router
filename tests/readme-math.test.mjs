import test from 'node:test'
import assert from 'node:assert/strict'
import { checkReadme, checkReadmePair } from '../scripts/check-readme.mjs'

const ids = ['actual-cost', 'planning-cost', 'cost-utility', 'latency-utility', 'candidate-utility', 'assignment-score']
const sample = ids.map(id => `<!-- formula:${id} -->\n\n\`\`\`math\nC = \\frac{I \\cdot p}{10^6}\n\`\`\``).join('\n\n')

test('six paired math fences accept single-line formulas, cases, whitespace and ordinary code examples', () => {
  const markdown = sample.replace('<!-- formula:latency-utility -->\n\n```math\nC = \\frac{I \\cdot p}{10^6}', '<!-- formula:latency-utility -->\n\n```math\nL = \\begin{cases}1 & t = 0\\\\ 0 & t > 0\\end{cases}')
    + '\n\nCosts are \\$1/million and \\$0.0035. Field `costUsd` and code `$HOME` / `\\[example\\]` are literal.\n\n'
    + '```powershell\n$example = "\\[literal\\]"\n<!-- formula:actual-cost -->\n```\n'
  const translated = markdown.replaceAll('\n', '\r\n').replace('C =', '  C =')
  assert.equal(checkReadme(markdown).ok, true)
  assert.deepEqual(checkReadmePair(markdown, translated).errors, [])
})

test('a formula cannot regress into a text or inline-code block', () => {
  const ordinary = checkReadme(sample.replace('```math', '```text'))
  assert.equal(ordinary.ok, false)
  assert.ok(ordinary.errors.some(error => error.includes('must use a math fence')))
  const inline = checkReadme(sample.replace('```math\nC = \\frac{I \\cdot p}{10^6}\n```', '`C = 1`'))
  assert.equal(inline.ok, false)
  assert.ok(inline.errors.some(error => error.includes('must be followed by a math fence')))
})

test('missing, duplicate, empty and unclosed formulas fail with useful errors', () => {
  for (const [markdown, message] of [
    [sample.replace('<!-- formula:actual-cost -->', ''), 'Missing formula anchor: actual-cost'],
    [sample + '\n\n<!-- formula:actual-cost -->\n```math\nC = 1\n```', 'Duplicate formula anchor: actual-cost'],
    [sample.replace('C = \\frac{I \\cdot p}{10^6}', ' '), 'Math fence must not be empty'],
    [sample.slice(0, -3), 'Unclosed math fence'],
  ]) {
    const result = checkReadme(markdown)
    assert.equal(result.ok, false)
    assert.ok(result.errors.some(error => error.includes(message)), result.errors.join('\n'))
  }
})

test('translation formula drift and unanchored math are rejected', () => {
  const result = checkReadmePair(sample, sample.replace('10^6', '10^3'))
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(error => error.includes('Formula actual-cost differs')))
  assert.ok(checkReadme(sample + '\n\n```math\nx = 1\n```').errors.some(error => error.includes('must follow a formula anchor')))
})

test('legacy delimiters and unescaped currency fail outside literal code', () => {
  for (const suffix of ['\\[ x = 1 \\]', '\\( x = 1 \\)', 'Price $1/million and $5/million.', 'Price \\\\$1.']) {
    assert.equal(checkReadme(sample + '\n\n' + suffix).ok, false, suffix)
  }
  assert.equal(checkReadme(sample + '\n\nPrice \\$1/million.').ok, true)
})

test('a macro rejected by the actual GitHub renderer cannot be reintroduced', () => {
  const result = checkReadme(sample.replace('C =', '\\operatorname{clamp}(x) ='))
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(error => error.includes('GitHub rejected operatorname')))
})

test('ordinary formulas remain on one line while genuine conditions may use cases', () => {
  const result = checkReadme(sample.replace('C = \\frac{I \\cdot p}{10^6}', '\\begin{aligned}C &= 1\\\\ &+2\\end{aligned}'))
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(error => error.includes('Keep ordinary formulas on one line')))
})

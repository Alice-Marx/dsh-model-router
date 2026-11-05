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
  for (const suffix of ['\\[ x = 1 \\]', '\\( x = 1 \\)', 'Price $1/million and $5/million.', 'Price $1/$5.', 'Price $1–$5.', 'Price \\\\$1.']) {
    assert.equal(checkReadme(sample + '\n\n' + suffix).ok, false, suffix)
  }
  assert.equal(checkReadme(sample + '\n\nPrice \\$1/million.').ok, true)
})

test('prose symbols render as inline math while implementation fields remain inline code', () => {
  const caption = '$C_a$ is `actualUsd`; $I_u$, $O$, $R$, and $W$ correspond to `inputTokens`, `outputTokens`, `cacheReadTokens`, and `cacheWriteTokens`. '
    + '$p_i$, $p_o$, $p_r$, and $p_w$ are prices; $U_c$ is `costUtility`, $\\Delta_p$ is `preferenceAdjustment`, and $\\rho_j$ uses `provider/model`.'
  const result = checkReadme(sample + '\n\n' + caption)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.inlineMath, ['C_a', 'I_u', 'O', 'R', 'W', 'p_i', 'p_o', 'p_r', 'p_w', 'U_c', '\\Delta_p', '\\rho_j'])
  for (const symbol of ['C_a', 'I_u', 'p_i', 'p_o', 'p_r', 'p_w', 'I', 'O', 'R', 'W', 'R/W', 'U_c', 'C_ref',
    'q', 'L', 't', 'ℓ', 'e_ℓ', 's/r/k', 's', 'r', 'k', 'f', 'α', 'Δ_p', 'w', 'S', 'E', 'ρ_j', 'j', 'n']) {
    const regression = checkReadme(sample + '\n\nSymbol `' + symbol + '` is mathematical.')
    assert.ok(regression.errors.some(error => error.includes('must use inline math')), symbol)
  }
})

test('inline math is single-line, nonempty and uses one dollar on each side', () => {
  for (const suffix of ['Unclosed $q', '$q\n+ r$', '$$', '$ $', '$ q$', '$q $', '$$q$$', '$q$$', '\\(q\\)', '\\[q\\]']) {
    assert.equal(checkReadme(sample + '\n\n' + suffix).ok, false, suffix)
  }
  const literals = '`$HOME` and `$unclosed` and `\\(code\\)`; \\$0.75.\n\n```js\nconst q = .75; const text = "$unclosed";\n```'
  assert.deepEqual(checkReadme(sample + '\n\n' + literals).errors, [])
})

test('paired inline math matches translation count, order and normalized content', () => {
  const english = sample + '\n\nQuality $q + r$ and cost $U_c$.'
  const chinese = sample + '\n\n质量 $`q   + r`$ 与费用 $`U_c`$。'
  assert.deepEqual(checkReadmePair(english, chinese).errors, [])
  assert.ok(checkReadmePair(english, sample + '\n\n只有 $q + r$。').errors.some(error => error.includes('Inline math counts differ')))
  assert.ok(checkReadmePair(english, chinese.replace('$`U_c`$', '$`C_a`$')).errors.some(error => error.includes('Inline math 2 differs')))
  assert.ok(checkReadmePair(english, sample + '\n\n$U_c$ 后跟 $q + r$。').errors.some(error => error.includes('Inline math 1 differs')))
})

test('GitHub enhanced inline math survives adjacent Chinese punctuation without becoming code', () => {
  const chinese = sample + '\n\n$`C_a`$ 对应 `actualUsd`；$`I_u`$、$`O`$、$`R`$/$`W`$ 分别对应 `inputTokens`、`outputTokens` 与缓存。'
  const result = checkReadme(chinese)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.inlineMath, ['C_a', 'I_u', 'O', 'R', 'W'])
  const english = sample + '\n\n$C_a$ is `actualUsd`; $I_u$, $O$, $R$ and $W$ are token counts.'
  assert.deepEqual(checkReadmePair(english, chinese).errors, [])
  for (const malformed of ['$`q$', '$q`$', '$`q``$', '$``$', '$` q`$', '$`q\n+ r`$']) {
    assert.equal(checkReadme(sample + '\n\n' + malformed).ok, false, malformed)
  }
  assert.ok(checkReadme(sample + '\n\n$`.28`$').errors.some(error => error.includes('leading zero')))
})

test('plain inline math cannot regress to known GitHub failures next to Chinese text or slashes', () => {
  for (const prose of ['成本$C_a$对应金额。', '$I_u$、$O$。', '$R$/$W$', '$q$，', '“$q$”', '/$q$', '$q$/']) {
    const result = checkReadme(sample + '\n\n' + prose)
    assert.ok(result.errors.some(error => error.includes('use enhanced $`...`$ delimiters')), prose)
  }
  for (const prose of ['成本$`C_a`$对应金额。', '$`I_u`$、$`O`$。', '$`R`$/$`W`$', '“$`q`$”', '/$`q`$/', 'Quality $q$ and $U_c$.']) {
    assert.deepEqual(checkReadme(sample + '\n\n' + prose).errors, [], prose)
  }
})

test('decimal fractions use a leading zero in prose, tables and formulas without flagging code or paths', () => {
  for (const suffix of ['Threshold is .75.', '质量下限.75。', '| Weight | .28 |', 'Weight $.28$ applies.', '$1/.5$', '$\\frac{.5}{1}$']) {
    const result = checkReadme(sample + '\n\n' + suffix)
    assert.ok(result.errors.some(error => error.includes('leading zero')), suffix)
  }
  assert.ok(checkReadme(sample.replace('C =', 'C = .28 +')).errors.some(error => error.includes('leading zero')))
  const valid = 'Threshold 0.75; weight $0.28$. Version 0.2.1 and 0.2.1-rc.2.\n'
    + '`const q = .75` and `$HOME` are code. [File](docs/.28.json) and docs/.28.json, F:\\models\\.28.json and .28.png are paths.\n\n'
    + '```js\nconst value = .75;\n```'
  assert.deepEqual(checkReadme(sample + '\n\n' + valid).errors, [])
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

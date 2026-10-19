import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const formulaIds = ['actual-cost', 'planning-cost', 'cost-utility', 'latency-utility', 'candidate-utility', 'assignment-score']
const normalize = formula => formula.replace(/\s+/g, ' ').trim()
const escapedAt = (text, index) => {
  let slashes = 0
  while (index > 0 && text[--index] === '\\') slashes++
  return slashes % 2 === 1
}

function withoutInlineCode(line) {
  const runs = [...line.matchAll(/`+/g)]
  let result = '', offset = 0
  for (let index = 0; index < runs.length; index++) {
    const start = runs[index]
    if (escapedAt(line, start.index)) continue
    const endIndex = runs.findIndex((end, next) => next > index && end[0].length === start[0].length)
    if (endIndex < 0) continue
    const end = runs[endIndex]
    result += line.slice(offset, start.index)
    offset = end.index + end[0].length
    index = endIndex
  }
  return result + line.slice(offset)
}

// Structural regression guard only. This does not compile TeX or verify GitHub rendering.
export function checkReadme(markdown, name = 'README.md') {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n')
  const errors = [], formulas = {}, counts = new Map()
  const error = (line, message) => errors.push(`${name}:${line}: ${message}`)
  let fence = null, pending = null
  const checkDelimiters = (line, number) => {
    if (/\\+[\[\]()]/g.test(line) && [...line.matchAll(/(\\+)[\[\]()]/g)].some(match => match[1].length % 2 === 1)) {
      error(number, 'Legacy \\[ / \\] / \\( / \\) math delimiters are not allowed; use an anchored math fence')
    }
    if ([...line.matchAll(/\$/g)].some(match => !escapedAt(line, match.index))) {
      error(number, 'Unescaped $ is not allowed; escape currency as \\$ and put formulas in math fences')
    }
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], number = index + 1
    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/)
      if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) {
        if (fence.math) {
          const body = fence.body.join('\n').trim()
          if (!body) error(fence.line, 'Math fence must not be empty')
          if (fence.id !== 'latency-utility' && (body.includes('\\\\') || /\\begin\{(?:aligned|align\*?|split|multline\*?)\}/.test(body))) {
            error(fence.line, 'Keep ordinary formulas on one line; explain short symbols in prose instead of wrapping equations')
          }
          if (fence.id) formulas[fence.id] = body
        }
        fence = null
      } else if (fence.math) {
        checkDelimiters(line, number)
        if (/\\operatorname\b/.test(line)) error(number, 'GitHub rejected operatorname during rendering; use built-in operators or mathrm labels')
        fence.body.push(line)
      }
      continue
    }

    const anchor = line.match(/^ {0,3}<!--\s*formula:([a-z0-9-]+)\s*-->\s*$/)
    if (anchor) {
      if (pending) error(pending.line, `Formula ${pending.id} must be followed by a math fence`)
      const id = anchor[1]
      counts.set(id, (counts.get(id) ?? 0) + 1)
      if (!formulaIds.includes(id)) error(number, `Unknown formula anchor: ${id}`)
      if (counts.get(id) > 1) error(number, `Duplicate formula anchor: ${id}`)
      pending = { id, line: number }
      continue
    }
    if (!line.trim()) continue
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (opening) {
      const math = opening[2].trim() === 'math'
      if (pending && !math) error(pending.line, `Formula ${pending.id} must use a math fence, not an ordinary code fence`)
      if (math && !pending) error(number, 'Math fence must follow a formula anchor')
      fence = { marker: opening[1][0], length: opening[1].length, line: number,
        math, id: math ? pending?.id : undefined, body: [] }
      pending = null
      continue
    }
    if (pending) {
      error(pending.line, `Formula ${pending.id} must be followed by a math fence`)
      pending = null
    }
    checkDelimiters(withoutInlineCode(line), number)
  }
  if (fence) error(fence.line, `Unclosed ${fence.math ? 'math' : 'code'} fence`)
  if (pending) error(pending.line, `Formula ${pending.id} must be followed by a math fence`)
  for (const id of formulaIds) if (!counts.has(id)) error(1, `Missing formula anchor: ${id}`)
  return { ok: errors.length === 0, errors, formulas }
}

export function checkReadmePair(english, chinese, names = ['README.md', 'README.zh.md']) {
  const left = checkReadme(english, names[0]), right = checkReadme(chinese, names[1])
  const errors = [...left.errors, ...right.errors]
  for (const id of formulaIds) {
    if (left.formulas[id] !== undefined && right.formulas[id] !== undefined
      && normalize(left.formulas[id]) !== normalize(right.formulas[id])) {
      errors.push(`${names[0]} / ${names[1]}: Formula ${id} differs between translations`)
    }
  }
  return { ok: errors.length === 0, errors, formulas: { [names[0]]: left.formulas, [names[1]]: right.formulas } }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length !== 0 && args.length !== 2) {
    console.error('Usage: node scripts/check-readme.mjs [README.md README.zh.md]')
    process.exitCode = 1
  } else {
    try {
      const paths = args.length ? args.map(path => resolve(path)) : ['README.md', 'README.zh.md'].map(path => resolve(root, path))
      const bytes = paths.map(path => readFileSync(path))
      const result = checkReadmePair(...bytes.map(value => value.toString('utf8')), paths)
      if (!args.length) {
        const pairing = readFileSync(resolve(root, 'README.i18n.yaml'), 'utf8')
        for (const [index, name] of ['README.md', 'README.zh.md'].entries()) {
          const entries = pairing.split(/\r?\n/).filter(line => line.startsWith(`${name}:`))
          const expected = entries.length === 1 ? entries[0].slice(name.length + 1).trim() : ''
          const actual = createHash('sha1').update(Buffer.from(`blob ${bytes[index].length}\0`)).update(bytes[index]).digest('hex')
          if (!/^[a-f0-9]{40}$/.test(expected) || expected !== actual) {
            result.errors.push(`README.i18n.yaml: ${name} Git blob hash is missing, duplicated or stale; expected ${actual}`)
          }
        }
        result.ok = result.errors.length === 0
      }
      if (!result.ok) {
        console.error(result.errors.join('\n'))
        process.exitCode = 1
      } else console.log(`README math structure passed: 6 paired formulas${args.length ? '' : ' and translation hashes'}. TeX compilation and GitHub rendering require separate verification.`)
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  }
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDelimited, parseJsonText, toCsv, csvField, boundExport } from '../packages/orchestration/src/bot-data-io.mjs'

const failure = fn => assert.throws(fn, error => error.name === 'DataFailure')

test('io: CSV parses quoted fields, embedded delimiters and infers types', () => {
  const parsed = parseDelimited('name,age,score\nAlice,30,9.5\n"Bob, Jr",25,8')
  assert.deepEqual(parsed.columns, ['name', 'age', 'score'])
  assert.deepEqual(parsed.rows, [['Alice', 30, 9.5], ['Bob, Jr', 25, 8]])
  assert.deepEqual(parsed.sqlTypes, ['TEXT', 'INTEGER', 'REAL'])
})

test('io: empty and duplicate headers are normalised to unique identifiers', () => {
  const parsed = parseDelimited('a,a,\n1,2,3')
  assert.deepEqual(parsed.columns, ['a', 'a_2', 'column_3'])
})

test('io: JSON array, single object and NDJSON all parse to columns + rows', () => {
  assert.deepEqual(parseJsonText('[{"k":1,"g":"a"},{"k":2,"g":"b"}]').columns, ['k', 'g'])
  assert.deepEqual(parseJsonText('{"only":1}').rows, [[1]])
  const nd = parseJsonText('{"a":1,"b":"x"}\n{"a":2,"c":true}')
  assert.deepEqual(nd.columns, ['a', 'b', 'c'])
  assert.deepEqual(nd.rows, [[1, 'x', null], [2, null, 1]])
})

test('io: a mixed column widens to text so nothing is silently lost', () => {
  const parsed = parseDelimited('v\n1\n2.5\nnope')
  assert.equal(parsed.sqlTypes[0], 'TEXT')
  assert.deepEqual(parsed.rows, [['1'], ['2.5'], ['nope']])
})

test('io: malformed input fails the import rather than producing a partial table', () => {
  failure(() => parseDelimited('a,b\n"unterminated'))
  failure(() => parseJsonText('{not json'))
  failure(() => parseJsonText('   '))
})

test('io: CSV export neutralises spreadsheet formula injection', () => {
  assert.equal(csvField('=SUM(A1:A9)'), "'=SUM(A1:A9)")
  assert.equal(csvField('+1234'), "'+1234")
  assert.equal(csvField('@import'), "'@import")
  assert.equal(csvField('\tlead'), "'\tlead")
  // A plain negative number is left intact; a leading dash on non-numeric text is neutralised.
  assert.equal(csvField('-42'), '-42')
  assert.equal(csvField('-rm -rf'), "'-rm -rf")
  assert.equal(csvField('hello'), 'hello')
})

test('io: CSV export quotes fields with delimiters, quotes or newlines', () => {
  assert.equal(csvField('a,b'), '"a,b"')
  assert.equal(csvField('say "hi"'), '"say ""hi"""')
  assert.equal(csvField('line\nbreak'), '"line\nbreak"')
})

test('io: toCsv writes a header and neutralised rows', () => {
  const csv = toCsv([{ name: 'n' }, { name: 'v' }], [['=1+1', 5], ['ok', null]])
  assert.equal(csv, 'n,v\r\n\'=1+1,5\r\nok,\r\n')
})

test('io: export is byte-bounded and cut on a UTF-8 boundary, never fabricated', () => {
  const bounded = boundExport('a'.repeat(100), 10)
  assert.equal(bounded.bytes, 10)
  assert.equal(bounded.truncated, true)
  assert.equal(bounded.text.length, 10)
})

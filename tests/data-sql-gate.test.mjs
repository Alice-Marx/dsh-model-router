import test from 'node:test'
import assert from 'node:assert/strict'
import { classifySql, gateSql } from '../packages/orchestration/src/bot-data-sql.mjs'

const kindOf = sql => classifySql(sql).kind
const refused = sql => { assert.throws(() => gateSql(sql), error => { assert.equal(error.error.code, 'write_refused'); return true }) }
const allowed = (sql, options) => { assert.doesNotThrow(() => gateSql(sql, options)) }

test('gate: SELECT-like reads and CREATE … AS are allowed; the rest are refused', () => {
  allowed('SELECT 1')
  allowed('WITH x AS (SELECT 1) SELECT * FROM x')
  allowed('VALUES (1,2)')
  allowed('EXPLAIN SELECT 1')
  allowed('CREATE TABLE q AS SELECT 1', { allowCreate: true })
  allowed('CREATE OR REPLACE VIEW v AS SELECT 1', { allowCreate: true })
  refused('INSERT INTO t VALUES (1)')
  refused('UPDATE t SET a = 1')
  refused('DELETE FROM t')
  refused('DROP TABLE t')
  refused('ALTER TABLE t ADD COLUMN c')
  refused('CREATE INDEX i ON t(a)', { allowCreate: true }) // index is not TABLE|VIEW … AS
})

test('gate: a WITH … DELETE never passes as a read (verb after the CTE list)', () => {
  assert.equal(kindOf('WITH x AS (SELECT 1) DELETE FROM t'), 'refused')
  assert.equal(kindOf('WITH x AS (SELECT 1) SELECT * FROM x'), 'read')
})

test('gate: ATTACH, DETACH and PRAGMA are refused by the verb, not a regex', () => {
  refused("ATTACH DATABASE '/tmp/x.sqlite' AS z")
  refused("ATTACH ':memory:' AS z")
  refused('DETACH DATABASE z')
  refused('PRAGMA journal_mode = WAL')
  refused('VACUUM')
  refused('BEGIN')
})

test('gate: keywords inside strings, comments and quoted identifiers do not change the verdict', () => {
  // The dangerous verb is masked inside a string literal.
  assert.equal(kindOf("SELECT '; DROP TABLE t; --'"), 'read')
  assert.equal(kindOf("SELECT * FROM t WHERE name = 'DELETE'"), 'read')
  // A line comment hides trailing text.
  assert.equal(kindOf('SELECT 1 -- ATTACH DATABASE x'), 'read')
  // A quoted identifier named like a verb is still just an identifier.
  assert.equal(kindOf('SELECT * FROM "delete"'), 'read')
})

test('gate: exactly one statement per call', () => {
  assert.throws(() => classifySql('SELECT 1; SELECT 2'), error => { assert.equal(error.error.code, 'invalid_input'); return true })
  // A semicolon inside a string is not a statement separator.
  assert.equal(kindOf("SELECT ';'"), 'read')
})

test('gate: CREATE … AS reports its object and OR REPLACE so SQLite can drop-and-create', () => {
  assert.deepEqual(classifySql('CREATE TABLE q AS SELECT 1'), { kind: 'create', target: 'q', object: 'table', orReplace: false })
  assert.deepEqual(classifySql('CREATE OR REPLACE VIEW v AS SELECT 1'), { kind: 'create', target: 'v', object: 'view', orReplace: true })
  // A CREATE without AS is refused.
  refused('CREATE TABLE t(a, b)')
})

test('gate: the classifier is a tokenizer, so it never needs to know a function name', () => {
  // load_extension() is a SELECT-shaped call; the gate passes the verb, and the
  // engine's disabled extension loading refuses it at execution (proven in
  // tests/data-engine.test.mjs), not by a keyword blocklist here.
  assert.equal(kindOf("SELECT load_extension('/tmp/evil')"), 'read')
})

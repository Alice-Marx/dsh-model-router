/**
 * The smallest schema vocabulary that covers our messages, and a validator that
 * refuses keywords it does not implement.
 *
 * Why hand-rolled: a validator that silently ignores an unknown keyword is worse
 * than none — a typo turns a check into a no-op and nobody notices. Every keyword
 * here is implemented, and anything else is an error at load time.
 *
 * Supported: type, enum, const, required, properties, additionalProperties,
 * items, minItems, minLength, pattern, oneOf, anyOf, description, title, default.
 */

const SUPPORTED = new Set([
  'type', 'enum', 'const', 'required', 'properties', 'additionalProperties',
  'items', 'minItems', 'minLength', 'pattern', 'oneOf', 'anyOf',
  'description', 'title', 'default', '$schema',
  // Annotations carry no validation semantics in the standard either; they are
  // listed so a schema can explain itself without tripping the whitelist.
  '$comment',
])

export class ContractError extends Error {
  constructor(path, message) { super(`${path}: ${message}`); this.name = 'ContractError'; this.path = path }
}

const typeOf = (value) => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  return typeof value
}

const matchesType = (value, type) => {
  const actual = typeOf(value)
  if (type === 'number') return actual === 'number' || actual === 'integer'
  if (type === 'integer') return actual === 'integer'
  return actual === type
}

/** Refuse a schema this validator only pretends to understand. */
export function assertSchema(schema, path = '#') {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) throw new ContractError(path, 'schema must be an object')
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key)) throw new ContractError(path, `unsupported schema keyword "${key}"`)
  }
  if (schema.type !== undefined && typeof schema.type !== 'string') throw new ContractError(path, 'type must be a string')
  if (schema.type !== undefined && !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(schema.type)) {
    throw new ContractError(path, `unknown type "${schema.type}"`)
  }
  if (schema.properties) {
    if (typeof schema.properties !== 'object' || Array.isArray(schema.properties)) throw new ContractError(path, 'properties must be an object')
    for (const [key, child] of Object.entries(schema.properties)) assertSchema(child, `${path}.properties.${key}`)
  }
  if (schema.items !== undefined) assertSchema(schema.items, `${path}.items`)
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean' && typeof schema.additionalProperties !== 'object') {
    throw new ContractError(path, 'additionalProperties must be boolean or a schema')
  }
  if (typeof schema.additionalProperties === 'object') assertSchema(schema.additionalProperties, `${path}.additionalProperties`)
  for (const key of ['oneOf', 'anyOf']) {
    if (schema[key] === undefined) continue
    if (!Array.isArray(schema[key]) || !schema[key].length) throw new ContractError(path, `${key} must be a non-empty array`)
    schema[key].forEach((child, index) => assertSchema(child, `${path}.${key}[${index}]`))
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== 'string'))) {
    throw new ContractError(path, 'required must be an array of strings')
  }
  if (schema.enum !== undefined && !Array.isArray(schema.enum)) throw new ContractError(path, 'enum must be an array')
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== 'string') throw new ContractError(path, 'pattern must be a string')
    try { new RegExp(schema.pattern) } catch { throw new ContractError(path, 'pattern must compile') }
  }
  return schema
}

/** Validate `value` against `schema`; throws ContractError naming the path. */
export function validate(schema, value, path = '$') {
  assertSchema(schema, '#')
  return check(schema, value, path)
}

function check(schema, value, path) {
  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    throw new ContractError(path, `expected ${schema.type}, got ${typeOf(value)}`)
  }
  if (schema.const !== undefined && value !== schema.const) throw new ContractError(path, `expected const ${JSON.stringify(schema.const)}`)
  if (schema.enum !== undefined && !schema.enum.includes(value)) throw new ContractError(path, `not one of ${schema.enum.join(', ')}`)
  if (schema.oneOf) {
    const passed = schema.oneOf.filter((child) => { try { check(child, value, path); return true } catch { return false } })
    if (passed.length !== 1) throw new ContractError(path, `expected exactly one oneOf branch, matched ${passed.length}`)
  }
  if (schema.anyOf) {
    const passed = schema.anyOf.some((child) => { try { check(child, value, path); return true } catch { return false } })
    if (!passed) throw new ContractError(path, 'matched no anyOf branch')
  }
  if (schema.type === 'object' || (schema.properties && typeOf(value) === 'object') || schema.required) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ContractError(path, 'expected an object')
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) throw new ContractError(path, `missing required key "${key}"`)
    const declared = schema.properties ?? {}
    for (const [key, child] of Object.entries(declared)) {
      if (Object.hasOwn(value, key)) check(child, value[key], `${path}.${key}`)
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.hasOwn(declared, key)) throw new ContractError(path, `unexpected key "${key}"`)
    } else if (typeof schema.additionalProperties === 'object') {
      for (const key of Object.keys(value)) if (!Object.hasOwn(declared, key)) check(schema.additionalProperties, value[key], `${path}.${key}`)
    }
  }
  if (schema.type === 'array' || schema.items) {
    if (!Array.isArray(value)) throw new ContractError(path, 'expected an array')
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new ContractError(path, `expected at least ${schema.minItems} items`)
    if (schema.items) value.forEach((item, index) => check(schema.items, item, `${path}[${index}]`))
  }
  if (schema.type === 'string' || typeof value === 'string') {
    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) throw new ContractError(path, `expected at least ${schema.minLength} characters`)
      if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) throw new ContractError(path, `does not match ${schema.pattern}`)
    }
  }
  return value
}

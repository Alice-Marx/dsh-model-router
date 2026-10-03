/**
 * Faithful copy of the request/response boundary of Harness's Typert gateway
 * (app.asar dsh/node_modules/@deepseek-ai/dsh-api-gateway/lib/index.js,
 * DeepSeek Harness 0.x as installed 2026-10: assertExactArguments, decode,
 * assertJsonValue, encodeRpcResult). Requests cross the wire as JSON, so
 * `undefined` fields vanish before the strict codec sees them.
 */
export class GatewayError extends Error {
  constructor(code, endpoint, message) {
    super(`typert gateway: ${endpoint}: ${message}`)
    this.code = code
  }
}

const isObject = value => typeof value === 'object' && value !== null
function isPlainObject(value) {
  if (Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === null || prototype === Object.prototype
}

function assertJsonValue(value, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw new TypeError('non-finite number is not JSON-safe')
  }
  if (!isObject(value)) throw new TypeError(`${typeof value} is not JSON-safe`)
  if (ancestors.has(value)) throw new TypeError('cyclic value is not JSON-safe')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length > 0 || Object.keys(value).length !== value.length) throw new TypeError('sparse or decorated array is not JSON-safe')
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError('sparse array is not JSON-safe')
        assertJsonValue(value[index], ancestors)
      }
      return
    }
    if (!isPlainObject(value)) throw new TypeError('non-plain object is not JSON-safe')
    if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError('symbol property is not JSON-safe')
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) throw new TypeError('non-data property is not JSON-safe')
      assertJsonValue(descriptor.value, ancestors)
    }
  } finally {
    ancestors.delete(value)
  }
}

function assertExactArguments(args, descriptor, endpoint) {
  if (!isPlainObject(args)) throw new GatewayError('gateway/arguments-invalid', endpoint, 'args must be a plain object')
  const expected = new Set(descriptor.parameters.map(parameter => parameter.wire))
  const extra = Reflect.ownKeys(args).filter(key => typeof key !== 'string' || !expected.has(key))
  const acceptsMissing = new Set(descriptor.parameters.filter(parameter => parameter.source === 'json' && (parameter.acceptsUndefined === true || parameter.codec.mode === 'src-json')).map(parameter => parameter.wire))
  const missing = [...expected].filter(key => !Object.hasOwn(args, key) && !acceptsMissing.has(key))
  if (extra.length === 0 && missing.length === 0) return
  const clauses = []
  if (missing.length > 0) clauses.push(`missing ${missing.map(key => JSON.stringify(key)).join(', ')}`)
  if (extra.length > 0) clauses.push(`unexpected ${extra.map(key => JSON.stringify(String(key))).join(', ')}`)
  throw new GatewayError('gateway/arguments-invalid', endpoint, `args fields do not match the descriptor: ${clauses.join('; ')}`)
}

export function decode(codec, value, endpoint, field) {
  try {
    if (codec.mode === 'strict') {
      value = codec.create().parse(value)
      if (value === undefined) return value
    }
    assertJsonValue(value, new Set())
    return value
  } catch (cause) {
    const error = new GatewayError('gateway/input-invalid', endpoint, `wire field ${JSON.stringify(field)} failed boundary validation`)
    error.cause = cause
    throw error
  }
}

export function encodeRpcResult(value, codec) {
  return { ok: true, value: codec.mode === 'strict' ? codec.encode?.(value) ?? value : value }
}

/**
 * A client-side remote proxy wired through the gateway boundary to a Host
 * service object: `api.method(arg)` → JSON wire → decode → service → encode.
 * Gateway failures come back as `{ ok: false, error: { code, message } }`.
 */
export function gatewayClient(descriptors, service, namespace) {
  const api = {}
  for (const descriptor of descriptors) {
    const endpoint = `${namespace}/${descriptor.method}`
    api[descriptor.method] = async (...positional) => {
      try {
        const args = {}
        descriptor.parameters.forEach((parameter, index) => { if (index < positional.length) args[parameter.wire] = positional[index] })
        const wire = JSON.parse(JSON.stringify(args))
        assertExactArguments(wire, descriptor, endpoint)
        const values = descriptor.parameters.map(parameter => Object.hasOwn(wire, parameter.wire) ? decode(parameter.codec, wire[parameter.wire], endpoint, parameter.wire) : undefined)
        const result = await service[descriptor.method](...values)
        return JSON.parse(JSON.stringify(encodeRpcResult(result, descriptor.result)))
      } catch (error) {
        return { ok: false, error: { code: error.code ?? 'remote/failed', message: error.message } }
      }
    }
  }
  return api
}

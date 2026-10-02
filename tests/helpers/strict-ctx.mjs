// Test contexts that enforce `inject` the way Cordis does.
//
// Cordis (reflect.ts) throws `cannot get property "<name>" without inject` when
// plugin code reads `ctx.<name>` for a service that is not in the plugin's
// `inject` list, even through optional chaining. Plain-object mocks hid that, so
// a `ctx?.credentials` read shipped in 0.13.0. Wrap mocks with strictCtx() so
// every test of a Host code path also checks its service accesses.
// Mirrors `inject` in .dsh-plugin/index.mjs (tests/cordis-inject.test.mjs keeps
// them equal). Not imported, so helpers never load the Host before a test sets DSH_HOME.
export const HOST_INJECT = Object.freeze(['commands', 'llm', 'tools', 'typert', 'sandboxPolicy', 'sandbox'])

// Members a real Cordis context has without inject: its own instance
// properties and the mixins installed by ReflectService.
const CONTEXT_BUILTINS = new Set([
  'root', 'events', 'registry', 'reflect', 'logger', 'fiber', 'name', 'scope', 'extend', 'isolate', 'intercept',
  'get', 'set', 'provide', 'accessor', 'mixin',
  'runtime', 'effect',
  'inject', 'plugin',
  'on', 'once', 'parallel', 'emit', 'serial', 'bail', 'waterfall',
])

function specialProperty(prop) {
  return typeof prop === 'symbol' || prop === 'then' || prop === 'prototype'
    || String(Number.parseInt(prop, 10)) === prop || prop.startsWith('_')
}

/**
 * Wrap a mock: injected services and Cordis built-ins read through; any other
 * property throws exactly like Cordis. `ctx.get(name)` returns any provided
 * service (injected or not), like the real `ctx.get()`. `testOnly` lists mock
 * bookkeeping fields (such as recorded calls) the test itself reads.
 */
export function strictCtx(services = {}, { inject = HOST_INJECT, provided = {}, testOnly = [] } = {}) {
  const allowed = new Set([...inject, ...CONTEXT_BUILTINS, ...testOnly])
  const lookup = name => Object.hasOwn(provided, name) ? provided[name] : services[name]
  const target = {
    ...services,
    get: typeof services.get === 'function' ? services.get : name => lookup(name),
  }
  return new Proxy(target, {
    get(object, prop, receiver) {
      if (specialProperty(prop) || allowed.has(prop)) return Reflect.get(object, prop, receiver)
      throw new Error(`cannot get property "${prop}" without inject`)
    },
    has(object, prop) {
      return Reflect.has(object, prop)
    },
  })
}


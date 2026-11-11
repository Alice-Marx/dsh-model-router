import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

// Inject the exact write failure rather than relying on platform-specific
// readonly-file replacement semantics. Always restore both builtin faces.
export async function withStorageFailure(t, method, failWhen, operation) {
  const original = fs[method]
  const mocked = t.mock.method(fs, method, (...args) => {
    if (failWhen(...args)) throw Object.assign(new Error('controlled storage failure'), { code: method === 'renameSync' ? 'EPERM' : 'EIO' })
    return original(...args)
  })
  syncBuiltinESMExports()
  try { return await operation() }
  finally { mocked.mock.restore(); syncBuiltinESMExports() }
}

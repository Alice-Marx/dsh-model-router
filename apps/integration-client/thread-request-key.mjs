// Request keys survive in the Host longer than a client page. A page-local
// sequence restarts on reload and can silently reopen an unrelated old thread.
// Bot identity travels separately; keep the key below the Host's 128-byte cap.
export function threadRequestKey(source) {
  if (source !== 'head' && source !== 'panel') throw new TypeError('INVALID_THREAD_REQUEST_SOURCE')
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return `${source}-${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

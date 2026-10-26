const originalFetch = globalThis.fetch
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) {
    throw new Error('External fetch disabled in the integration fixture')
  }
  return originalFetch(input, options)
}

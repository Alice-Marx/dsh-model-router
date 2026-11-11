const fail = code => { throw Object.assign(new Error(code), { code }) }
const id = value => typeof value === 'string' && /^[-A-Za-z0-9_.]{1,128}$/.test(value)
const object = (value, allowed) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('PAIRING_INVITE_INVALID')
}
const list = value => {
  if (!Array.isArray(value) || value.length > 64 || value.some(item => !id(item)) || new Set(value).size !== value.length) fail('PAIRING_INVITE_INVALID')
  return [...value].sort()
}

/** Shared browser/Host shape validation. Cryptographic point validation belongs to the Host transport. */
export function parseSecureInvite(input) {
  if (typeof input === 'string') {
    if (input.length > 16384) fail('PAIRING_INVITE_INVALID')
    try { input = JSON.parse(input) } catch { fail('PAIRING_INVITE_INVALID') }
  }
  object(input, ['format','version','inviteId','machineId','clientId','name','endpoint','expiresAt','token','code','transport','ceiling'])
  if (input.format !== 'dsh-pairing-invite' || input.version !== 2) fail('PAIRING_VERSION_UNSUPPORTED')
  if (![input.inviteId,input.machineId,input.clientId].every(id) || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0
    || typeof input.name !== 'string' || !input.name || input.name.length > 128 || /[\u0000-\u001f\u007f]/.test(input.name)
    || typeof input.token !== 'string' || !/^dsh_pair_[A-Za-z0-9_-]{43}$/.test(input.token)
    || input.code !== undefined && (typeof input.code !== 'string' || !/^\d{6}$/.test(input.code))) fail('PAIRING_INVITE_INVALID')
  let endpoint
  try { endpoint = new URL(input.endpoint) } catch { fail('PAIRING_INVITE_INVALID') }
  if (!['http:','https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.href.length > 1024) fail('PAIRING_INVITE_INVALID')
  object(input.transport, ['kind','publicKey','fingerprint'])
  if (input.transport.kind !== 'noise-v1' || typeof input.transport.publicKey !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(input.transport.publicKey)
    || typeof input.transport.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.transport.fingerprint)) fail('PAIRING_TRANSPORT_INVALID')
  object(input.ceiling, ['botIds','hostManagedBots','roots','tools'])
  if (input.ceiling.hostManagedBots !== undefined && typeof input.ceiling.hostManagedBots !== 'boolean') fail('PAIRING_INVITE_INVALID')
  const ceiling = { botIds: list(input.ceiling.botIds ?? []), roots: list(input.ceiling.roots), tools: list(input.ceiling.tools),
    ...(input.ceiling.hostManagedBots === true ? { hostManagedBots: true } : {}) }
  if (!ceiling.roots.length || !ceiling.tools.includes('machine_ping') || !ceiling.hostManagedBots && !ceiling.botIds.length) fail('PAIRING_INVITE_INVALID')
  return { format: input.format, version: 2, inviteId: input.inviteId, machineId: input.machineId, clientId: input.clientId,
    name: input.name, endpoint: endpoint.origin, expiresAt: input.expiresAt, token: input.token, ...(input.code ? { code: input.code } : {}),
    transport: { ...input.transport }, ceiling }
}

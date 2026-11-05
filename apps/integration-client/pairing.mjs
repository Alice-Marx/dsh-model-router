/**
 * Turn the agent's `pair` output into the few values the Host needs.
 *
 * The agent prints one blob:
 *
 *   {"clientId":"host-office","token":"…43…","machineId":"machine-…","secretRef":"remote-agent/…"}
 *
 * Asking a person to copy four fields by hand is how pairings go wrong. This parser accepts that
 * blob, the same values as `key: value` lines, or a bare token, and returns only what it could
 * read — never a guess. A missing token or machineId is reported to the caller, not invented.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/
const ID = /^[A-Za-z0-9_.-]{1,128}$/

const pick = (value, key) => {
  const raw = value?.[key]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : ''
}

/** A secret name the Host accepts, derived from the client id when there is one. */
export function secretNameFor({ clientId = '', machineId = '' } = {}) {
  const source = String(clientId || machineId || 'agent')
  const cleaned = source.toUpperCase().replace(/[^A-Z0-9_]/gu, '_').replace(/_+/gu, '_').replace(/^_|_$/gu, '')
  const trimmed = cleaned.slice(0, 40) || 'AGENT'
  return `REMOTE_AGENT_${trimmed}`
}

/**
 * @param {string} text pasted output
 * @returns {{ token: string, machineId: string, clientId: string, secretRef: string, problems: string[] }}
 */
export function parsePairingPaste(text) {
  const raw = String(text ?? '').trim()
  const problems = []
  const result = { token: '', machineId: '', clientId: '', secretRef: '', endpoint: '', rootIds: [], tools: [], botIds: [] }
  if (!raw) return { ...result, problems: ['请先粘贴 Agent 的 pair 输出。'] }

  // 1) The JSON blob, when the whole paste is one object.
  if (raw.startsWith('{')) {
    try {
      const value = JSON.parse(raw)
      result.token = pick(value, 'token')
      result.machineId = pick(value, 'machineId')
      result.clientId = pick(value, 'clientId')
      result.secretRef = pick(value, 'secretRef')
      if (value.endpoint !== undefined) {
        const endpoint = normalizeEndpoint(value.endpoint)
        if (endpoint.problem) problems.push(endpoint.problem)
        else result.endpoint = endpoint.endpoint
      }
      for (const field of ['rootIds', 'tools', 'botIds']) {
        if (value[field] === undefined) continue
        if (!Array.isArray(value[field]) || value[field].length > 128 || value[field].some(item => typeof item !== 'string' || !ID.test(item))) {
          problems.push(`配对文件的 ${field} 无效。`)
        } else result[field] = [...new Set(value[field])]
      }
      for (const field of ['protectedTunnel', 'hostManagedBots']) {
        if (value[field] === undefined) continue
        if (typeof value[field] !== 'boolean') problems.push(`配对文件的 ${field} 应为布尔值。`)
        else result[field] = value[field]
      }
    } catch {
      problems.push('这段看起来是 JSON，但没法解析。请整段复制 pair 的输出。')
    }
  } else {
    // 2) `key: value` lines, whatever their order.
    for (const line of raw.split(/\r?\n/u)) {
      const match = line.match(/^\s*(token|machineId|machine_id|clientId|client_id|secretRef|secret_ref)\s*[:=]\s*(.+?)\s*$/iu)
      if (!match) continue
      const key = match[1].toLowerCase().replace(/_/gu, '')
      const value = match[2].replace(/^["']|["']$/gu, '')
      if (key === 'token') result.token = value
      if (key === 'machineid') result.machineId = value
      if (key === 'clientid') result.clientId = value
      if (key === 'secretref') result.secretRef = value
    }
    // 3) A bare token, when the person pasted only that.
    if (!result.token && TOKEN.test(raw)) result.token = raw
  }

  if (!result.token) problems.push('没有读到 token（43 位）。')
  else if (!TOKEN.test(result.token)) problems.push(`token 应为 43 位，当前 ${result.token.length} 位。`)
  if (!result.machineId) problems.push('没有读到 machineId。')
  else if (!ID.test(result.machineId)) problems.push('machineId 含非法字符。')
  if (result.clientId && !ID.test(result.clientId)) problems.push('clientId 含非法字符。')

  if (!result.secretRef) result.secretRef = `ds-secret/${secretNameFor(result)}`
  return { ...result, problems }
}

/** One endpoint field: accept `10.0.0.2`, `10.0.0.2:9701`, or a full URL. */
export function normalizeEndpoint(input, { port = 9701 } = {}) {
  const raw = String(input ?? '').trim()
  if (!raw) return { endpoint: '', problem: '请填写 Agent 地址。' }
  const withScheme = /^https?:\/\//iu.test(raw) ? raw : `http://${raw}`
  let url
  try { url = new URL(withScheme) } catch { return { endpoint: '', problem: '地址格式不对，例如 10.0.0.2 或 http://10.0.0.2:9701。' } }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return { endpoint: '', problem: '地址只接受不含用户名和密码的 HTTP / HTTPS URL。' }
  if (!url.port) url.port = String(port)
  if (url.pathname !== '/' || url.search || url.hash) return { endpoint: '', problem: '只填主机与端口，不要带路径或参数。' }
  return { endpoint: `${url.protocol}//${url.host}`, problem: '' }
}

/** A private address only works over an attested tunnel; say so instead of failing later. */
export function needsTunnel(endpoint) {
  try {
    const host = new URL(endpoint).hostname
    return !['127.0.0.1', 'localhost', '::1'].includes(host)
  } catch {
    return false
  }
}

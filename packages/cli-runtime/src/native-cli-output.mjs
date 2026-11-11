import { createHash } from 'node:crypto'

const FRAME = 262_144
const RAW_FRAME = 18 * 1024 * 1024
const IMAGE = 6 * 1024 * 1024
const fail = () => { throw new Error('CLI_FRAME_LIMIT') }

// Claude's verbose user/tool_result events can echo the image already delivered over MCP.
// Keep bounded receipts for those echoes; the model has received the original pixels itself.
function receipt(frame, rawBytes) {
  const results = frame?.type === 'user' && frame.message?.content
  const toolResult = Array.isArray(results) && results.length > 0 && results.every(block => block?.type === 'tool_result' && typeof block.tool_use_id === 'string')
  if (!toolResult) { if (rawBytes > FRAME) fail(); return frame }
  let imageBytes = 0, images = 0, nodes = 0
  const visit = (value, depth = 0) => {
    if (++nodes > 30000 || depth > 24) fail()
    if (!value || typeof value !== 'object') return value
    if (value.type === 'image') {
      const source = value.source
      const data = source?.type === 'base64' ? source.data : value.data
      const mediaType = source?.type === 'base64' ? source.media_type : value.mimeType
      if (typeof data !== 'string' || data.length > IMAGE / 3 * 4 || !['image/png', 'image/jpeg', 'image/webp'].includes(mediaType)) fail()
      const bytes = Buffer.from(data, 'base64')
      if (!bytes.length || bytes.length > IMAGE || bytes.toString('base64') !== data || ++images > 32 || (imageBytes += bytes.length) > IMAGE * 2) fail()
      return { type: 'image', mediaType, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    }
    if (Array.isArray(value)) return value.map(item => visit(item, depth + 1))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, depth + 1)]))
  }
  const result = visit(frame)
  if (rawBytes > FRAME && !images || Buffer.byteLength(JSON.stringify(result)) > FRAME) fail()
  return result
}

/** Bound raw JSON lines separately from the non-image session output budget. */
export class NativeCliOutput {
  #buffer = ''
  #bytes = 0
  push(text) {
    this.#buffer += text
    const frames = []
    let end
    while ((end = this.#buffer.indexOf('\n')) >= 0) {
      const line = this.#buffer.slice(0, end)
      this.#buffer = this.#buffer.slice(end + 1)
      const rawBytes = Buffer.byteLength(line)
      if (rawBytes > RAW_FRAME) fail()
      if (!line.trim()) continue
      const frame = receipt(JSON.parse(line), rawBytes)
      this.#bytes += Buffer.byteLength(JSON.stringify(frame))
      if (this.#bytes > 8 * 1024 * 1024) fail()
      frames.push(frame)
    }
    if (Buffer.byteLength(this.#buffer) > RAW_FRAME) fail()
    return frames
  }
}

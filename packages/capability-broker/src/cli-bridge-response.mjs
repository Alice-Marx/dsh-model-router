import { createHash } from 'node:crypto'

const CHUNK_BYTES = 128 * 1024
const MAX_RESPONSE = 9 * 1024 * 1024
const MAX_BUFFERED = 16 * 1024 * 1024
const fail = () => { throw new Error('INVALID_BRIDGE_RESPONSE') }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

/** Large MCP pictures cross the existing bounded native pipe in small frames. */
export function* bridgeResponseFrames(id, value) {
  let bytes = Buffer.from(JSON.stringify({ type: 'response', id, ...value }))
  if (bytes.length > MAX_RESPONSE) bytes = Buffer.from(JSON.stringify({ type: 'response', id, ok: false, code: 'OUTPUT_LIMIT' }))
  if (bytes.length <= CHUNK_BYTES) { yield JSON.parse(bytes.toString('utf8')); return }
  yield { type: 'response-start', id, bytes: bytes.length }
  for (let offset = 0, index = 0; offset < bytes.length; offset += CHUNK_BYTES, index++) {
    yield { type: 'response-chunk', id, index, data: bytes.subarray(offset, offset + CHUNK_BYTES).toString('base64') }
  }
  yield { type: 'response-end', id, sha256: sha(bytes) }
}

/** Reassembly is bounded across all pending calls and releases on cancellation. */
export class BridgeResponseReader {
  #parts = new Map()
  #buffered = 0

  drop(id) {
    const state = this.#parts.get(id)
    if (state) this.#buffered -= state.size
    this.#parts.delete(id)
  }

  clear() { this.#parts.clear(); this.#buffered = 0 }

  accept(frame) {
    if (!Number.isSafeInteger(frame?.id) || frame.id < 1) fail()
    if (frame.type === 'response') { this.drop(frame.id); return frame }
    if (frame.type === 'response-start') {
      if (this.#parts.has(frame.id) || this.#parts.size >= 16 || !Number.isSafeInteger(frame.bytes)
        || frame.bytes <= CHUNK_BYTES || frame.bytes > MAX_RESPONSE) fail()
      this.#parts.set(frame.id, { expected: frame.bytes, size: 0, chunks: [] })
      return null
    }
    const state = this.#parts.get(frame.id)
    if (!state) fail()
    if (frame.type === 'response-chunk') {
      if (frame.index !== state.chunks.length || typeof frame.data !== 'string' || frame.data.length > Math.ceil(CHUNK_BYTES / 3) * 4) fail()
      const bytes = Buffer.from(frame.data, 'base64')
      if (!bytes.length || bytes.length > CHUNK_BYTES || bytes.toString('base64') !== frame.data
        || state.size + bytes.length > state.expected || this.#buffered + bytes.length > MAX_BUFFERED) fail()
      state.chunks.push(bytes); state.size += bytes.length; this.#buffered += bytes.length
      return null
    }
    if (frame.type !== 'response-end' || state.size !== state.expected) fail()
    const bytes = Buffer.concat(state.chunks)
    this.drop(frame.id)
    if (frame.sha256 !== sha(bytes)) fail()
    const value = JSON.parse(bytes.toString('utf8'))
    if (value.type !== 'response' || value.id !== frame.id) fail()
    return value
  }
}

/** Only a trusted handler can render MCP text or pictures. */
export function normalizeBridgeMcpResult(value) {
  if (!value || !Array.isArray(value.content) || value.content.length > 32
    || Object.keys(value).some(key => !['content', 'isError'].includes(key))
    || value.isError !== undefined && typeof value.isError !== 'boolean') fail()
  for (const block of value.content) {
    if (block?.type === 'text') {
      if (Object.keys(block).some(key => !['type', 'text'].includes(key)) || typeof block.text !== 'string') fail()
    } else if (block?.type === 'image') {
      if (Object.keys(block).some(key => !['type', 'data', 'mimeType'].includes(key))
        || !['image/png', 'image/jpeg', 'image/webp'].includes(block.mimeType) || typeof block.data !== 'string'
        || block.data.length > 8 * 1024 * 1024) fail()
      const bytes = Buffer.from(block.data, 'base64')
      if (!bytes.length || bytes.toString('base64') !== block.data || bytes.length > 6 * 1024 * 1024) fail()
    } else fail()
  }
  return value
}

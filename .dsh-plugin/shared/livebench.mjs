/**
 * LiveBench snapshot adapter.
 *
 * The public LiveBench site currently publishes versioned CSV/JSON assets
 * rather than a stable JSON API. This adapter understands both that official
 * layout and a user-supplied JSON/CSV mirror. A refresh failure is non-fatal:
 * the Host keeps the last successful snapshot and the router exposes the
 * fallback state in its audit record.
 */

const DEFAULT_RELEASE = '2026-06-25'
const TASK_ALIASES = Object.freeze({
  reasoning: ['reasoning', 'reasoning_score', 'hard_reasoning'],
  code: ['code', 'coding', 'coding_score'],
  math: ['math', 'mathematics', 'math_score'],
  research: ['research', 'retrieval', 'knowledge', 'data_analysis'],
  writing: ['writing', 'creative_writing', 'language'],
  vision: ['vision', 'multimodal', 'visual'],
  summarization: ['summarization', 'summary', 'if'],
  classification: ['classification', 'instruction_following'],
})

const CATEGORY_TO_TASK = Object.freeze({
  reasoning: 'reasoning',
  coding: 'code',
  // Agentic Coding is a different task family, not silently a Coding score.
  mathematics: 'math',
  'data analysis': 'research',
  language: 'writing',
  if: 'summarization',
  vision: 'vision',
  multimodal: 'vision',
})

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value))

function normalized(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function asScore(value, scale) {
  if (value === null || value === undefined || String(value).trim() === '') return undefined
  const number = Number(value)
  if (!Number.isFinite(number)) return undefined
  if (number < 0 || number > (scale ?? 100)) return undefined
  return scale === undefined ? (number > 1 ? number / 100 : number) : number / scale
}

function modelRows(payload) {
  if (Array.isArray(payload)) return payload
  if (payload !== null && typeof payload === 'object') {
    for (const key of ['models', 'data', 'leaderboard', 'results', 'entries', 'rows']) {
      if (Array.isArray(payload[key])) return payload[key]
    }
  }
  return []
}

function rowName(row) {
  if (row === null || typeof row !== 'object') return ''
  return String(row.model ?? row.model_name ?? row.name ?? row.id ?? row.slug ?? '')
}

function rowScores(row, scale) {
  const source = row?.scores ?? row?.categories ?? row?.benchmark ?? row
  const scores = {}
  if (source === null || typeof source !== 'object') return scores
  for (const [task, aliases] of Object.entries(TASK_ALIASES)) {
    for (const alias of aliases) {
      const score = asScore(source[alias], scale)
      if (score !== undefined) {
        scores[task] = score
        break
      }
    }
  }
  return scores
}

/** Normalize a provider response into `{ models: Record<normalizedId, row> }`. */
export function normalizeLiveBenchPayload(payload, fetchedAt = Date.now(), source = 'livebench') {
  const scale = payload?.scoreScale === 1 || payload?.scoreScale === 100 ? payload.scoreScale : undefined
  const models = {}
  for (const row of modelRows(payload)) {
    const id = normalized(rowName(row))
    if (id === '') continue
    const scores = rowScores(row, scale)
    const values = Object.values(scores)
    const suppliedOverall = asScore(row?.overall ?? row?.score ?? row?.livebench_score, scale)
    const overall = suppliedOverall
      ?? (values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined)
    if (overall === undefined) continue
    if (models[id]) throw new Error('LiveBench model identifiers collide after normalization')
    models[id] = {
      model: rowName(row),
      overall: Number(clamp(overall).toFixed(4)),
      overallSource: suppliedOverall !== undefined && row?.overallSource !== 'derived' ? 'explicit' : 'derived',
      scores,
      rank: Number.isFinite(Number(row?.rank)) ? Number(row.rank) : undefined,
    }
  }
  return { source, fetchedAt, models, ...(payload?.publishedAt === undefined ? {} : { publishedAt: payload.publishedAt }) }
}

/** Parse a small RFC-4180-compatible CSV without adding a runtime dependency. */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const value = String(text ?? '').replace(/^\uFEFF/, '')
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quoted) {
      if (char === '"' && value[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''))
      if (row.some(cell => cell.trim() !== '')) rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  row.push(field.replace(/\r$/, ''))
  if (row.some(cell => cell.trim() !== '')) rows.push(row)
  if (rows.length === 0) return []
  const headers = rows[0].map(header => header.trim())
  return rows.slice(1).map(cells => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])))
}

function mean(values, percent = false) {
  const numbers = values.map(value => percent
    ? (String(value ?? '').trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100 ? Number(value) / 100 : undefined)
    : asScore(value)).filter(value => value !== undefined)
  return numbers.length === 0 ? undefined : numbers.reduce((sum, value) => sum + value, 0) / numbers.length
}

function officialCsvPayload(csv, categories = {}, percent = false, strict = false) {
  const rows = parseCsv(csv)
  if (strict) for (const row of rows) {
    if (!row.model) throw new Error('LiveBench row has no model')
    for (const [column, value] of Object.entries(row)) {
      if (column === 'model' || String(value).trim() === '') continue
      if (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100) throw new Error('LiveBench CSV score is outside 0..100')
    }
  }
  const categoryColumns = new Map()
  for (const [label, columns] of Object.entries(categories ?? {})) {
    const task = CATEGORY_TO_TASK[String(label).trim().toLowerCase()]
    if (task && Array.isArray(columns)) categoryColumns.set(task, columns)
  }
  const models = rows.map(row => {
    const scores = {}
    for (const [task, columns] of categoryColumns.entries()) {
      const score = mean(columns.map(column => row[column]), percent)
      if (score !== undefined) scores[task] = score
    }
    // A mirror may already provide normalized task columns, so preserve them.
    for (const [task, aliases] of Object.entries(TASK_ALIASES)) {
      if (scores[task] !== undefined) continue
      const score = mean(aliases.map(alias => row[alias]), percent)
      if (score !== undefined) scores[task] = score
    }
    const suppliedOverall = mean([row.overall ?? row.score ?? row.livebench_score], percent)
    return { model: row.model, scores, overall: suppliedOverall ?? mean(Object.values(row).slice(1), percent),
      overallSource: suppliedOverall === undefined ? 'derived' : 'explicit' }
  })
  return { models }
}

function releaseCandidatesFromText(text) {
  const source = String(text ?? '')
  const matches = []
  // The current bundle has `const pe=["2024-...", ...]`. Restrict parsing to
  // an actual array assignment so unrelated build timestamps are not treated
  // as releases.
  const arrays = source.matchAll(/(?:const|let|var)\s+\w+\s*=\s*\[((?:\s*["']20\d{2}-\d{2}-\d{2}["']\s*,?)+)\]/g)
  for (const match of arrays) matches.push(...(match[1].match(/20\d{2}-\d{2}-\d{2}/g) ?? []))
  if (matches.length === 0) matches.push(...(source.match(/20\d{2}-\d{2}-\d{2}/g) ?? []))
  return [...new Set([...matches, DEFAULT_RELEASE])].sort().reverse()
}

function absoluteUrl(base, path) {
  return new URL(path, base.endsWith('/') ? base : `${base}/`).toString()
}

async function readResponse(response) {
  const type = String(response.headers?.get?.('content-type') ?? '').toLowerCase()
  const text = await response.text()
  return { type, text }
}

async function fetchWithTimeout(fetchImpl, url, signal) {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json,text/csv,text/html' },
    signal,
  })
  if (!response.ok) throw new Error(`LiveBench returned HTTP ${String(response.status)} for ${url}`)
  return response
}

async function officialSnapshot({ endpoint, fetchImpl, signal, fetchedAt, strict }) {
  const base = new URL(endpoint).origin
  let releases = [DEFAULT_RELEASE]
  try {
    const htmlResponse = await fetchWithTimeout(fetchImpl, base, signal)
    const html = (await readResponse(htmlResponse)).text
    const scriptPaths = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/gi)].map(match => match[1])
    const scriptPath = scriptPaths.at(-1)
    if (scriptPath !== undefined) {
      const scriptResponse = await fetchWithTimeout(fetchImpl, absoluteUrl(base, scriptPath), signal)
      releases = releaseCandidatesFromText((await readResponse(scriptResponse)).text)
    } else {
      releases = releaseCandidatesFromText(html)
    }
  } catch {
    // A CDN may deny HTML/JS while still serving a pinned release asset.
  }
  let lastError
  for (const release of releases) {
    const token = release.replaceAll('-', '_')
    try {
      const tableResponse = await fetchWithTimeout(fetchImpl, absoluteUrl(base, `table_${token}.csv`), signal)
      const categoryResponse = await fetchWithTimeout(fetchImpl, absoluteUrl(base, `categories_${token}.json`), signal)
      const table = (await readResponse(tableResponse)).text
      const categories = JSON.parse((await readResponse(categoryResponse)).text)
      return normalizeLiveBenchPayload(officialCsvPayload(table, categories, true, strict), fetchedAt, `livebench:${release}`)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('LiveBench release assets are unavailable')
}

/**
 * Fetch one LiveBench snapshot. The official root automatically discovers the
 * newest release. A custom endpoint may be JSON, CSV, or a `{release}` URL.
 */
export async function fetchLiveBenchSnapshot({
  endpoint = 'https://livebench.ai',
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  strict = false,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const fetchedAt = Date.now()
  try {
    const rawEndpoint = String(endpoint).trim()
    const parsed = new URL(rawEndpoint)
    if ((parsed.hostname === 'livebench.ai' || parsed.hostname === 'www.livebench.ai')
      && (parsed.pathname === '' || parsed.pathname === '/')) {
      return await officialSnapshot({ endpoint: parsed.toString(), fetchImpl, signal: controller.signal, fetchedAt, strict })
    }
    const url = parsed.toString().replace('{release}', DEFAULT_RELEASE)
    const response = await fetchWithTimeout(fetchImpl, url, controller.signal)
    const { type, text } = await readResponse(response)
    const isCsv = type.includes('csv') || /\.csv(?:$|\?)/i.test(parsed.pathname)
    if (isCsv) {
      if (strict) throw new Error('Dynamic custom LiveBench feeds require JSON with explicit scoreScale')
      return normalizeLiveBenchPayload(officialCsvPayload(text), fetchedAt, 'livebench-csv-mirror')
    }
    const payload = JSON.parse(text)
    if (strict) {
      if (![1, 100].includes(payload?.scoreScale) || modelRows(payload).length === 0) throw new Error('LiveBench feed needs explicit scoreScale and nonempty models')
      for (const row of modelRows(payload)) {
        if (!rowName(row) || rowName(row).trim() !== rowName(row)) throw new Error('LiveBench model identifier is invalid')
        const scores = row?.scores ?? row?.categories ?? row?.benchmark ?? row
        const values = [row.overall ?? row.score ?? row.livebench_score,
          ...Object.values(TASK_ALIASES).flatMap(aliases => aliases.map(alias => scores?.[alias]))]
          .filter(value => value !== undefined && value !== null && String(value).trim() !== '')
        if (!values.length || values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > payload.scoreScale)) throw new Error('LiveBench score is invalid for declared scale')
      }
    }
    return normalizeLiveBenchPayload(payload, fetchedAt, 'livebench-json-mirror')
  } finally {
    clearTimeout(timer)
  }
}

/** Return a model's benchmark row using the same normalization as the adapter. */
export function liveBenchRow(snapshot, model) {
  const row = snapshot?.models?.[normalized(model)] ?? null
  // Dynamic snapshots require explicit model identity. Old programmatic
  // snapshots retain their previous normalization-only compatibility.
  return snapshot?.exactModelMatch === true && row?.model !== model ? null : row
}

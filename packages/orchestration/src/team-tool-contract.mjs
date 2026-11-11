/**
 * The ONE description of the four teammate-coordination tools.
 *
 * The SDK registration (team-sdk-tools.mjs) and the native MCP handler factory
 * (native-team-tools.mjs) both read this module, so a tool name, a description, a
 * parameter or an argument projection cannot drift between the two doors: what the
 * model is told and what the coordination service is actually called with are the
 * same facts. This is the data-tool-contract.mjs pattern applied to the team family.
 *
 * Authority stays outside this file. The service that executes a call
 * (createTeamCoordination in team-bridge.mjs) resolves the calling Bot, the roster,
 * the targets, the lineage and the work-thread identity from committed Host state —
 * never from these arguments. `parseTeamToolArgs` refuses every key an entry does not
 * declare, so a model that tries to smuggle a `botId`, an `owner`, a route, a session
 * or a credential through the arguments is stopped here, before any service is
 * reached; and the projection below only ever forwards business content.
 *
 * Two schemas describe the same contract on purpose:
 *  - `parameters` is the dsh-tools author map the installed SDK compiles (arrays use
 *    the SDK's own `{ type:'array', items:{...} }` node — the same node the vendor
 *    browser/goals tools already use);
 *  - `inputSchema` is a real MCP JSON Schema object with `additionalProperties:false`,
 *    so a native client is told the truth — there is no authority key to pass.
 *
 * This contract is upstream-coordinate_bots-shaped but deliberately narrower, and the
 * narrowing is recorded rather than hidden: no `group_id`/rooms, no `title`/
 * `in_my_folder`, no `answers` (question routing), no `reason` chip, and
 * `assignment_status` exposes no `wait_ms` long-poll (a Bot must not hold a turn, and
 * a long-poll surface would need an owner-shaped endpoint). Those are phased gaps,
 * not promises.
 */

/** JSON argument bytes one team call may carry; the same bound the native tools use. */
export const MAX_ARGS_BYTES = 128_000

/** Bounds, chosen to match upstream and the product's own turn-input bound. */
export const MAX_TARGETS = 4
export const MAX_MESSAGE_CHARS = 4000
export const MAX_DONE_WHEN_CHARS = 1000
export const MAX_REQUEST_KEY_CHARS = 128
export const MAX_REASON_CHARS = 200

/** Assignment modes. */
export const MODE_WORK = 'work'
export const MODE_CONSULT = 'consult'
export const MODE_NOTICE = 'notice'
export const TEAM_MODES = Object.freeze([MODE_WORK, MODE_CONSULT, MODE_NOTICE])

/** Sender reply semantics. */
export const REPLY_RESUME = 'resume'
export const REPLY_NONE = 'none'
export const TEAM_REPLIES = Object.freeze([REPLY_RESUME, REPLY_NONE])

/** Durable assignment states (coherent with `outcome`, never overlapping it). */
export const STATE_QUEUED = 'queued'
export const STATE_ADMITTING = 'admitting'
export const STATE_RUNNING = 'running'
export const STATE_WAITING = 'waiting'
export const STATE_SETTLED = 'settled'
export const STATE_CANCELLED = 'cancelled'
export const STATE_UNKNOWN = 'unknown'
export const TEAM_STATES = Object.freeze([STATE_QUEUED, STATE_ADMITTING, STATE_RUNNING, STATE_WAITING, STATE_SETTLED, STATE_CANCELLED, STATE_UNKNOWN])
/** States a reader treats as "this assignment will not change on its own". */
export const TEAM_TERMINAL_STATES = Object.freeze([STATE_SETTLED, STATE_CANCELLED, STATE_UNKNOWN])

/** Outcomes, only meaningful once an assignment is terminal. */
export const OUTCOME_SUCCEEDED = 'succeeded'
export const OUTCOME_FAILED = 'failed'
export const OUTCOME_CANCELLED = 'cancelled'
export const OUTCOME_UNKNOWN = 'unknown'
export const TEAM_OUTCOMES = Object.freeze([OUTCOME_SUCCEEDED, OUTCOME_FAILED, OUTCOME_CANCELLED, OUTCOME_UNKNOWN])

/** Result-return / sender-resume sub-state: at-most-one automated attempt. */
export const RESUME_NONE = 'none'
export const RESUME_WAITING = 'waiting'
export const RESUME_SENDING = 'sending'
export const RESUME_DELIVERED = 'delivered'
export const RESUME_UNCERTAIN = 'uncertain'
export const TEAM_RESUME_STATES = Object.freeze([RESUME_NONE, RESUME_WAITING, RESUME_SENDING, RESUME_DELIVERED, RESUME_UNCERTAIN])

/** Thread references. `standing`/`new` are keywords; anything else is a thread id. */
export const THREAD_STANDING = 'standing'
export const THREAD_NEW = 'new'
const THREAD_ID = /^[A-Za-z0-9_-]{1,128}$/

/** Coded refusals and observations, so a model and an owner read the same reason. */
export const TEAM_CODES = Object.freeze({
  INVALID_ARGS: 'TEAM_INVALID_ARGS',
  CALLER_NOT_COMMITTED: 'TEAM_CALLER_NOT_COMMITTED',
  CALLER_NOT_AUTHORIZED: 'TEAM_CALLER_NOT_AUTHORIZED',
  TARGET_NOT_COMMITTED: 'TEAM_TARGET_NOT_COMMITTED',
  SELF_TARGET: 'TEAM_SELF_TARGET',
  DUPLICATE: 'TEAM_DUPLICATE',
  REQUEST_CONFLICT: 'TEAM_REQUEST_CONFLICT',
  REWORK_NOT_TERMINAL: 'TEAM_REWORK_NOT_TERMINAL',
  CYCLE: 'TEAM_CYCLE',
  TOO_DEEP: 'TEAM_TOO_DEEP',
  FANOUT_LIMIT: 'TEAM_FANOUT_LIMIT',
  THREAD_NOT_OWNED: 'TEAM_THREAD_NOT_OWNED',
  TARGET_BUSY: 'TEAM_TARGET_BUSY',
  ACCESS_CHANGED: 'TEAM_ACCESS_CHANGED',
  ASSIGNMENT_NOT_FOUND: 'TEAM_ASSIGNMENT_NOT_FOUND',
  OUTCOME_UNKNOWN: 'TEAM_OUTCOME_UNKNOWN',
})

const objectSchema = (properties, required = []) => Object.freeze({
  type: 'object',
  properties: Object.freeze(properties),
  required: Object.freeze(required),
  additionalProperties: false,
})

const stringProp = description => ({ type: 'string', description })
const boundedStringProp = (description, max) => ({ type: 'string', description: `${description}（最多 ${max} 字）`, maxLength: max })

/** The SDK author map for `bot_ids`: a bounded, unique array of teammate ids. */
const BOT_IDS_SDK = Object.freeze({
  type: 'array',
  minItems: 1, maxItems: MAX_TARGETS, uniqueItems: true,
  items: { type: 'string', description: 'A teammate id exactly as list_bots prints it. 1–4 distinct teammates.' },
  required: true,
  description: 'The teammates to send to, by id from list_bots. 1–4 distinct ids; never yourself.',
})

const inputSchemaFor = parameters => {
  const properties = {}
  for (const [key, spec] of Object.entries(parameters)) {
    if (spec.type === 'array') {
      properties[key] = Object.freeze({
        type: 'array',
        items: Object.freeze({ type: spec.items.type, ...(spec.items.description ? { description: spec.items.description } : {}) }),
        ...(spec.description ? { description: spec.description } : {}),
        ...(spec.minItems !== undefined ? { minItems: spec.minItems } : {}),
        ...(spec.maxItems !== undefined ? { maxItems: spec.maxItems } : {}),
        ...(spec.uniqueItems !== undefined ? { uniqueItems: spec.uniqueItems } : {}),
      })
      continue
    }
    const schema = { type: spec.type }
    if (spec.enum) schema.enum = spec.enum
    if (spec.maxLength !== undefined) schema.maxLength = spec.maxLength
    if (spec.minLength !== undefined) schema.minLength = spec.minLength
    schema.description = spec.description
    properties[key] = Object.freeze(schema)
  }
  const required = Object.entries(parameters).filter(([, spec]) => spec.required === true).map(([key]) => key)
  return objectSchema(properties, required)
}

const defineEntry = ({ name, description, parameters, method }) => Object.freeze({
  name,
  description,
  parameters: Object.freeze(parameters),
  inputSchema: inputSchemaFor(parameters),
  capability: 'tool/team',
  method,
})

const ENTRIES = Object.freeze([
  defineEntry({
    name: 'coordinate_bots',
    method: 'coordinateBots',
    description: [
      'The one way to hand work to teammates: ask 1–4 existing teammates a question or assign them concrete work.',
      'They see only what you send and run under their OWN model, tools, permissions and funding — never yours.',
      'thread "standing" (default) reuses this conversation\'s one work thread with each teammate; "new" opens a fresh thread with its own history; a thread id picks one you opened.',
      'consult true asks a question they answer from what they know, acting on nothing; reply "none" is a one-way notice nothing comes back from.',
      'Confirmed results resume this original conversation when it is still active and access still permits it. Interrupted or ambiguous delivery is surfaced without automatic resend. After sending END your turn; assignment_status is refused in the same turn.',
      'Never target yourself. On return, verify the requested outcome and request concrete corrections with rework true before giving one final answer. Never repeat a refused call unchanged.',
    ].join(' '),
    parameters: {
      bot_ids: BOT_IDS_SDK,
      message: { type: 'string', required: true, minLength: 1, maxLength: MAX_MESSAGE_CHARS, description: 'The self-contained question or task. Exact paths, constraints and what must be verified.' },
      thread: { type: 'string', description: '"standing" (default), "new", or a thread id you opened. Results return to this conversation.' },
      reply: { type: 'string', enum: [REPLY_RESUME, REPLY_NONE], description: '"resume" (default): the result resumes you. "none": a one-way notice, nothing comes back.' },
      consult: { type: 'boolean', description: 'True for a question the teammate answers from what it knows, acting on nothing. Omit for work.' },
      rework: { type: 'boolean', description: 'True only to send concrete work again to a teammate whose request already finished or failed: a correction, re-check or retry.' },
      done_when: { type: 'string', maxLength: MAX_DONE_WHEN_CHARS, description: 'What must be true for this to count as done; the teammate is held to it.' },
      request_key: { type: 'string', maxLength: MAX_REQUEST_KEY_CHARS, description: 'Optional idempotency name: a repeat with the same content is not sent again but returns the first receipt; a repeat with other content is refused.' },
    },
  }),
  defineEntry({
    name: 'assignment_status',
    method: 'assignmentStatus',
    description: [
      'Read-only: one assignment\'s state, outcome and result (give its id from a coordinate_bots receipt or a list_threads row),',
      'or, with no id, everything this conversation still waits on. A result resumes you on its own, so you never need this to wait:',
      'use it in a later turn when the person asks how a hand-off is going. It starts nothing and changes nothing.',
    ].join(' '),
    parameters: {
      id: { type: 'string', description: 'The assignment id. Omit to list every outstanding assignment of this conversation.' },
    },
  }),
  defineEntry({
    name: 'list_bots',
    method: 'listBots',
    description: 'List every OTHER teammate you can contact with its Main flag, committed model and current runtime mode. Call this to discover exact teammate ids before coordinate_bots.',
    parameters: {},
  }),
  defineEntry({
    name: 'list_threads',
    method: 'listThreads',
    description: 'Read-only: your own work threads and the threads you opened on teammates, newest first, each with its teammate, title, state and delegation id. This is a read: it starts nothing and changes nothing.',
    parameters: {},
  }),
])

if (ENTRIES.length !== 4 || ENTRIES.some((entry, index) => entry.name !== ['coordinate_bots', 'assignment_status', 'list_bots', 'list_threads'][index])) {
  throw new Error('TEAM_TOOL_ENTRIES_DIVERGED')
}

export const TEAM_TOOL_NAMES = Object.freeze(ENTRIES.map(entry => entry.name))
export const TEAM_TOOL_ENTRIES = ENTRIES
export const teamToolEntry = name => ENTRIES.find(entry => entry.name === name) ?? null

const invalid = key => { throw Object.assign(new Error(`${TEAM_CODES.INVALID_ARGS}:${key}`), { code: TEAM_CODES.INVALID_ARGS, field: key }) }
const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
const typeOf = (type, value) => type === 'string' ? typeof value === 'string'
  : type === 'boolean' ? typeof value === 'boolean'
    : type === 'integer' ? Number.isSafeInteger(value)
      : false

/** A thread reference: the two keywords, or a bounded thread id. */
export const threadReferenceOk = value => value === THREAD_STANDING || value === THREAD_NEW
  || (typeof value === 'string' && THREAD_ID.test(value))

/**
 * Strictly validate one team call's arguments against the shared contract and return
 * the SAME parsed object. Nothing is coerced and nothing is defaulted here: defaults
 * belong to the service, which is the only place that knows them.
 *
 * Refused: a non-plain object, any key the entry does not declare (an authority key
 * such as botId/owner, or any other key), a missing required key, a wrong type, a
 * value outside an enum, a string past its maxLength, an unsafe integer, and a JSON
 * payload larger than MAX_ARGS_BYTES.
 */
export function parseTeamToolArgs(name, args) {
  const entry = teamToolEntry(name)
  if (!entry) throw new TypeError(`unknown team tool: ${String(name)}`)
  if (!isPlainObject(args)) invalid('args')
  let bytes
  try { bytes = Buffer.byteLength(JSON.stringify(args), 'utf8') } catch { invalid('args') }
  if (bytes > MAX_ARGS_BYTES) invalid('args')
  const { parameters } = entry
  if (Object.keys(args).some(key => !Object.hasOwn(parameters, key))) invalid('args')
  for (const [key, spec] of Object.entries(parameters)) if (spec.required === true && !Object.hasOwn(args, key)) invalid(key)
  for (const [key, value] of Object.entries(args)) {
    const schema = parameters[key]
    if (schema.type === 'array') {
      if (!Array.isArray(value)) invalid(key)
      if (schema.minItems !== undefined && value.length < schema.minItems) invalid(key)
      if (schema.maxItems !== undefined && value.length > schema.maxItems) invalid(key)
      if (schema.uniqueItems === true && new Set(value).size !== value.length) invalid(key)
      if (value.some(item => typeof item !== schema.items.type || !/^[A-Za-z0-9_-]{1,128}$/.test(item))) invalid(key)
      continue
    }
    if (!typeOf(schema.type, value)) invalid(key)
    if (schema.enum && !schema.enum.includes(value)) invalid(key)
    if (schema.minLength !== undefined && value.length < schema.minLength) invalid(key)
    if (schema.maxLength !== undefined && value.length > schema.maxLength) invalid(key)
    if (key === 'thread' && !threadReferenceOk(value)) invalid(key)
  }
  return args
}

/**
 * Project one validated coordinate_bots call onto the business shape the service
 * consumes. Only the declared business keys are forwarded; there is no botId, owner,
 * route, session or credential to forward, because none was ever accepted.
 */
export function projectCoordinateArgs(args) {
  const trimmed = String(args.message).replace(/\r\n?/g, '\n').trim()
  return {
    targets: args.bot_ids.map(id => String(id)),
    message: trimmed,
    thread: typeof args.thread === 'string' ? args.thread : THREAD_STANDING,
    reply: args.reply === REPLY_NONE ? REPLY_NONE : REPLY_RESUME,
    consult: args.consult === true,
    rework: args.rework === true,
    ...(typeof args.done_when === 'string' ? { doneWhen: args.done_when } : {}),
    ...(typeof args.request_key === 'string' && args.request_key ? { requestKey: args.request_key.slice(0, MAX_REQUEST_KEY_CHARS) } : {}),
  }
}

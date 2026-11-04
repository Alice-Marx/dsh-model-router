import test from 'node:test'
import assert from 'node:assert/strict'
import { createTuiPromptRunner, stripAnsi } from '../.dsh-plugin/shared/tui-executor.mjs'

const tool = { id: 'dsh-tui', probeExecutables: ['dsh-tui', 'dst'] }

/** A terminal manager that replays scripted screens and remembers what was typed. */
function fakeTerminals(screens, { exitedAfter = Infinity } = {}) {
  const events = { starts: [], writes: [], reads: 0, stops: [] }
  let index = 0
  return {
    events,
    async start(request) {
      events.starts.push(request)
      return { sessionId: 'session-1' }
    },
    async read({ waitMs }) {
      events.reads += 1
      // Honour the wait so the caller's loop can observe aborts and timers, as a real
      // terminal does instead of resolving immediately.
      if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 5)))
      if (events.reads > exitedAfter) return { data: '', cursor: 0, exited: true, closed: true, waitMs }
      const page = screens[index]
      if (index < screens.length - 1) index += 1
      return { data: page ?? '', cursor: 0, exited: false, closed: false }
    },
    write({ data }) { events.writes.push(data) },
    async stop({ sessionId }) { events.stops.push(sessionId) },
  }
}

test('tui executor: types the prompt into the managed terminal and returns the rendered reply', async () => {
  const terminals = fakeTerminals([
    '\u001b[2J\u001b[1;1Hdsh-TUI ready\n> ',
    'Hello there\n',
    '\u001b[32mDeepSeek says hi\u001b[0m\n',
  ], { exitedAfter: 6 })
  const runner = createTuiPromptRunner({ terminals, now: () => Date.now(), idleMs: 1, readMs: 0, bootMs: 50 })
  const result = await runner.run({ tool, prompt: 'ping' })
  assert.equal(terminals.events.starts.length, 1)
  assert.equal(terminals.events.starts[0].executable, 'dsh-tui')
  assert.deepEqual(terminals.events.writes, ['ping\r'])
  assert.match(result.text, /DeepSeek says hi/)
  assert.doesNotMatch(result.text, /\u001b\[/)
  assert.deepEqual(terminals.events.stops, ['session-1'])
})

test('tui executor: resolves the executable through the locator and reports a missing tool', async () => {
  const terminals = fakeTerminals(['ready'])
  const runner = createTuiPromptRunner({
    terminals, idleMs: 1, readMs: 0, bootMs: 50,
    locate: async name => (name === 'dst' ? 'C:/tools/dst.exe' : null),
  })
  await runner.run({ tool, prompt: 'ping' })
  assert.equal(terminals.events.starts[0].executable, 'C:/tools/dst.exe')

  const missing = createTuiPromptRunner({ terminals, idleMs: 1, readMs: 0, bootMs: 50, locate: () => null })
  await assert.rejects(missing.run({ tool, prompt: 'ping' }), /TUI_TOOL_NOT_FOUND/)
})

test('tui executor: refuses an empty prompt before starting anything', async () => {
  const terminals = fakeTerminals(['ready'])
  const runner = createTuiPromptRunner({ terminals })
  await assert.rejects(runner.run({ tool, prompt: '   ' }), /TUI_PROMPT_REQUIRED/)
  assert.equal(terminals.events.starts.length, 0)
})

test('tui executor: an aborted run still closes its session', async () => {
  const terminals = fakeTerminals(['ready', 'thinking...'])
  const controller = new AbortController()
  // A real read wait lets the abort timer run; a zero wait would starve the event loop.
  const runner = createTuiPromptRunner({ terminals, idleMs: 60_000, readMs: 10, bootMs: 100 })
  const running = runner.run({ tool, prompt: 'ping', signal: controller.signal })
  setTimeout(() => controller.abort(), 20)
  await assert.rejects(running, /abort/i)
  assert.deepEqual(terminals.events.stops, ['session-1'])
})

test('tui executor: a screen that never settles reports TUI_TIMEOUT and closes the session', async () => {
  const terminals = fakeTerminals(new Array(200).fill('still working\n'))
  const runner = createTuiPromptRunner({ terminals, idleMs: 60_000, timeoutMs: 40, readMs: 0, bootMs: 20 })
  await assert.rejects(runner.run({ tool, prompt: 'ping' }), /TUI_TIMEOUT/)
  assert.deepEqual(terminals.events.stops, ['session-1'])
})

test('tui executor: stripAnsi keeps words and drops drawing control', () => {
  assert.equal(stripAnsi('\u001b[31mred\u001b[0m plain'), 'red plain')
  assert.equal(stripAnsi('\u001b]0;title\u0007text'), 'text')
  assert.equal(stripAnsi('a\u0000b'), 'ab')
})

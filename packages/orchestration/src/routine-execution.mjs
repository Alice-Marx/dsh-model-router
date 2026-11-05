import { normalizeRoutine, normalizeRoutineDisplay, normalizeRoutineInput, routineDelay } from './bot-routine.mjs'
import { createRoutineDesktopSession } from './routine-session.mjs'

const fail = (code, detail = {}) => { throw Object.assign(new Error(code), { code, ...detail }) }
const failureStatus = (failure, signal) => failure?.status === 'unknown' || failure?.possiblyApplied === true ? 'unknown'
  : signal?.aborted || failure?.status === 'cancelled' ? 'cancelled' : 'failed'

/** Legacy five-action routines remain usable on the acknowledged desktop session. */
export function routineStepInputs(step) {
  if (step.action === 'input') return [normalizeRoutineInput(step.event)]
  if (step.action === 'wait') return []
  if (step.action === 'click') return ['down', 'up'].map(action => normalizeRoutineInput({ type: 'pointer', action, x: step.x, y: step.y, button: step.button ?? 'left' }))
  if (step.action === 'type') return [normalizeRoutineInput({ type: 'text', text: step.text })]
  if (step.action === 'scroll') return [normalizeRoutineInput({ type: 'wheel', deltaX: 0, deltaY: step.delta })]
  if (step.action === 'key') {
    const modifiers = [...new Set(step.modifiers ?? [])].map(name => ({ ctrl: ['ControlLeft', 'Control'], alt: ['AltLeft', 'Alt'], shift: ['ShiftLeft', 'Shift'] })[name])
    const key = [step.key, step.key === 'Space' ? ' ' : step.key]
    return [...modifiers.map(([code, name]) => ({ type: 'key', action: 'down', code, key: name })),
      { type: 'key', action: 'down', code: key[0], key: key[1] }, { type: 'key', action: 'up', code: key[0], key: key[1] },
      ...modifiers.reverse().map(([code, name]) => ({ type: 'key', action: 'up', code, key: name }))].map(normalizeRoutineInput)
  }
  fail('ROUTINE_ACTION_UNKNOWN')
}

/** Host service: committed subject/machine authority, private durable evidence, no model endpoints. */
export function createRoutineExecutionService({ machines, store, botIdForSubject, WebSocketImpl = globalThis.WebSocket,
  now = Date.now, ackTimeoutMs = 5_000, renewEveryMs = 45_000 } = {}) {
  if (!machines?.desktopSession || !store?.beginRun || typeof botIdForSubject !== 'function') fail('ROUTINE_EXECUTION_REQUIRES_HOST')
  const active = new Map(), inFlight = new Set()
  let closing = false, closePromise
  store.recoverInterruptedRuns()
  const check = (subject, botId) => { if (!botId || botIdForSubject(subject) !== botId) fail('ROUTINE_BOT_DENIED') }
  const keyOf = (botId, runId) => `${botId}/${runId}`
  const execute = async ({ subject, botId, routineId, machineId, rootId, context = {}, signal = context.signal, onStep } = {}) => {
      check(subject, botId)
      const routine = normalizeRoutine(store.get(botId, routineId))
      // Validate every action before the first physical input. A bad later action must not
      // leave an otherwise avoidable partial run on the remote computer.
      const inputs = routine.steps.map(routineStepInputs)
      const row = store.beginRun(botId, { routineId, machineId, rootId }), runKey = keyOf(botId, row.runId)
      const controller = new AbortController(), abort = () => controller.abort(signal?.reason)
      active.set(runKey, controller)
      if (signal?.aborted) abort(); else signal?.addEventListener?.('abort', abort, { once: true })
      const identity = { taskId: row.taskId, attemptId: row.attemptId }
      const runContext = { ...context, ...identity, signal: controller.signal }
      const cleanupContext = { ...context, ...identity, signal: undefined }
      let session, ticket, currentStep = 0, status = 'succeeded', failure = null
      const completed = [], cleanup = { inputReleased: false, controlReleased: false, stopConfirmed: false }
      try {
        if (controller.signal.aborted) fail('ROUTINE_CANCELLED', { status: 'cancelled' })
        ticket = await machines.desktopSession(subject, { machineId, rootId, mode: 'watch', fps: 5,
          ...(routine.recording ? { displayId: routine.recording.display.displayId } : {}) }, runContext)
        store.updateRun(botId, row.runId, { sessionId: ticket.sessionId })
        session = createRoutineDesktopSession({ ticket, WebSocketImpl, signal: controller.signal, now, ackTimeoutMs, renewEveryMs,
          renewTicket: sessionId => machines.renewDesktopSession(subject, { sessionId }, runContext),
          closeTicket: sessionId => machines.closeDesktopSession(subject, { sessionId }, cleanupContext),
          onBeforeInput: (event, meta) => store.inputSent(botId, row.runId, { ...meta, eventType: event.type }),
          onAcknowledgedInput: (_event, meta) => store.inputOutcome(botId, row.runId, { id: meta.id, status: 'acknowledged', acknowledgedAt: meta.acknowledgedAt }),
          onInputFailure: (_event, meta) => store.inputOutcome(botId, row.runId, { id: meta.id, status: failureStatus(meta.failure, controller.signal), code: meta.failure.code ?? 'ROUTINE_INPUT_FAILED' }),
        })
        const display = normalizeRoutineDisplay(await session.ready)
        store.updateRun(botId, row.runId, { display })
        const recorded = routine.recording?.display
        if (recorded && ['displayId', 'width', 'height', 'coordinateSpace', ...(recorded.dpi !== undefined ? ['dpi'] : [])].some(field => recorded[field] !== display[field])) fail('ROUTINE_DISPLAY_CHANGED')
        for (const step of inputs) for (const event of step) if (event.type === 'pointer' && (event.x >= display.width || event.y >= display.height)) fail('ROUTINE_POINT_OUTSIDE_DISPLAY')
        await session.acquire()
        for (currentStep = 0; currentStep < routine.steps.length; currentStep++) {
          const step = routine.steps[currentStep]
          await routineDelay(step.action === 'wait' ? step.ms : step.action === 'input' ? step.delayMs : 0, controller.signal)
          const currentDisplay = normalizeRoutineDisplay(session.metadata)
          if (['displayId', 'width', 'height', 'coordinateSpace'].some(field => currentDisplay[field] !== display[field])) fail('ROUTINE_DISPLAY_CHANGED')
          for (const event of inputs[currentStep]) await session.input(event, { stepIndex: currentStep })
          completed.push(currentStep)
          store.updateRun(botId, row.runId, { steps: completed, stoppedAt: currentStep + 1 })
          await onStep?.(step, currentStep, { runId: row.runId, taskId: row.taskId, attemptId: row.attemptId })
        }
      } catch (caught) { failure = caught; status = failureStatus(caught, controller.signal) }
      finally {
        if (session) {
          try { await session.releaseInput(); cleanup.inputReleased = true } catch (caught) { cleanup.inputReleaseCode = caught.code ?? 'ROUTINE_RELEASE_UNCONFIRMED' }
          try { await session.releaseControl(); cleanup.controlReleased = true } catch (caught) { cleanup.controlReleaseCode = caught.code ?? 'ROUTINE_RELEASE_UNCONFIRMED' }
          cleanup.stopConfirmed = (await session.close())?.stopConfirmed === true
        } else if (ticket) {
          try { cleanup.stopConfirmed = (await machines.closeDesktopSession(subject, { sessionId: ticket.sessionId }, cleanupContext))?.stopConfirmed === true } catch {}
        } else cleanup.stopConfirmed = true
        signal?.removeEventListener?.('abort', abort); active.delete(runKey)
      }
      if (!cleanup.stopConfirmed) { status = 'unknown'; failure ??= Object.assign(new Error('ROUTINE_STOP_UNCONFIRMED'), { code: 'ROUTINE_STOP_UNCONFIRMED' }) }
      return store.updateRun(botId, row.runId, { status, steps: completed, stoppedAt: status === 'succeeded' ? null : currentStep,
        ...(failure ? { code: failure.code ?? 'ROUTINE_EXECUTION_FAILED', error: String(failure.message ?? failure) } : {}), cleanup, finishedAt: now() })
  }
  return Object.freeze({
    history(botId) { return store.listRuns(botId) },
    get(botId, runId) { return store.getRun(botId, runId) },
    cancel(botId, runId) {
      const row = store.getRun(botId, runId), controller = active.get(keyOf(botId, runId))
      if (!controller) return { runId, status: row.status, stopRequested: false, stopConfirmed: row.cleanup?.stopConfirmed === true }
      controller.abort()
      return { runId, status: 'cancel_pending', stopRequested: true, stopConfirmed: false }
    },
    resolve(botId, runId, note, context) {
      if (context?.kind !== 'owner') fail('REMOTE_OWNER_REQUIRED')
      if (active.has(keyOf(botId, runId))) fail('ROUTINE_STILL_RUNNING')
      return store.resolveRun(botId, runId, note)
    },
    run(request = {}) {
      if (closing) return Promise.reject(Object.assign(new Error('ROUTINE_EXECUTION_CLOSED'), { code: 'ROUTINE_EXECUTION_CLOSED' }))
      const execution = execute(request)
      inFlight.add(execution)
      execution.finally(() => inFlight.delete(execution)).catch(() => {})
      return execution
    },
    close() {
      if (!closePromise) {
        // Fence admission before aborting. Keep every promise until its cleanup and final
        // journal write finish, even if its controller has already left the active map.
        closing = true
        for (const controller of active.values()) controller.abort()
        const executions = [...inFlight]
        closePromise = Promise.allSettled(executions).then(outcomes => ({
          stopConfirmed: outcomes.every(outcome => outcome.status === 'fulfilled' && outcome.value.cleanup?.stopConfirmed === true),
          results: outcomes.filter(outcome => outcome.status === 'fulfilled').map(({ value }) => ({ runId: value.runId, status: value.status,
            stopConfirmed: value.cleanup?.stopConfirmed === true })),
          errors: outcomes.filter(outcome => outcome.status === 'rejected').map(({ reason }) => ({ code: reason?.code ?? 'ROUTINE_SHUTDOWN_FAILED' })),
        }))
      }
      return closePromise
    },
  })
}

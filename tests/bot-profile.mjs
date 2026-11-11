import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BOT_PROFILE_LIMITS, botProfileNameProblem, inspectProductBotProfile, saveProductBotProfile,
} from '../packages/orchestration/src/bot-profile.mjs'

/**
 * A synthetic Host that follows the frozen roster's own record rules and the
 * product-overlay `updateBotProfile` seam contract the parent provides: name is
 * trimmed, capped, checked for clashes and validated; role is trimmed and capped;
 * instructions are trimmed; the seam compares `base` against the live Bot and
 * runs `check` at the same synchronous boundary, mutates once, saves once, and
 * emits no update notice. Nothing here talks to a model, a file or a network.
 */
function openHost({ bots = [{ id: 'research', name: '研究伙伴', role: '整理资料', instructions: '先给结论。' }, { id: 'writer', name: '写作伙伴' }], seam = true } = {}) {
  const committed = { bots: Object.fromEntries(bots.map(bot => [bot.id, structuredClone(bot)])), revision: 7 }
  const calls = [], delivered = [], renamed = [], seamCalls = []
  const runtime = {
    loaded: 0,
    async load() { this.loaded += 1 },
    async save() { committed.revision += 1 },
    async deliver(args) { delivered.push(args) },
    async updateBot(id, patch) {
      calls.push({ id, patch: structuredClone(patch) })
      throw new Error('the identity slice must not use the native updateBot path')
    },
    ...(seam ? {
      async updateBotProfile(id, patch, options) {
        seamCalls.push({ id, patch: structuredClone(patch), base: structuredClone(options?.base), check: typeof options?.check })
        const bot = committed.bots[id]
        if (!bot) throw new Error('Unknown Bot')
        // The seam's boundary: base against the live Bot, then the caller's trusted
        // check, both before one mutation. This synthetic seam delegates the
        // comparison to the caller's check, as the real overlay does; without one it
        // compares base itself.
        if (typeof options?.check === 'function') {
          if (options.check(bot) !== true) throw new Error('check refused')
        } else {
          for (const [field, value] of Object.entries(patch)) {
            if (options?.base?.[field] !== undefined && (bot[field] ?? '') !== options.base[field]) {
              throw Object.assign(new Error('BOT_PROFILE_CONFLICT'), { code: 'BOT_PROFILE_CONFLICT' })
            }
          }
        }
        if (patch.name !== undefined) {
          const next = String(patch.name).trim().slice(0, 40)
          const clash = Object.values(committed.bots).some(other => other.id !== id && other.name === next)
          const problem = next === bot.name ? undefined : botProfileNameProblem(next)
          if (next === '' || clash || problem !== undefined) throw new Error(`Name ${next} is not available`)
          bot.name = next
          renamed.push(next)
        }
        if (patch.role !== undefined) bot.role = String(patch.role).trim().slice(0, 24)
        if (patch.instructions !== undefined) bot.instructions = String(patch.instructions).trim()
        await this.save()
        return structuredClone(bot)
      },
    } : {}),
  }
  const lifecycle = {
    committedBot(botId) { const bot = committed.bots[botId]; return bot ? structuredClone(bot) : null },
    committedBots() { return Object.values(committed.bots).map(bot => structuredClone(bot)) },
    status() { return { revision: committed.revision } },
    async refreshGrants() {},
  }
  return { runtime, lifecycle, committed, calls, delivered, renamed, seamCalls }
}

const owner = { kind: 'owner' }
const bot = { kind: 'bot' }
const read = (host, botId = 'research') => inspectProductBotProfile(host, { botId })
const payload = (overrides = {}) => ({ botId: 'research', expectedRevision: 7, base: { name: '研究伙伴', role: '整理资料', instructions: '先给结论。' }, profile: {}, ...overrides })

test('the owner read is the committed Bot and nothing else', async () => {
  const host = openHost()
  const view = await read(host)
  assert.equal(view.schemaVersion, 1)
  assert.deepEqual(view.bot, { id: 'research', name: '研究伙伴', role: '整理资料', instructions: '先给结论。' })
  assert.equal(view.revision, 7)
  assert.deepEqual(view.availableActions, ['botProfile.save'])
  assert.equal(view.limits, BOT_PROFILE_LIMITS)
  assert.equal(host.runtime.loaded, 1)
  // A read never writes, delivers or starts a turn.
  assert.deepEqual(host.calls, [])
  assert.deepEqual(host.delivered, [])
})

test('a Bot that is not in the committed directory is refused', async () => {
  const host = openHost()
  await assert.rejects(() => read(host, 'ghost'), error => error.code === 'BOT_PROFILE_UNKNOWN_BOT')
})

test('the parent gate keeps a Bot caller out of the owner read and save', async () => {
  const host = openHost()
  // The gate lives in the parent's registration, exactly as it does for binding.save.
  const gate = fn => (connection, request, context) => {
    if (context?.kind !== 'owner') throw Object.assign(new Error('OWNER_ONLY'), { code: 'OWNER_ONLY' })
    return fn(connection, request, context)
  }
  await assert.rejects(async () => gate(inspectProductBotProfile)(host, { botId: 'research' }, bot), error => error.code === 'OWNER_ONLY')
  await assert.rejects(() => saveProductBotProfile(host, payload({ profile: { role: '改' } }), bot), error => error.code === 'REMOTE_OWNER_REQUIRED')
  assert.deepEqual(host.seamCalls, [])
  assert.equal(host.runtime.loaded, 0)
})

test('three edited fields land in one seam call, persist once and read back committed', async () => {
  const host = openHost()
  const result = await saveProductBotProfile(host, payload({ profile: { name: '研究员', role: '查资料写摘要', instructions: '先给结论，再给依据。' } }), owner)
  // One seam call, one patch, only identity fields: the seam's single mutation is
  // the only write, so a partial profile can never land.
  assert.equal(host.seamCalls.length, 1)
  assert.deepEqual(host.seamCalls[0].patch, { name: '研究员', role: '查资料写摘要', instructions: '先给结论，再给依据。' })
  assert.equal(host.seamCalls[0].check, 'function')
  assert.deepEqual(host.seamCalls[0].base, { name: '研究伙伴', role: '整理资料', instructions: '先给结论。' })
  // The native updateBot path is never used for identity.
  assert.deepEqual(host.calls, [])
  assert.deepEqual(result.saved, ['name', 'role', 'instructions'])
  assert.deepEqual(result.bot, { id: 'research', name: '研究员', role: '查资料写摘要', instructions: '先给结论，再给依据。' })
  assert.equal(result.revision, 8)
  // The read-back is the committed record, not the live one.
  assert.deepEqual(host.lifecycle.committedBot('research'), { id: 'research', name: '研究员', role: '查资料写摘要', instructions: '先给结论，再给依据。' })
  // The seam emits no update notice, so no Bot turn is started.
  assert.deepEqual(host.delivered, [])
  // A rename is the Host's own semantic: the Bot's session title follows it.
  assert.deepEqual(host.renamed, ['研究员'])
})

test('only changed fields are sent, and an unchanged save writes nothing', async () => {
  const host = openHost()
  const changed = await saveProductBotProfile(host, payload({ profile: { role: '查资料写摘要', instructions: '先给结论。' } }), owner)
  assert.deepEqual(host.seamCalls[0].patch, { role: '查资料写摘要' })
  assert.deepEqual(changed.saved, ['role'])
  const none = await saveProductBotProfile(host, payload({ base: { name: '研究伙伴', role: '查资料写摘要', instructions: '先给结论。' }, profile: { role: '查资料写摘要' } }), owner)
  assert.equal(host.seamCalls.length, 1)
  assert.deepEqual(none.saved, [])
  assert.equal(host.committed.revision, 8)
})

test('a Host without the seam refuses the save and touches nothing', async () => {
  const host = openHost({ seam: false })
  const deliverBefore = host.runtime.deliver
  await assert.rejects(() => saveProductBotProfile(host, payload({ profile: { role: '查资料写摘要' } }), owner), error => {
    assert.equal(error.code, 'BOT_PROFILE_SEAM_UNAVAILABLE')
    assert.equal(error.details.required, 'runtime.updateBotProfile')
    return true
  })
  assert.deepEqual(host.seamCalls, [])
  assert.deepEqual(host.calls, [])
  assert.deepEqual(host.delivered, [])
  assert.equal(host.runtime.deliver, deliverBefore)
  assert.equal(host.committed.revision, 7)
  assert.equal(host.committed.bots.research.role, '整理资料')
})

test('the check inside the seam refuses a profile another window changed after the read', async () => {
  const host = openHost()
  const originalSeam = host.runtime.updateBotProfile
  let refused
  // Another window edits this Bot between the read and the seam's boundary.
  host.runtime.updateBotProfile = async (id, patch, options) => {
    host.committed.bots.research.instructions = '别处改过的指令。'
    try { return await originalSeam.call(host.runtime, id, patch, options) }
    catch (error) { refused = error; throw error }
  }
  await assert.rejects(() => saveProductBotProfile(host, payload({ profile: { role: '查资料写摘要', instructions: '我要写的指令。' } }), owner), error => {
    assert.equal(error.code, 'BOT_PROFILE_CONFLICT')
    assert.equal(error.details.field, 'instructions')
    assert.equal(error.details.current, '别处改过的指令。')
    return true
  })
  assert.equal(refused?.code, 'BOT_PROFILE_CONFLICT')
  // The newer value survives: the seam refused before its single mutation.
  assert.equal(host.committed.bots.research.instructions, '别处改过的指令。')
  assert.equal(host.committed.bots.research.role, '整理资料')
})

test('the check refuses a Bot that left the committed directory, and an aborted signal', async () => {
  const gone = openHost()
  const goneSeam = gone.runtime.updateBotProfile
  // Ownership disappears at the seam's boundary: the live Bot is still there, the
  // committed record is not.
  gone.lifecycle.committedBot = botId => null
  gone.runtime.updateBotProfile = async (id, patch, options) => goneSeam.call(gone.runtime, id, patch, options)
  await assert.rejects(() => saveProductBotProfile(gone, payload({ profile: { role: '查资料写摘要' } }), owner), error => error.code === 'BOT_PROFILE_UNKNOWN_BOT')
  assert.equal(gone.committed.bots.research.role, '整理资料')

  const aborting = openHost()
  const abortingSeam = aborting.runtime.updateBotProfile
  const controller = new AbortController()
  aborting.runtime.updateBotProfile = async (id, patch, options) => {
    controller.abort()
    return await abortingSeam.call(aborting.runtime, id, patch, options)
  }
  await assert.rejects(() => saveProductBotProfile({ ...aborting, signal: controller.signal }, payload({ profile: { role: '查资料写摘要' } }), owner), error => error.name === 'AbortError')
  assert.equal(aborting.committed.bots.research.role, '整理资料')
  assert.deepEqual(aborting.delivered, [])
})

test('an edit made in another window is refused before the seam, and an unrelated save is not', async () => {
  const host = openHost()
  // Somebody else committed a save (another Bot, a held greeting): the revision
  // moved, but this Bot's own fields did not.
  host.committed.revision = 9
  const unrelated = await saveProductBotProfile(host, payload({ profile: { role: '查资料写摘要' } }), owner)
  assert.deepEqual(unrelated.saved, ['role'])
  // Somebody else changed this Bot's instructions: the base the editor read no
  // longer holds, and the seam's own base comparison refuses it too.
  host.committed.bots.research.instructions = '别处改过的指令。'
  await assert.rejects(() => saveProductBotProfile(host, payload({
    expectedRevision: 9, base: { name: '研究伙伴', role: '查资料写摘要', instructions: '先给结论。' }, profile: { instructions: '我要写的指令。' },
  }), owner), error => {
    assert.equal(error.code, 'BOT_PROFILE_CONFLICT')
    assert.equal(error.details.current, '别处改过的指令。')
    return true
  })
  assert.equal(host.seamCalls.length, 1)
  assert.equal(host.committed.bots.research.instructions, '别处改过的指令。')
})

test('a name the Host would refuse is refused before the seam is called', async () => {
  const host = openHost()
  for (const [name, code] of [['', 'BOT_PROFILE_NAME_INVALID'], ['a@b', 'BOT_PROFILE_NAME_INVALID'], ['all', 'BOT_PROFILE_NAME_INVALID'],
    ['you', 'BOT_PROFILE_NAME_INVALID'], ['写作伙伴', 'BOT_PROFILE_NAME_TAKEN'], ['x'.repeat(41), 'BOT_PROFILE_LIMIT']]) {
    await assert.rejects(() => saveProductBotProfile(host, payload({ profile: { name } }), owner), error => error.code === code, `expected ${code} for ${JSON.stringify(name)}`)
  }
  assert.deepEqual(host.seamCalls, [])
  assert.deepEqual(host.committed.bots.research.name, '研究伙伴')
})

test('concurrent saves for different Bots keep their own notices and both land', async () => {
  const host = openHost()
  // No global deliver wrapper exists any more: an unrelated same-Bot update that
  // arrives while a save is in flight is delivered, not swallowed.
  const first = saveProductBotProfile(host, payload({ profile: { role: '查资料写摘要' } }), owner)
  await host.runtime.deliver({ toId: 'research', text: 'unrelated update', role: 'update' })
  const second = saveProductBotProfile(host, payload({
    botId: 'writer', expectedRevision: 7, base: { name: '写作伙伴', role: '', instructions: '' }, profile: { role: '写周报' },
  }), owner)
  const [one, two] = await Promise.all([first, second])
  assert.deepEqual(one.saved, ['role'])
  assert.deepEqual(two.saved, ['role'])
  assert.deepEqual(host.delivered, [{ toId: 'research', text: 'unrelated update', role: 'update' }])
  assert.equal(host.committed.bots.research.role, '查资料写摘要')
  assert.equal(host.committed.bots.writer.role, '写周报')
})

test('a save that the Host does not confirm fails closed', async () => {
  const host = openHost()
  host.runtime.updateBotProfile = async (id, patch, options) => {
    host.seamCalls.push({ id, patch: structuredClone(patch) })
    if (options?.check) options.check(host.committed.bots[id])
    const bot = host.committed.bots[id]
    if (patch.role !== undefined) bot.role = '别的值'
    return structuredClone(bot)
  }
  await assert.rejects(() => saveProductBotProfile(host, payload({ profile: { role: '查资料写摘要' } }), owner), error => error.code === 'BOT_PROFILE_UNCONFIRMED')
  assert.equal(host.committed.bots.research.role, '别的值')
})

test('a missing lifecycle, an unknown field and a bad revision are all refused', async () => {
  const host = openHost()
  await assert.rejects(() => read({ ...host, lifecycle: {} }), error => error.code === 'BOT_PROFILE_LIFECYCLE_UNAVAILABLE')
  await assert.rejects(() => saveProductBotProfile(host, payload({ profile: { soul: 'x' } }), owner), error => error.code === 'BOT_PROFILE_INVALID')
  await assert.rejects(() => saveProductBotProfile(host, payload({ model: 'fixture/x' }), owner), error => error.code === 'BOT_PROFILE_INVALID')
  await assert.rejects(() => saveProductBotProfile(host, payload({ expectedRevision: -1 }), owner), error => error.code === 'BOT_PROFILE_INVALID')
  await assert.rejects(() => saveProductBotProfile(host, payload({ profile: {} }), owner), error => error.code === 'BOT_PROFILE_INVALID')
  assert.deepEqual(host.seamCalls, [])
})

test('the name rule matches the one the frozen roster applies', async () => {
  assert.equal(botProfileNameProblem('研究员'), undefined)
  assert.equal(botProfileNameProblem('  '), 'Bot 需要一个名称。')
  for (const name of ['a@b', 'x`y', 'two\nlines']) assert.match(botProfileNameProblem(name), /不能包含/)
  for (const name of ['All', '所有人']) assert.match(botProfileNameProblem(name), /所有人/)
  for (const name of ['User', 'you']) assert.match(botProfileNameProblem(name), /用户自己/)
  assert.equal(BOT_PROFILE_LIMITS.name, 40)
  assert.equal(BOT_PROFILE_LIMITS.role, 24)
})

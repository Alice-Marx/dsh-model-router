import test from 'node:test'
import assert from 'node:assert/strict'
import { createGalAudioController, galThemeForNode, GAL_MUSIC_OPTIONS, playGalEffect } from '../.dsh-plugin/client/gal-audio-controller.mjs'
import { playStoryScore, storyScoreFor } from '../.dsh-plugin/client/gal-story-audio.mjs'

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

function fakeAudio({ suspended = false, resumeGate, resumeFailure, keepSuspended = false, playGate, playFailure } = {}) {
  const contexts = []
  const players = []
  const timers = new Map()
  const revoked = []
  const urls = []
  let timerId = 0
  let now = 0
  const parameter = () => ({
    value: 0, events: [],
    setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]) },
    linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['linear', value, time]) },
    exponentialRampToValueAtTime(value, time) { this.value = value; this.events.push(['exponential', value, time]) },
    cancelScheduledValues(time) { this.events.push(['cancel', time]) },
  })
  class FakeContext {
    constructor() {
      this.state = suspended ? 'suspended' : 'running'
      this.currentTime = 0
      this.destination = {}
      this.gains = []
      this.oscillators = []
      this.closeCalls = 0
      this.resumeCalls = 0
      this.listeners = new Map()
      contexts.push(this)
    }
    createGain() {
      const node = { gain: parameter(), disconnected: false, connect() { return this }, disconnect() { this.disconnected = true } }
      this.gains.push(node)
      return node
    }
    createOscillator() {
      if (this.failOscillators) throw new Error('device disconnected')
      const oscillator = {
        frequency: parameter(), detune: parameter(), disconnected: false,
        startAt: null, stopAt: null, stopCalls: 0,
        connect(destination) { return destination }, disconnect() { this.disconnected = true },
        start(time) { this.startAt = time }, stop(time) { this.stopAt = time; this.stopCalls += 1 },
      }
      this.oscillators.push(oscillator)
      return oscillator
    }
    async resume() {
      this.resumeCalls += 1
      if (resumeFailure) throw resumeFailure
      if (resumeGate) await resumeGate.promise
      if (this.state !== 'closed' && !keepSuspended) this.state = 'running'
    }
    async close() { this.closeCalls += 1; this.state = 'closed' }
    addEventListener(type, listener) { this.listeners.set(type, listener) }
    removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type) }
    emit(type) { this.listeners.get(type)?.() }
  }
  class FakeAudio {
    constructor(url) { this.url = url; this.listeners = new Map(); this.pauseCalls = 0; this.currentTime = 0; players.push(this) }
    async play() { if (playFailure) throw playFailure; if (playGate) await playGate.promise }
    pause() { this.pauseCalls += 1 }
    removeAttribute(attribute) { if (attribute === 'src') this.url = '' }
    load() {}
    addEventListener(type, listener) { this.listeners.set(type, listener) }
    removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type) }
    emit(type) { this.listeners.get(type)?.() }
  }
  const environment = {
    AudioContext: FakeContext,
    Audio: FakeAudio,
    URL: { createObjectURL(file) { const url = 'blob:test-' + (urls.length + 1); urls.push({ url, file }); return url }, revokeObjectURL(url) { revoked.push(url) } },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id },
    clearTimeout(id) { timers.delete(id) },
  }
  function advance(ms) {
    now += ms
    for (const context of contexts) if (context.state === 'running') context.currentTime += ms / 1000
    // One pass models a throttled tab: callbacks observe the current audio clock.
    for (const [id, task] of [...timers]) if (task.at <= now) { timers.delete(id); task.callback() }
  }
  return { environment, contexts, players, timers, revoked, urls, advance }
}

const audioFile = (name = 'song.mp3', size = 1024, type = 'audio/mpeg') => ({ name, size, type })

test('music options expose seven offline themes plus auto and local', () => {
  assert.equal(GAL_MUSIC_OPTIONS.length, 9)
  assert.equal(new Set(GAL_MUSIC_OPTIONS.map(option => option.id)).size, 9)
  assert.ok(GAL_MUSIC_OPTIONS.every(option => option.label))
  assert.equal(galThemeForNode({ musicTheme: 'kimi-flute', bgm: 'claude-poem' }), 'kimi-flute')
  assert.equal(galThemeForNode({ bgm: { id: 'claude-poem' } }), 'claude-poem')
  assert.equal(galThemeForNode({ music: 'glass-dome' }), 'glass-dome')
  assert.equal(galThemeForNode({ musicTheme: 'https://example.com/music.mp3' }), 'title-city')
  assert.equal(galThemeForNode(null), 'title-city')
  assert.equal(storyScoreFor('__proto__').id, 'title-city')
})

test('controller construction, volume edits, and file selection never start audio', async () => {
  const fake = fakeAudio()
  const controller = createGalAudioController({ environment: fake.environment })
  controller.setVolume(.2)
  controller.setMuted(true)
  assert.equal(controller.setLocalTrack(audioFile()).ok, true)
  assert.equal(fake.contexts.length, 0)
  assert.equal(fake.players.length, 0)
  assert.equal(controller.status.state, 'idle')
  await controller.dispose()
  assert.deepEqual(fake.revoked, ['blob:test-1'])
})

test('theme switches reuse one context and dispose closes it exactly once', async () => {
  const fake = fakeAudio()
  const controller = createGalAudioController({ environment: fake.environment })
  assert.equal((await controller.start('title-city')).state, 'playing')
  const firstMaster = fake.contexts[0].gains[0]
  assert.equal((await controller.start('kimi-flute')).state, 'playing')
  assert.equal(fake.contexts.length, 1)
  assert.equal(firstMaster.disconnected, true)
  assert.equal(fake.timers.size, 1)
  controller.stop()
  assert.equal(fake.timers.size, 0)
  assert.equal(fake.contexts[0].closeCalls, 0)
  await controller.dispose()
  await controller.dispose()
  assert.equal(fake.contexts[0].closeCalls, 1)
  assert.equal((await controller.start('title-city')).state, 'idle')
})

test('master volume and mute reach true zero, restore selected volume, and clamp input', async () => {
  const fake = fakeAudio()
  const controller = createGalAudioController({ environment: fake.environment })
  await controller.start('title-city', { volume: .42 })
  const gain = fake.contexts[0].gains[0].gain
  controller.setVolume(0)
  assert.equal(gain.events.at(-1)[1], 0)
  controller.setVolume(.71)
  controller.setMuted(true)
  assert.equal(gain.events.at(-1)[1], 0)
  controller.setMuted(false)
  assert.equal(gain.events.at(-1)[1], .71)
  assert.equal(controller.setVolume(Infinity), 0)
  assert.equal(controller.setVolume(-1), 0)
  assert.equal(controller.setVolume(12), 1)
  await controller.dispose()
})

test('score fade-in at volume zero never leaks a minimum master amplitude', async () => {
  const fake = fakeAudio()
  const player = playStoryScore('title-city', { environment: fake.environment, volume: 0, fadeInMs: 500 })
  assert.equal((await player.ready).state, 'playing')
  assert.equal(fake.contexts[0].gains[0].gain.events.at(-1)[1], 0)
  await player.stop()
})

test('stop before resume completes does not schedule notes or revive playback', async () => {
  const gate = deferred()
  const fake = fakeAudio({ suspended: true, resumeGate: gate })
  const controller = createGalAudioController({ environment: fake.environment })
  const starting = controller.start('title-city')
  controller.stop()
  gate.resolve()
  assert.equal((await starting).state, 'idle')
  assert.equal(fake.contexts[0].oscillators.length, 0)
  assert.equal(fake.timers.size, 0)
  await controller.dispose()
})

test('dispose while resume is pending releases context and never restarts sound', async () => {
  const gate = deferred()
  const fake = fakeAudio({ suspended: true, resumeGate: gate })
  const controller = createGalAudioController({ environment: fake.environment })
  const starting = controller.start('title-city')
  await controller.dispose()
  gate.resolve()
  assert.equal((await starting).state, 'idle')
  assert.equal(fake.contexts[0].state, 'closed')
  assert.equal(fake.contexts[0].oscillators.length, 0)
  assert.equal(fake.timers.size, 0)
})

test('blocked resume returns an actionable status instead of a rejected promise', async () => {
  const failure = Object.assign(new Error('activation required'), { name: 'NotAllowedError' })
  const fake = fakeAudio({ suspended: true, resumeFailure: failure })
  const statuses = []
  const controller = createGalAudioController({ environment: fake.environment, onStatus: value => statuses.push(value) })
  assert.equal((await controller.start('title-city')).state, 'blocked')
  assert.match(controller.status.message, /点击/)
  assert.equal(fake.timers.size, 0)
  assert.equal(fake.contexts[0].oscillators.length, 0)
  assert.ok(statuses.some(value => value.state === 'blocked'))
  await controller.dispose()
})

test('a fulfilled resume that remains suspended is reported as blocked', async () => {
  const fake = fakeAudio({ suspended: true, keepSuspended: true })
  const player = playStoryScore('title-city', { environment: fake.environment })
  assert.equal((await player.ready).state, 'blocked')
  assert.equal(fake.contexts[0].state, 'closed')
  assert.equal(fake.timers.size, 0)
})

test('no available browser audio API has a usable unavailable status', async () => {
  const environment = { AudioContext: null, Audio: null }
  const player = playStoryScore('title-city', { environment })
  assert.equal(player.available, false)
  assert.equal((await player.ready).state, 'unavailable')
  const controller = createGalAudioController({ environment })
  assert.equal((await controller.start('title-city')).state, 'unavailable')
  assert.equal((await playGalEffect('click', { environment })).state, 'unavailable')
  await controller.dispose()
})

test('score scheduling follows absolute cycle boundaries without timer drift', async () => {
  const fake = fakeAudio()
  const player = playStoryScore('title-city', { environment: fake.environment })
  await player.ready
  const context = fake.contexts[0]
  const cycle = 60 / storyScoreFor('title-city').bpm * 16
  const firstCount = context.oscillators.length
  fake.advance((cycle - .2) * 1000)
  assert.equal(context.oscillators[firstCount].startAt, .06 + cycle)
  const secondCount = context.oscillators.length
  fake.advance(cycle * 1000)
  assert.ok(Math.abs(context.oscillators[secondCount].startAt - (.06 + cycle * 2)) < 1e-9)
  await player.stop()
})

test('a throttled timer skips expired cycles and schedules no notes in the past', async () => {
  const fake = fakeAudio()
  const player = playStoryScore('title-city', { environment: fake.environment })
  await player.ready
  const context = fake.contexts[0]
  const firstCount = context.oscillators.length
  fake.advance(60000)
  const cycle = 60 / storyScoreFor('title-city').bpm * 16
  const followingStart = .06 + Math.ceil((60 - .06) / cycle) * cycle
  fake.advance((followingStart - 60 - .2) * 1000)
  assert.ok(context.oscillators.length > firstCount)
  assert.ok(context.oscillators.slice(firstCount).every(note => note.startAt >= 60))
  await player.stop()
  assert.equal(fake.timers.size, 0)
  assert.ok(context.oscillators.every(note => note.disconnected))
})

test('fade-out clears all voices and closes an owned context', async () => {
  const fake = fakeAudio()
  const player = playStoryScore('title-city', { environment: fake.environment })
  await player.ready
  const stopping = player.stop({ fadeOutMs: 200 })
  assert.equal(fake.timers.size, 1)
  fake.advance(240)
  await stopping
  assert.equal(fake.contexts[0].state, 'closed')
  assert.equal(fake.timers.size, 0)
  assert.ok(fake.contexts[0].oscillators.every(note => note.disconnected))
})

test('scheduler device failures are visible and cancel pending timers', async () => {
  const fake = fakeAudio()
  const controller = createGalAudioController({ environment: fake.environment })
  await controller.start('title-city')
  fake.contexts[0].failOscillators = true
  const cycle = 60 / storyScoreFor('title-city').bpm * 16
  fake.advance((cycle - .2) * 1000)
  assert.equal(controller.status.state, 'error')
  assert.equal(fake.timers.size, 0)
  await controller.dispose()
})

test('browser audio suspension and external closure produce visible status', async () => {
  const fake = fakeAudio()
  const controller = createGalAudioController({ environment: fake.environment })
  await controller.start('title-city')
  fake.contexts[0].state = 'suspended'
  fake.contexts[0].emit('statechange')
  assert.equal(controller.status.state, 'blocked')
  fake.contexts[0].state = 'running'
  fake.contexts[0].emit('statechange')
  assert.equal(controller.status.state, 'playing')
  fake.contexts[0].state = 'closed'
  fake.contexts[0].emit('statechange')
  assert.equal(controller.status.state, 'unavailable')
  await controller.dispose()
  assert.equal(fake.contexts[0].listeners.size, 0)
})

test('local files require audio MIME and a positive size at most 30 MiB', async () => {
  const fake = fakeAudio()
  const controller = createGalAudioController({ environment: fake.environment })
  for (const file of [null, audioFile('bad.txt', 10, 'text/plain'), audioFile('empty.mp3', 0), audioFile('large.mp3', 30 * 1024 * 1024 + 1), audioFile('infinite.mp3', Infinity), audioFile('unknown.mp3', 10, '')]) assert.equal(controller.setLocalTrack(file).ok, false)
  assert.equal(fake.urls.length, 0)
  assert.equal(controller.setLocalTrack(audioFile('exact.wav', 30 * 1024 * 1024, 'audio/wav')).ok, true)
  assert.equal(controller.localTrackName, 'exact.wav')
  await controller.dispose()
})

test('local music loops, follows mute/volume, revokes replaced and disposed URLs', async () => {
  const fake = fakeAudio()
  const controller = createGalAudioController({ environment: fake.environment })
  controller.setLocalTrack(audioFile('first.mp3'))
  assert.equal((await controller.start('local', { volume: .6 })).state, 'playing')
  assert.equal(fake.players[0].loop, true)
  assert.equal(fake.players[0].volume, .6)
  controller.setMuted(true)
  assert.equal(fake.players[0].muted, true)
  assert.equal(fake.players[0].volume, 0)
  controller.setVolume(.27)
  controller.setMuted(false)
  assert.equal(fake.players[0].volume, .27)
  controller.setLocalTrack(audioFile('second.mp3'))
  assert.ok(fake.players[0].pauseCalls > 0)
  assert.equal(controller.status.state, 'idle')
  assert.deepEqual(fake.revoked, ['blob:test-1'])
  await controller.dispose()
  assert.deepEqual(fake.revoked, ['blob:test-1', 'blob:test-2'])
  assert.equal(fake.contexts.length, 0)
})

test('local decode events cannot later resolve into a false playing status', async () => {
  const gate = deferred()
  const fake = fakeAudio({ playGate: gate })
  const controller = createGalAudioController({ environment: fake.environment })
  controller.setLocalTrack(audioFile())
  const starting = controller.start('local')
  fake.players[0].emit('error')
  gate.resolve()
  assert.equal((await starting).state, 'error')
  assert.match(controller.status.message, /解码/)
  assert.equal(fake.players[0].listeners.size, 0)
  await controller.dispose()
})

test('local play permission rejection is handled and leaves no player listeners', async () => {
  const fake = fakeAudio({ playFailure: Object.assign(new Error('blocked'), { name: 'NotAllowedError' }) })
  const controller = createGalAudioController({ environment: fake.environment })
  controller.setLocalTrack(audioFile())
  assert.equal((await controller.start('local')).state, 'blocked')
  assert.ok(fake.players[0].pauseCalls > 0)
  assert.equal(fake.players[0].listeners.size, 0)
  await controller.dispose()
})

test('stopping a pending local playback cannot resurrect it', async () => {
  const gate = deferred()
  const fake = fakeAudio({ playGate: gate })
  const controller = createGalAudioController({ environment: fake.environment })
  controller.setLocalTrack(audioFile())
  const starting = controller.start('local')
  controller.stop()
  gate.resolve()
  assert.equal((await starting).state, 'idle')
  assert.equal(fake.players[0].url, '')
  await controller.dispose()
})

test('invalid themes or missing local files never allocate audio', async () => {
  const fake = fakeAudio()
  const controller = createGalAudioController({ environment: fake.environment })
  assert.equal((await controller.start('local')).state, 'error')
  assert.equal((await controller.start('https://example.com/song.mp3')).state, 'error')
  assert.equal(fake.contexts.length, 0)
  assert.equal(fake.players.length, 0)
  await controller.dispose()
})

test('muted and zero-volume effects allocate no context or timers', async () => {
  const fake = fakeAudio()
  assert.equal((await playGalEffect('choice', { muted: true, environment: fake.environment })).state, 'idle')
  assert.equal((await playGalEffect('click', { volume: 0, environment: fake.environment })).state, 'idle')
  assert.equal(fake.contexts.length, 0)
  assert.equal(fake.timers.size, 0)
})

test('effects have bounded duration and close the context after playback', async () => {
  const fake = fakeAudio()
  const playing = playGalEffect('choice', { environment: fake.environment })
  assert.equal(fake.contexts.length, 1)
  assert.equal(fake.contexts[0].oscillators[0].stopAt, .12)
  fake.advance(160)
  assert.equal((await playing).state, 'playing')
  assert.equal(fake.contexts[0].state, 'closed')
  assert.equal(fake.timers.size, 0)
})

test('blocked effects handle rejection and close their audio context', async () => {
  const fake = fakeAudio({ suspended: true, resumeFailure: Object.assign(new Error('no gesture'), { name: 'NotAllowedError' }) })
  assert.equal((await playGalEffect('click', { environment: fake.environment })).state, 'blocked')
  assert.equal(fake.contexts[0].state, 'closed')
  assert.equal(fake.timers.size, 0)
})

test('UI status callbacks can throw without leaking audio resources', async () => {
  const fake = fakeAudio()
  const controller = createGalAudioController({ environment: fake.environment, onStatus() { throw new Error('render failure') } })
  assert.equal((await controller.start('title-city')).state, 'playing')
  await controller.dispose()
  await flush()
  assert.equal(fake.contexts[0].state, 'closed')
  assert.equal(fake.timers.size, 0)
})

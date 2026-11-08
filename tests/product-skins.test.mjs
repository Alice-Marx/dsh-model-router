import test from 'node:test'
import assert from 'node:assert/strict'
import { SKIN_IDS, installSkins, registerSkins, skinTheme } from '../apps/integration-client/skins.mjs'

// DS Bot 0.2.7's theme contract (src/client/themes.js registerTheme), restated so the pinned
// vendor tree keeps its closed set of importers.
const THEME_KEYS = ['bg', 'sidebar', 'bubble', 'card', 'text', 'user', 'userText', 'accent']

function fakeHub() {
  const themes = new Map()
  return {
    themes,
    registerTheme(id, theme) {
      assert.match(id, /^[a-z][\w-]{0,31}$/)
      for (const mode of ['light', 'dark']) {
        assert.deepEqual(Object.keys(theme[mode]).sort(), [...THEME_KEYS].sort(), `${id}.${mode} has exactly the theme keys`)
        for (const key of THEME_KEYS) assert.match(theme[mode][key], /^#[0-9a-f]{6}$/i, `${id}.${mode}.${key}`)
      }
      const previous = themes.get(id)
      themes.set(id, theme)
      return () => { if (previous) themes.set(id, previous); else themes.delete(id) }
    },
  }
}

test('skins: every OpenMausBot pair passes DS Bot theme validation and can be released', () => {
  const hub = fakeHub()
  const release = registerSkins(hub.registerTheme)
  assert.deepEqual([...hub.themes.keys()], ['mausbot', 'atelier', 'linen', 'meadow', 'lagoon', 'pop'])
  for (const id of SKIN_IDS) assert.match(hub.themes.get(id).label, /·/)
  release()
  assert.equal(hub.themes.size, 0, 'releasing restores the built-in theme list')
})

test('skins: each mode carries its own status colours for the product pages', () => {
  const theme = skinTheme('mausbot')
  assert.equal(theme.light.bg, '#fcfcfc')
  assert.equal(theme.dark.bg, '#121212')
  assert.match(theme.css, /^html body\{--bp-skin-success:#007a44;[^}]*--bp-skin-accent-text:#0b69cc\}/)
  assert.match(theme.css, /html body\[data-ds-dark-theme\]\{--bp-skin-success:#38d591;/)
  assert.throws(() => skinTheme('nope'), /Unknown skin/)
})

test('skins: installed through the public dshBotQueue before or after DS Bot installs its hub', () => {
  // Before the hub: the task waits in the plain array DS Bot drains when it installs.
  const early = {}
  const disposeEarly = installSkins(early)
  assert.equal(early.dshBotQueue.length, 1)
  const hub = fakeHub()
  const queued = early.dshBotQueue
  early.dshBotQueue = { push: task => task(hub) }
  for (const task of queued) early.dshBotQueue.push(task)
  assert.equal(hub.themes.size, SKIN_IDS.length)
  disposeEarly()
  assert.equal(hub.themes.size, 0)

  // After the hub: the queue runs the task at once.
  const late = { dshBotQueue: { push: task => task(hub) } }
  const disposeLate = installSkins(late)
  assert.equal(hub.themes.size, SKIN_IDS.length)
  disposeLate()
  assert.equal(hub.themes.size, 0)

  // Disposed before DS Bot ever loads: nothing is left queued.
  const never = {}
  installSkins(never)()
  assert.deepEqual(never.dshBotQueue, [])
})

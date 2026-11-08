import test from 'node:test'
import assert from 'node:assert/strict'
import { allThemes, registerTheme, themeCss } from '../modules/bot-runtime/vendor/ds-bot/src/client/themes.js'
import { SKIN_IDS, registerSkins, skinTheme } from '../apps/integration-client/skins.mjs'

test('skins: every OpenMausBot pair passes DS Bot theme validation and can be released', () => {
  const before = Object.keys(allThemes())
  const release = registerSkins(registerTheme)
  try {
    const themes = allThemes()
    for (const id of SKIN_IDS) {
      assert.ok(themes[id], `${id} is registered`)
      assert.match(themes[id].label, /·/)
    }
    assert.deepEqual(SKIN_IDS, ['mausbot', 'atelier', 'linen', 'meadow', 'lagoon', 'pop'])
  } finally {
    release()
  }
  assert.deepEqual(Object.keys(allThemes()), before, 'releasing restores the built-in theme list')
})

test('skins: each mode carries its own status colours for the product pages', () => {
  const css = themeCss(skinTheme('mausbot'))
  assert.match(css, /html body\{[^}]*--bt-main:#fcfcfc/)
  assert.match(css, /html body\[data-ds-dark-theme\]\{[^}]*--bt-main:#121212/)
  assert.match(css, /html body\{--bp-skin-success:#007a44;[^}]*--bp-skin-accent-text:#0b69cc\}/)
  assert.match(css, /html body\[data-ds-dark-theme\]\{--bp-skin-success:#38d591;/)
  assert.throws(() => skinTheme('nope'), /Unknown skin/)
})

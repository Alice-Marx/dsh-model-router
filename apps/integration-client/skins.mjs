/**
 * OpenMausBot's skins as DS Bot themes. OpenMausBot ships each skin as one mode; a DS Bot theme
 * needs a light and a dark mode, so the skins are paired by family. Colours are taken from
 * OpenMausBot's `src/styles.css` (Apache-2.0, see NOTICE): app → bg, panel → sidebar, card →
 * bot bubble, menu → card, ink → text, bubble-user → user, accent → accent. The status colours
 * and hairline the eight theme keys cannot carry ride along as `--bp-skin-*` variables.
 */

const mode = (theme, extra) => ({ theme, extra })

const SKINS = Object.freeze({
  mausbot: {
    label: 'MausBot · 日光 / 午夜',
    light: mode({ bg: '#fcfcfc', sidebar: '#f5f5f5', bubble: '#efefef', card: '#ffffff', text: '#1c1c1c', user: '#1c1c1c', userText: '#fcfcfc', accent: '#126fd4' },
      { success: '#007a44', warning: '#9c5b00', danger: '#cd2834', line: '#1c1c1c1f', raised: '#e4e4e4', control: '#e3e3e3', accentText: '#0b69cc' }),
    dark: mode({ bg: '#121212', sidebar: '#0e0e0e', bubble: '#1f1f1f', card: '#1f1f1f', text: '#f5f5f5', user: '#5a5a5a', userText: '#f5f5f5', accent: '#1084fe' },
      { success: '#38d591', warning: '#ff9800', danger: '#ff5667', line: '#f5f5f50f', raised: '#202020', control: '#282828', accentText: '#7fc0ff' }),
  },
  atelier: {
    label: '工坊 · Atelier / Foundry',
    light: mode({ bg: '#f5f1eb', sidebar: '#fbf8f2', bubble: '#ffffff', card: '#ffffff', text: '#1a1a18', user: '#f2e9dc', userText: '#1a1a18', accent: '#a05f25' },
      { success: '#3f6b47', warning: '#7a5f31', danger: '#a33a32', line: '#c8bda880', raised: '#f2e9dc', control: '#ece4d6', accentText: '#96551f' }),
    dark: mode({ bg: '#100e0b', sidebar: '#171410', bubble: '#1e1a14', card: '#1e1a14', text: '#f4efe4', user: '#2a2318', userText: '#f4efe4', accent: '#d99a3e' },
      { success: '#57b078', warning: '#dfa441', danger: '#e0685e', line: '#3d3529', raised: '#262019', control: '#262019', accentText: '#e0a44c' }),
  },
  linen: {
    label: '亚麻 · Linen / Graphite',
    light: mode({ bg: '#eceff3', sidebar: '#f5f6f8', bubble: '#ffffff', card: '#ffffff', text: '#1d2229', user: '#e1e6ed', userText: '#1d2229', accent: '#355f8a' },
      { success: '#2f704f', warning: '#765b2b', danger: '#a83d48', line: '#b4bbc580', raised: '#e1e6ed', control: '#e6e9ee', accentText: '#355f8a' }),
    dark: mode({ bg: '#111214', sidebar: '#181a1d', bubble: '#22252a', card: '#22252a', text: '#f2f4f7', user: '#30343a', userText: '#f2f4f7', accent: '#4f75a2' },
      { success: '#63b58a', warning: '#d3a150', danger: '#dd6b73', line: '#3b4048', raised: '#2a2d32', control: '#2a2d32', accentText: '#8fb3dc' }),
  },
  meadow: {
    label: '草地 · Meadow / Aurora',
    light: mode({ bg: '#ffffff', sidebar: '#f6f8f6', bubble: '#f1f5f2', card: '#ffffff', text: '#0f1a13', user: '#e1e9e3', userText: '#0f1a13', accent: '#1a7a48' },
      { success: '#1a7a48', warning: '#8a5a00', danger: '#c02b3a', line: '#c9d3cc', raised: '#e9eeea', control: '#e9eeea', accentText: '#1a7a48' }),
    dark: mode({ bg: '#0b0c0b', sidebar: '#131413', bubble: '#1a1c1a', card: '#1a1c1a', text: '#f2f5f2', user: '#18432c', userText: '#ecfff2', accent: '#3ccf73' },
      { success: '#4ade80', warning: '#f5a524', danger: '#ff5f6d', line: '#343834', raised: '#1d1f1d', control: '#1d1f1d', accentText: '#3ccf73' }),
  },
  lagoon: {
    label: '泻湖 · Lagoon / Dusk',
    light: mode({ bg: '#dfeceb', sidebar: '#ecf4f3', bubble: '#ffffff', card: '#ffffff', text: '#14201f', user: '#cfe4e1', userText: '#14201f', accent: '#11736d' },
      { success: '#2f6b4f', warning: '#7a5a2a', danger: '#a8382f', line: '#aebfbd80', raised: '#cfe4e1', control: '#d7e8e6', accentText: '#11736d' }),
    dark: mode({ bg: '#121014', sidebar: '#19161c', bubble: '#231f27', card: '#231f27', text: '#f4eff6', user: '#332b38', userText: '#f4eff6', accent: '#765683' },
      { success: '#6fad83', warning: '#d0a35d', danger: '#db727a', line: '#403847', raised: '#2b2630', control: '#2b2630', accentText: '#c4a5d1' }),
  },
  pop: {
    label: '波普 · Pop / Halloween',
    light: mode({ bg: '#fdf5ea', sidebar: '#f6ebdb', bubble: '#ffffff', card: '#ffffff', text: '#1b1613', user: '#1b1613', userText: '#ffffff', accent: '#7f52f0' },
      { success: '#1f7a4d', warning: '#8a5a00', danger: '#d93a2b', line: '#1b161333', raised: '#efe3d1', control: '#efe3d1', accentText: '#6a3fd9' }),
    dark: mode({ bg: '#110d16', sidebar: '#17121e', bubble: '#201a29', card: '#1e1827', text: '#f8efe2', user: '#3d2818', userText: '#fff1e2', accent: '#ff7f1f' },
      { success: '#7cc48f', warning: '#f2b45a', danger: '#f0727c', line: '#3b3048', raised: '#262030', control: '#262030', accentText: '#ff9a4d' }),
  },
})

const declarations = extra => Object.entries(extra)
  .map(([key, value]) => `--bp-skin-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}:${value}`).join(';')

/** The DS Bot theme definition for one skin pair. */
export function skinTheme(id) {
  const skin = SKINS[id]
  if (!skin) throw new Error(`Unknown skin: ${id}`)
  return {
    label: skin.label,
    light: { ...skin.light.theme },
    dark: { ...skin.dark.theme },
    css: `html body{${declarations(skin.light.extra)}}html body[data-ds-dark-theme]{${declarations(skin.dark.extra)}}`,
  }
}

export const SKIN_IDS = Object.freeze(Object.keys(SKINS))

/** Register every skin with DS Bot's theme registry; returns one disposer for all of them. */
export function registerSkins(registerTheme) {
  const releases = SKIN_IDS.map(id => registerTheme(id, skinTheme(id)))
  return () => { for (const release of releases.reverse()) release() }
}

import { createElement as h } from 'react'
import { MODEL_AVATARS } from './model-avatar-catalog.js'
import { t } from './i18n.js'

export const modelAvatarOf = image => typeof image === 'string'
  ? MODEL_AVATARS.find(entry => entry.image === image) : undefined

export const avatarSourceOf = image => modelAvatarOf(image) ? 'models' : image ? 'upload' : 'bot'

// A preset uses the existing Host-owned avatar.image field. It needs no network,
// file path or separate preset resolver after the Bot has saved it.
export function ModelAvatarPicker({ image, onPick }) {
  return h('div', { className: 'bt-model-avatars', role: 'group', 'aria-label': t('Built-in model avatars') },
    MODEL_AVATARS.map(entry => h('button', {
      key: entry.id, type: 'button', className: 'bt-model-avatar', 'data-model-avatar': entry.id,
      title: t(entry.label), 'aria-label': t('Use {name} avatar', { name: t(entry.label) }),
      'aria-pressed': image === entry.image, onClick: () => onPick(entry),
    }, h('img', { src: entry.image, alt: '', width: 52, height: 52, draggable: false, decoding: 'async' }),
    h('span', null, t(entry.label)))))
}

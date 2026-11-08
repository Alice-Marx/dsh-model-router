import { createElement as h, Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { CheckIcon, SlidersIcon } from './icons.js'
import { language } from './i18n.js'

// -------------------------------------------------------------------------
// The model picker as a rail of providers and the models of the chosen one. Official
// tools (the CLIs the person already signed in to) come first, then API providers, then
// models served on this machine. Picking only names a route; funding and permission stay
// with the Host's committed binding.

const zh = () => language().startsWith('zh')
const say = (en, cn, params = {}) => (zh() ? cn : en).replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ''))

export const SUGGESTED = 5
const ENGINE = /^engine-/
const LOCAL = /(?:^|[-_.])(?:ollama|lmstudio|lm-studio|llamacpp|llama-cpp|omlx|mlx|vllm|exo|unsloth|localai|local)(?:$|[-_.])/i
const RAILS = ['tools', 'api', 'local']
const railLabel = rail => ({ tools: say('Official tools', '官方工具'), api: say('API', 'API'), local: say('Local', '本地') })[rail]

export const railOf = provider => (ENGINE.test(provider) ? 'tools' : LOCAL.test(provider) ? 'local' : 'api')
export const shortProvider = name => String(name ?? '').replace(/\s*[（(](?:官方工具|official tool)[）)]\s*$/i, '')

/** Providers in rail order, each with its models in catalog order. */
export function providerGroups(models) {
  const groups = new Map()
  for (const model of models ?? []) {
    const id = model.provider ?? model.ref.split('/')[0]
    if (!groups.has(id)) groups.set(id, { id, name: shortProvider(model.providerName ?? id), rail: railOf(id), models: [], needsKey: false })
    const group = groups.get(id)
    group.models.push(model)
    if (model.needsKey) group.needsKey = true
  }
  const list = [...groups.values()]
  return RAILS.flatMap(rail => list.filter(group => group.rail === rail))
}

/** The short list: the current model, the default, then the first models, in catalog order. */
export function suggestedModels(models, { current, defaultRef, count = SUGGESTED } = {}) {
  const keep = new Set([current, defaultRef].filter(ref => models.some(model => model.ref === ref)))
  for (const model of models) {
    if (keep.size >= count) break
    keep.add(model.ref)
  }
  return models.filter(model => keep.has(model.ref))
}

const matches = (model, needle) => [model.name, model.ref, model.providerName].some(text => String(text ?? '').toLowerCase().includes(needle))
const initials = name => {
  const words = String(name ?? '?').trim().split(/[\s\-_/]+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : String(name ?? '?').slice(0, 2)).toUpperCase()
}

function ProviderMark({ group, size = 30 }) {
  return h('span', { className: 'bt-ep-mark', 'data-provider': group.id, 'data-rail': group.rail, style: { width: size, height: size }, 'aria-hidden': true }, initials(group.name))
}

function Row({ model, current, defaultRef, onPick, meta }) {
  const selected = model.ref === current
  return h('button', {
    type: 'button', role: 'menuitemradio', 'aria-checked': selected, title: model.ref, 'data-ep-row': '',
    'data-unusable': model.needsKey || undefined, onClick: () => onPick(model.ref),
  },
  h('span', { className: 'bt-ep-row-copy' },
    h('span', { className: 'bt-ep-row-name' }, model.name),
    meta ? h('span', { className: 'bt-ep-row-meta' }, meta) : null),
  model.ref === defaultRef ? h('span', { className: 'bt-ep-badge' }, say('Default', '默认')) : null,
  h('span', { className: 'bt-model-tick', 'aria-hidden': true }, selected ? h(CheckIcon) : null))
}

const statusOf = group => group.needsKey
  ? { tone: 'warning', label: say('API key required', '需要 API Key') }
  : group.rail === 'tools'
    ? { tone: 'success', label: say('Your subscription', '使用你的订阅') }
    : group.rail === 'local' ? { tone: 'success', label: say('On this machine', '本机') } : { tone: 'success', label: say('Ready', '就绪') }

const paneNote = group => group.rail === 'tools'
  ? say('Runs the signed-in CLI read-only in a Host-owned empty folder. No API key is read.', '由已登录的官方 CLI 在宿主专用空文件夹里只读运行，不读取 API Key。')
  : group.needsKey ? say('Add this provider’s API key in DSH settings first; every turn fails without it.', '请先在 DSH 设置中填写该供应商的 API Key，否则每次调用都会失败。') : null

/**
 * `efforts` are the rows of the shown model's thinking levels ({ effort, label }); `effort`
 * is the Bot's own pick. `manage` opens the providers page.
 */
export function EnginePicker({ roster, current, onPick, efforts = [], effort, onPickEffort, manage, emptyText }) {
  const models = roster.models ?? []
  const groups = useMemo(() => providerGroups(models), [models])
  const home = groups.find(group => group.models.some(model => model.ref === current))
    ?? groups.find(group => group.models.some(model => model.ref === roster.defaultModel)) ?? groups[0]
  const [selected, setSelected] = useState(home?.id)
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)
  const pane = useRef(null)
  const search = useRef(null)
  useEffect(() => { setAll(false) }, [selected])
  useEffect(() => { search.current?.focus({ preventScroll: true }) }, [])
  if (groups.length === 0) return h('div', { className: 'bt-model-none' }, emptyText)
  const group = groups.find(item => item.id === selected) ?? home
  const needle = query.trim().toLowerCase()
  const found = needle ? models.filter(model => matches(model, needle)) : null
  const short = suggestedModels(group.models, { current, defaultRef: roster.defaultModel })
  const list = found ?? (all || group.models.length <= SUGGESTED + 2 ? group.models : short)
  const status = statusOf(group)
  const note = paneNote(group)
  const move = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const rows = [...(pane.current?.querySelectorAll('[data-ep-row]') ?? [])]
    if (rows.length === 0) return
    event.preventDefault()
    const at = rows.indexOf(document.activeElement)
    const next = event.key === 'ArrowDown' ? (at + 1) % rows.length : (at <= 0 ? rows.length - 1 : at - 1)
    rows[next].focus()
  }
  return h('div', { className: 'bt-ep' },
    h('div', { className: 'bt-ep-rail', role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': say('Providers', '供应商') },
      RAILS.map(rail => {
        const items = groups.filter(item => item.rail === rail)
        if (items.length === 0) return null
        return h(Fragment, { key: rail },
          h('div', { className: 'bt-ep-rail-label', role: 'presentation' }, railLabel(rail)),
          items.map(item => h('button', {
            key: item.id, type: 'button', role: 'tab', 'aria-selected': item.id === group.id, title: item.name,
            'aria-label': item.name, className: 'bt-ep-rail-item', onClick: () => { setSelected(item.id); setQuery('') },
          }, h(ProviderMark, { group: item }), item.needsKey ? h('span', { className: 'bt-ep-dot', 'aria-hidden': true }) : null)))
      })),
    h('div', { className: 'bt-ep-pane', ref: pane, onKeyDown: move },
      h('div', { className: 'bt-ep-head' },
        h('span', { className: 'bt-ep-title' }, found ? say('Search results', '搜索结果') : group.name),
        found ? null : h('span', { className: 'bt-ep-status', 'data-tone': status.tone }, status.label)),
      !found && note ? h('div', { className: 'bt-ep-note' }, note) : null,
      h('label', { className: 'bt-ep-search' },
        h('svg', { width: 14, height: 14, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', 'aria-hidden': true },
          h('circle', { cx: 9, cy: 9, r: 5.5 }), h('path', { d: 'M13.5 13.5L17 17' })),
        h('input', {
          ref: search, type: 'search', value: query, 'aria-label': say('Search models', '搜索模型'), placeholder: say('Search models', '搜索模型'),
          onChange: event => setQuery(event.target.value),
          onKeyDown: (event) => { if (event.key === 'ArrowDown') { event.preventDefault(); pane.current?.querySelector('[data-ep-row]')?.focus() } },
        })),
      h('div', { className: 'bt-ep-list' },
        found ? null : h('div', { className: 'bt-model-group', role: 'presentation' },
          list === short && list.length < group.models.length ? say('Suggested', '推荐') : say('All models', '全部模型')),
        list.length === 0 ? h('div', { className: 'bt-model-none' }, say('No matching models.', '没有匹配的模型。'))
          : list.map(model => h(Row, {
            key: model.ref, model, current, defaultRef: roster.defaultModel, onPick,
            meta: found ? shortProvider(model.providerName ?? model.provider) : model.needsKey ? say('API key required', '需要 API Key') : null,
          })),
        !found && group.models.length > SUGGESTED + 2 ? h('button', { type: 'button', className: 'bt-ep-more', onClick: () => setAll(value => !value) },
          all ? say('Show suggested only', '只显示推荐') : say('Show all {count} models', '显示全部 {count} 个模型', { count: group.models.length })) : null),
      efforts.length > 0 ? h('div', { className: 'bt-ep-efforts', role: 'group', 'aria-label': say('Thinking level', '思考强度') },
        h('span', { className: 'bt-ep-efforts-label' }, say('Thinking', '思考')),
        efforts.map(row => h('button', {
          key: row.effort ?? 'default', type: 'button', role: 'menuitemradio', className: 'bt-ep-pill',
          'aria-checked': (row.effort ?? null) === (effort ?? null), onClick: () => onPickEffort(row.effort),
        }, row.label))) : null,
      manage ? h('div', { className: 'bt-ep-foot' },
        h('button', { type: 'button', role: 'menuitem', onClick: manage }, h(SlidersIcon), h('span', { className: 'bt-menu-label' }, say('Models and providers…', '模型与供应商…')))) : null))
}

export const ENGINE_PICKER_CSS = `
.bt-menu.bt-ep-menu{padding:0;overflow:hidden;gap:0}
.bt-ep{display:flex;min-height:0;max-height:inherit;width:100%}
.bt-ep-rail{flex:none;display:flex;flex-direction:column;align-items:center;gap:4px;width:56px;padding:8px 0;border-right:.5px solid var(--bt-line);overflow-y:auto;scrollbar-width:none}
.bt-ep-rail-label{width:100%;padding:4px 2px 0;font-size:10px;line-height:13px;text-align:center;color:var(--bt-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-ep-rail-label:not(:first-child){margin-top:6px}
.bt-menu .bt-ep-rail-item{position:relative;justify-content:center;width:38px;height:38px;min-height:38px;padding:0;border-radius:8px}
.bt-menu .bt-ep-rail-item[aria-selected=true]{background:var(--bt-active)}
.bt-ep-mark{display:inline-flex;align-items:center;justify-content:center;border-radius:8px;font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--bt-ink);background:var(--bt-hover);box-shadow:inset 0 0 0 .5px var(--bt-line)}
.bt-ep-mark[data-rail=tools]{color:var(--bt-accent-ink);box-shadow:none;background:var(--bt-accent)}
.bt-ep-mark[data-rail=local]{background:transparent;box-shadow:inset 0 0 0 1px var(--bt-line-2)}
.bt-ep-dot{position:absolute;top:4px;right:4px;width:7px;height:7px;border-radius:50%;background:var(--bt-star);box-shadow:0 0 0 2px var(--bt-glass-bg)}
.bt-ep-pane{flex:1;min-width:0;display:flex;flex-direction:column;padding:8px 6px 6px;overflow:hidden}
.bt-ep-head{display:flex;align-items:center;gap:8px;padding:2px 8px 6px}
.bt-ep-title{flex:1;min-width:0;font-size:14px;line-height:20px;font-weight:600;color:var(--bt-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-ep-status{flex:none;padding:1px 8px;border-radius:999px;font-size:11px;line-height:18px;font-weight:500}
.bt-ep-status[data-tone=success]{color:var(--bt-green);background:color-mix(in srgb,var(--bt-green) 12%,transparent)}
.bt-ep-status[data-tone=warning]{color:var(--bt-star);background:color-mix(in srgb,var(--bt-star) 14%,transparent)}
.bt-ep-note{margin:0 8px 6px;font-size:12px;line-height:17px;color:var(--bt-ink-2)}
.bt-ep-search{display:flex;align-items:center;gap:6px;height:34px;margin:0 2px 4px;padding:0 8px;border-radius:8px;background:var(--bt-hover);color:var(--bt-ink-3)}
.bt-ep-search:focus-within{outline:2px solid var(--bt-accent);outline-offset:-1px}
.bt-ep-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--bt-ink);font:inherit;font-size:13px}
.bt-ep-search input::-webkit-search-cancel-button{display:none}
.bt-ep-list{flex:1;min-height:0;overflow-y:auto;scrollbar-width:thin;display:flex;flex-direction:column;gap:2px}
.bt-menu .bt-ep-list button[data-ep-row]{gap:8px}
.bt-menu .bt-ep-list button[aria-checked=true]{background:var(--bt-hover)}
.bt-menu .bt-ep-list button:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
.bt-ep-row-copy{flex:1;min-width:0;display:flex;flex-direction:column}
.bt-ep-row-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-ep-row-meta{font-size:11px;line-height:14px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-menu button[data-unusable] .bt-ep-row-name{color:var(--bt-ink-2)}
.bt-ep-badge{flex:none;padding:0 6px;border-radius:999px;font-size:10px;line-height:16px;font-weight:500;color:var(--bt-ink-2);box-shadow:inset 0 0 0 .5px var(--bt-line-2)}
.bt-menu .bt-ep-more{justify-content:center;color:var(--bt-ink-2);font-size:12px}
.bt-ep-efforts{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 6px 4px;border-top:.5px solid var(--bt-line);margin-top:4px}
.bt-ep-efforts-label{font-size:11px;color:var(--bt-ink-3);margin-right:2px}
.bt-menu .bt-ep-pill{width:auto;min-height:26px;padding:3px 10px;border-radius:999px;font-size:12px;box-shadow:inset 0 0 0 1px var(--bt-line)}
.bt-menu .bt-ep-pill[aria-checked=true]{background:var(--bt-active);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--bt-accent) 60%,transparent)}
.bt-ep-foot{padding-top:4px;margin-top:4px;border-top:.5px solid var(--bt-line)}
.bt-ep-foot button{color:var(--bt-ink-2)}
@media (max-width:520px){.bt-ep-rail{width:48px}.bt-menu .bt-ep-rail-item{width:34px;height:34px;min-height:34px}}
`

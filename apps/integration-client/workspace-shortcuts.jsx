import React from 'react'
import { UiIcon } from './ui-icons.jsx'

/** Real sidebar destinations, shared by the installed plugin and its UI checks. */
export function WorkspaceShortcuts({ onNavigate, compact = false }) {
  return <nav className={`bp-workspace-shortcuts${compact ? ' bp-workspace-shortcuts-compact' : ''}`} aria-label="电脑与 AI">
    <button type="button" aria-label="远程电脑" title="远程电脑" onClick={() => onNavigate('machines')}><UiIcon name="computer" size={17}/>{!compact && <span>电脑</span>}</button>
    <button type="button" aria-label="AI 提供方" title="AI 提供方" onClick={() => onNavigate('ai')}><UiIcon name="spark" size={17}/>{!compact && <span>AI 连接</span>}</button>
  </nav>
}

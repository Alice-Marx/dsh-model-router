import React, { useId } from 'react'

/** Original, theme-aware artwork. Decorative; never represents a live screen. */
export function ComputerArt({ compact = false }) {
  const id = useId().replaceAll(':', '')
  return <svg className={`bp-computer-art${compact ? ' bp-computer-art-small' : ''}`} viewBox="0 0 380 210" fill="none" aria-hidden="true" focusable="false">
    <defs><linearGradient id={id} x1="45" y1="20" x2="320" y2="195" gradientUnits="userSpaceOnUse"><stop stopColor="var(--bp-art-lilac, #dedafa)"/><stop offset="1" stopColor="var(--bp-art-mint, #d5e9df)"/></linearGradient></defs>
    <ellipse cx="190" cy="182" rx="134" ry="13" fill="currentColor" opacity=".04"/>
    <rect x="58" y="23" width="259" height="151" rx="14" fill="var(--bp-surface, white)" stroke="var(--bp-border, #dedee5)"/>
    <rect x="66" y="31" width="243" height="133" rx="8" fill={`url(#${id})`}/>
    <path d="M170 176v12h36v-12m-48 14h60" stroke="currentColor" strokeOpacity=".18" strokeWidth="5" strokeLinecap="round"/>
    <rect x="87" y="49" width="143" height="92" rx="8" fill="var(--bp-surface, white)" fillOpacity=".94"/>
    <circle cx="99" cy="59" r="2" fill="currentColor" opacity=".25"/><circle cx="107" cy="59" r="2" fill="currentColor" opacity=".15"/><circle cx="115" cy="59" r="2" fill="currentColor" opacity=".1"/>
    <rect x="99" y="74" width="32" height="54" rx="4" fill="currentColor" opacity=".045"/>
    <path d="M143 80h65m-65 13h49m-49 13h61m-61 13h37" stroke="currentColor" strokeOpacity=".12" strokeWidth="5" strokeLinecap="round"/>
    <rect x="222" y="106" width="91" height="66" rx="9" fill="var(--bp-surface, white)" stroke="var(--bp-border, #dedee5)"/>
    <path d="M236 125h17l5 6h35v26h-57z" fill="var(--bp-art-lilac, #dedafa)"/>
    <path d="m206 112 6 28 6-10 11-3z" fill="var(--bp-ink, #282832)" stroke="var(--bp-surface, white)" strokeWidth="2.5" strokeLinejoin="round"/>
    <circle cx="308" cy="50" r="17" fill="var(--bp-surface, white)" stroke="var(--bp-border, #dedee5)"/><path d="m301 50 5 5 9-10" stroke="var(--bp-focus, #7765bb)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
}

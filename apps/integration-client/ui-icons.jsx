import React from 'react'

const paths = {
  bot: ['M8 4h8l4 4v8l-4 4H8l-4-4V8Z', 'M9 10v3m6-3v3'],
  team: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-7.87a4 4 0 0 1 0 7.75'],
  tasks: ['M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3', 'M9 3h6v4H9Zm-1 10 2 2 5-5m-7 8h8'],
  computer: ['M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z', 'M8 21h8m-4-4v4'],
  folder: ['M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm0 1h18'],
  repeat: ['m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3'],
  chart: ['M4 3v17h17M9 15V9m5 6V5m5 10v-4'],
  settings: ['M4 7h7m4 0h5M4 17h3m4 0h9', 'M11 4v6m-4 4v6m8-16v6m-4 4v6'],
  refresh: ['M20 7v5h-5M4 17v-5h5', 'M6.1 6.1A8 8 0 0 1 19.5 9M4.5 15a8 8 0 0 0 13.4 2.9'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14m5-2 5 5'],
  upload: ['M12 16V3m-5 5 5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4'],
  plus: ['M12 5v14M5 12h14'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6', 'M8 13h8m-8 4h5'],
  arrow: ['M7 17 17 7M7 7h10v10'],
  chevron: ['m9 5 7 7-7 7'],
  back: ['m12 5-7 7 7 7m-7-7h14'],
  expand: ['M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5'],
  check: ['m5 12 4 4L19 6'],
  play: ['m8 4 12 8-12 8Z'],
  lock: ['M5 10h14v11H5Zm3 0V7a4 4 0 0 1 8 0v3m-4 4v3'],
  spark: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z', 'M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z'],
  chip: ['M7 7h10v10H7Z', 'M10 3v4m4-4v4m-4 10v4m4-4v4M3 10h4m-4 4h4m10-4h4m-4 4h4'],
  inbox: ['M3 13h5l1.5 3h5L16 13h5', 'M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z'],
  copy: ['M9 9h11v11H9Z', 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'],
  keyboard: ['M3 6h18v12H3Z', 'M7 10h.01M11 10h.01M15 10h.01M7 14h10'],
}

export function UiIcon({ name, size = 18, className = '', ...props }) {
  return <svg className={`bp-icon ${className}`} width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false" {...props}>
    {(paths[name] ?? paths.bot).map((d, index) => <path key={index} d={d} />)}
  </svg>
}

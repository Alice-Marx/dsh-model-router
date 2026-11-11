import React from 'react'

const paths = {
  home: ['m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Zm6 11v-8h6v8'],
  inbox: ['M4 4h16l2 10v6H2v-6Zm-2 10h6l2 3h4l2-3h6'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2'],
  activity: ['M3 12h4l3-8 4 16 3-8h4'],
  sun: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5'],
  moon: ['M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z'],
  memory: ['M9 4a3 3 0 0 0-5 3 4 4 0 0 0 0 7 4 4 0 0 0 5 5m6-15a3 3 0 0 1 5 3 4 4 0 0 1 0 7 4 4 0 0 1-5 5', 'M12 3v18m-5-11 5 2 5-2m-9 6 4-2 4 2'],
  voice: ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 8v1a7 7 0 0 0 14 0v-1m-7 8v3m-4 0h8'],
  keyboard: ['M3 5h18v14H3Zm4 4h1m3 0h1m3 0h1m-9 4h1m3 0h1m3 0h1m-9 3h10'],
  hand: ['M7 11V5a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v7l1-2a2 2 0 0 1 3 2l-4 9H9l-6-7a2 2 0 0 1 3-3l3 3'],
  fit: ['M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8Z'],
  close: ['m6 6 12 12M6 18 18 6'],
  board: ['M3 4h7v16H3Zm11 0h7v10h-7'],
  list: ['M9 6h12M9 12h12M9 18h12M3 6h1m-1 6h1m-1 6h1'],
  spark: ['m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z'],
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
  download: ['M12 3v13m-5-5 5 5 5-5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3'],
  plus: ['M12 5v14M5 12h14'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6', 'M8 13h8m-8 4h5'],
  arrow: ['M7 17 17 7M7 7h10v10'],
  chevron: ['m9 5 7 7-7 7'],
  back: ['m12 5-7 7 7 7m-7-7h14'],
  expand: ['M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5'],
  check: ['m5 12 4 4L19 6'],
  play: ['m8 4 12 8-12 8Z'],
  lock: ['M5 10h14v11H5Zm3 0V7a4 4 0 0 1 8 0v3m-4 4v3'],
}

export function UiIcon({ name, size = 18, className = '', ...props }) {
  return <svg className={`bp-icon ${className}`} width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false" {...props}>
    {(paths[name] ?? paths.bot).map((d, index) => <path key={index} d={d} />)}
  </svg>
}

/**
 * Minimal 16px stroke icon set (1.5px, round caps) — consistent weight across
 * the whole UI. Paths drawn on a 16×16 grid.
 */
const PATHS = {
  'chevron-right': <path d="M6 3.5 L10.5 8 L6 12.5" />,
  folder: (
    <path d="M1.75 4.25 a1 1 0 0 1 1-1 h3l1.5 1.75h6a1 1 0 0 1 1 1v6.25a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z" />
  ),
  'folder-open': (
    <>
      <path d="M1.75 4.25a1 1 0 0 1 1-1h3l1.5 1.75h6a1 1 0 0 1 1 1v.75" />
      <path d="M3.2 13.25h9.3a1 1 0 0 0 .95-.7l1.35-4.3a.75.75 0 0 0-.72-.98H4.6a1 1 0 0 0-.95.7L2.25 12a1 1 0 0 0 .95 1.25z" />
    </>
  ),
  'file-text': (
    <>
      <path d="M4 1.75h5.25L12.75 5.25v9a1 1 0 0 1-1 1H4.25a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1z" />
      <path d="M9 1.75v3.5h3.75" />
      <path d="M5.5 8.75h5M5.5 11.25h5" />
    </>
  ),
  file: (
    <>
      <path d="M4 1.75h5.25L12.75 5.25v9a1 1 0 0 1-1 1H4.25a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1z" />
      <path d="M9 1.75v3.5h3.75" />
    </>
  ),
  plus: <path d="M8 3.25v9.5M3.25 8h9.5" />,
  minus: <path d="M3.25 8h9.5" />,
  'file-plus': (
    <>
      <path d="M4 1.75h5.25L12.75 5.25v9a1 1 0 0 1-1 1H4.25a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1z" />
      <path d="M9 1.75v3.5h3.75" />
      <path d="M8 8v4M6 10h4" />
    </>
  ),
  'collapse-all': (
    <>
      <path d="M2.75 5.5 L8 3 L13.25 5.5" />
      <path d="M2.75 9 L8 6.5 L13.25 9" />
      <path d="M2.75 12.5 L8 10 L13.25 12.5" />
    </>
  ),
  gear: (
    <>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.9v1.7M8 12.4v1.7M13.3 4.9l-1.5.85M4.2 10.25l-1.5.85M13.3 11.1l-1.5-.85M4.2 5.75l-1.5-.85" />
    </>
  ),
  'folder-plus': (
    <>
      <path d="M1.75 4.25a1 1 0 0 1 1-1h3l1.5 1.75h6a1 1 0 0 1 1 1v6.25a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z" />
      <path d="M8 7.25v3.5M6.25 9h3.5" />
    </>
  ),
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  check: <path d="M3 8.5l3.5 3.5L13 4.5" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.25v1.5M8 13.25v1.5M1.25 8h1.5M13.25 8h1.5M3.2 3.2l1.05 1.05M11.75 11.75l1.05 1.05M12.8 3.2l-1.05 1.05M4.25 11.75L3.2 12.8" />
    </>
  ),
  moon: <path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />,
  monitor: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1" />
      <path d="M6 13.75h4M8 11.25v2.5" />
    </>
  ),
  keyboard: (
    <>
      <rect x="1.25" y="4.25" width="13.5" height="8" rx="1" />
      <path d="M3.75 6.75h.5M6.25 6.75h.5M8.75 6.75h.5M11.25 6.75h.5M3.75 9.75h8.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M2 4.5h6M11.5 4.5H14M2 11.5h2.5M8 11.5h6" />
      <circle cx="9.75" cy="4.5" r="1.75" />
      <circle cx="6.25" cy="11.5" r="1.75" />
    </>
  ),
  type: <path d="M3 4.5V3h10v1.5M8 3v10M6 13h4" />,
  markdown: (
    <>
      <rect x="1.25" y="3.75" width="13.5" height="8.5" rx="1" />
      <path d="M3.25 10.25v-4l1.75 2 1.75-2v4M11.5 6.25v3M10 8l1.5 1.75L13 8" />
    </>
  ),
  palette: (
    <>
      <path d="M8 1.75a6.25 6.25 0 1 0 0 12.5c.9 0 1.25-.55 1.25-1.15 0-.9-.75-1.1-.75-2.1 0-.85.7-1.5 1.55-1.5h1.7a2.5 2.5 0 0 0 2.5-2.5c0-3-2.9-5.25-6.25-5.25z" />
      <circle cx="5" cy="6" r="0.4" />
      <circle cx="8" cy="4.5" r="0.4" />
      <circle cx="11" cy="6" r="0.4" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v4M8 4.9v.2" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" />
    </>
  ),
  link: (
    <>
      <path d="M6.5 9.5l3-3" />
      <path d="M7.25 4.75l1-1a2.65 2.65 0 0 1 3.75 0l.25.25a2.65 2.65 0 0 1 0 3.75l-1 1" />
      <path d="M8.75 11.25l-1 1a2.65 2.65 0 0 1-3.75 0l-.25-.25a2.65 2.65 0 0 1 0-3.75l1-1" />
    </>
  ),
  refresh: (
    <>
      <path d="M13.25 8a5.25 5.25 0 1 1-1.55-3.72" />
      <path d="M13.5 1.75v3h-3" />
    </>
  ),
  list: (
    <>
      <path d="M5.5 4.25h8M5.5 8h8M5.5 11.75h8" />
      <path d="M2.5 4.25h.01M2.5 8h.01M2.5 11.75h.01" />
    </>
  ),
  sparkle: <path d="M8 1.75l1.5 4.75L14.25 8 9.5 9.5 8 14.25 6.5 9.5 1.75 8 6.5 6.5z" />,
  eye: (
    <>
      <path d="M1.5 8s2.5-4.75 6.5-4.75S14.5 8 14.5 8s-2.5 4.75-6.5 4.75S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="1.9" />
    </>
  ),
  pencil: (
    <>
      <path d="M11 2.75l2.25 2.25L5.5 12.75 2.75 13.25l.5-2.75z" />
      <path d="M9.5 4.25l2.25 2.25" />
    </>
  ),
  columns: (
    <>
      <rect x="2" y="2.75" width="12" height="10.5" rx="1" />
      <path d="M8 2.75v10.5" />
    </>
  ),
  bold: (
    <path d="M4 2.75h4.25a2.5 2.5 0 0 1 2.5 2.5c0 1.15-.75 2.1-1.75 2.4 1.25.3 2.25 1.4 2.25 2.6a2.75 2.75 0 0 1-2.75 2.75H4V2.75zm2 4.25h2.25a1 1 0 0 0 0-2H6v2zm0 4.5h2.5a1.25 1.25 0 0 0 0-2.5H6v2.5z" />
  ),
  italic: <path d="M9.5 2.75h3.75M5.25 13.25h3.75M8.5 2.75l-2.5 10.5" />,
  strikethrough: (
    <>
      <path d="M12.5 4.5c-.7-.9-2-1.5-3.5-1.5-2.2 0-3.5 1.2-3.5 2.8 0 1.4.9 2.2 2.8 2.6M2 8h12M6.2 11.2c.7.8 1.8 1.3 3.3 1.3 2 0 3.5-.9 3.5-2.5 0-1.2-.7-2-2.5-2.4" />
    </>
  ),
  code: <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />,
  quote: (
    <>
      <path d="M2.5 4.5v7M5.5 6.5h8M5.5 9.5h5" />
    </>
  ),
  heading: (
    <>
      <path d="M3.5 3.5v9M12.5 3.5v9M3.5 8h9" />
    </>
  ),
  'list-ordered': (
    <>
      <path d="M6.5 4.5h7.5M6.5 8h7.5M6.5 11.5h7.5M2 3.5l1.5-.75v3.25M1.75 10a1.25 1.25 0 0 1 2.2-.8c.4.4.2 1.1-.3 1.6L1.75 12.5h2.5" />
    </>
  ),
  'check-square': (
    <>
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M5 8l2 2 4-4" />
    </>
  ),
  table: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <path d="M1.75 6.5h12.5M6.5 6.5v6.75M10.5 6.5v6.75" />
    </>
  ),
  image: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <circle cx="5.25" cy="6" r="1" />
      <path d="M14.25 10.5l-3.75-3.5-5.5 5.5" />
    </>
  ),
  math: (
    <>
      <path d="M2.5 11.5l1.75-7h2l2 4.5 2-4.5h3.25M6.25 9h6.5" />
    </>
  ),
  diagram: (
    <>
      <circle cx="4" cy="4" r="1.75" />
      <circle cx="12" cy="4" r="1.75" />
      <circle cx="8" cy="12" r="1.75" />
      <path d="M5.5 5l4.5 5.5M10.5 5L6.5 10.5" />
    </>
  ),
  callout: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
      <path d="M8 5.75v3M8 10.5v.2" />
    </>
  ),
  copy: (
    <>
      <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" />
      <path d="M3.5 11H2.5a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1H10a1 1 0 0 1 1 1V3.5" />
    </>
  ),
  download: (
    <>
      <path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M2 13.5h12" />
    </>
  ),
  share: (
    <>
      <circle cx="12" cy="4" r="1.75" />
      <circle cx="4" cy="8" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <path d="M5.6 7.2l4.8-2.4M5.6 8.8l4.8 2.4" />
    </>
  ),
  trash: (
    <>
      <path d="M2.5 4.5h11M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M4 4.5l.75 9a1.5 1.5 0 0 0 1.5 1.25h3.5a1.5 1.5 0 0 0 1.5-1.25l.75-9M6.5 7.5v4M9.5 7.5v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </>
  ),
  bookmark: (
    <path d="M3.75 2.75a1 1 0 0 1 1-1h6.5a1 1 0 0 1 1 1v11.5L8 11.5l-4.25 2.75V2.75z" />
  ),
  filter: (
    <path d="M1.75 3h12.5l-5 5.5v4.5l-2.5-1.5v-3z" />
  ),
  maximize: (
    <>
      <path d="M10 2.5h3.5V6M6 13.5H2.5V10M13.5 2.5L9 7M2.5 13.5L7 9" />
    </>
  ),
  minimize: (
    <>
      <path d="M3 7h4V3M13 9H9v4M7 7L2.5 2.5M9 9l4.5 4.5" />
    </>
  ),
  'more-horizontal': (
    <>
      <circle cx="3.5" cy="8" r="1" />
      <circle cx="8" cy="8" r="1" />
      <circle cx="12.5" cy="8" r="1" />
    </>
  ),
  undo: (
    <>
      <path d="M3 6.5h7a3.5 3.5 0 0 1 0 7H8M3 6.5L6 3.5M3 6.5L6 9.5" />
    </>
  ),
  redo: (
    <>
      <path d="M13 6.5H6a3.5 3.5 0 0 0 0 7h2M13 6.5L10 3.5M13 6.5L10 9.5" />
    </>
  ),
  hash: (
    <>
      <path d="M3 6h10M3 10h10M6.5 2.5l-1.5 11M11 2.5l-1.5 11" />
    </>
  ),
  pin: (
    <>
      <path d="M9.5 2.5l4 4-2 2-3-3-3.5 3.5L4 8l1-1 3.5-3.5-3-3 2-2 2 2zM3 13l3.5-3.5" />
    </>
  ),
  zap: <path d="M8.5 1.5L2.5 9h5l-1 5.5L13.5 7h-5l1.5-5.5z" />,
  sort: (
    <>
      <path d="M5 3v10M2.5 5.5L5 3l2.5 2.5M11 13V3M8.5 10.5L11 13l2.5-2.5" />
    </>
  ),
  'chevron-down': <path d="M3.5 6L8 10.5 12.5 6" />,
  'chevron-up': <path d="M3.5 10L8 5.5 12.5 10" />,
  'arrow-left': <path d="M13.5 8H2.5M6.5 4L2.5 8l4 4" />,
  'arrow-up': <path d="M8 13.5V2.5M4 6.5L8 2.5l4 4" />,
  'external-link': (
    <>
      <path d="M11 8.5v4a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1H7.5M9.5 2.5h4v4M6.5 9.5L13.5 2.5" />
    </>
  ),
  'bar-chart': (
    <>
      <path d="M2.25 13.75h11.5" />
      <path d="M4.5 13.5V9.25M8 13.5V4.5M11.5 13.5V7" />
    </>
  ),
  'alert-triangle': (
    <>
      <path d="M8 2.75 1.9 13.25h12.2z" />
      <path d="M8 6.5v3.25M8 11.75h.01" />
    </>
  ),
  'git-branch': (
    <>
      <circle cx="4.5" cy="3.75" r="1.75" />
      <circle cx="4.5" cy="12.25" r="1.75" />
      <circle cx="11.5" cy="7.25" r="1.75" />
      <path d="M4.5 5.5v5M6.25 7.25h2.1a1.4 1.4 0 0 0 1.35-1" />
    </>
  ),
  layers: (
    <>
      <path d="M8 1.9 1.9 5.25 8 8.6l6.1-3.35z" />
      <path d="M2.4 8.35 8 11.4l5.6-3.05M2.4 11.1 8 14.15l5.6-3.05" />
    </>
  )
} satisfies Record<string, React.JSX.Element>

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  size = 16,
  className
}: {
  name: IconName
  size?: number
  className?: string
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}

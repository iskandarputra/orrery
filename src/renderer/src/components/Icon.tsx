/**
 * Minimal 16px stroke icon set (1.5px, round caps) — consistent weight across
 * the whole UI. Paths drawn on a 16×16 grid.
 */
const PATHS: Record<string, React.JSX.Element> = {
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
  )
}

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

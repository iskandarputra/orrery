/**
 * The orrery mark — a rounded-square "z" matching build/icon.png. Rendered as
 * inline SVG so it stays crisp at any size and can sit anywhere in the UI.
 */
export function Logo({ size = 40 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="Orrery" role="img">
      <defs>
        <linearGradient
          id="or-logo-grad"
          x1="0"
          y1="0"
          x2="48"
          y2="48"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#4f6ef2" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect x="3.5" y="3.5" width="41" height="41" rx="11" fill="url(#or-logo-grad)" />
      <g stroke="#fff" strokeWidth="6.2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="15.5" y1="17.4" x2="32.5" y2="17.4" />
        <line x1="15.5" y1="30.6" x2="32.5" y2="30.6" />
        <line x1="31.5" y1="18.2" x2="16.5" y2="29.8" />
      </g>
    </svg>
  )
}

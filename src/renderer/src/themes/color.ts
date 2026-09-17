/** Tiny color math over #rrggbb hex — enough to derive a full token set per theme. */

function parse(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16)
  ]
}

const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)))

/** Blend a toward b by t (0..1). */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parse(a)
  const [br, bg, bb] = parse(b)
  const c = (x: number, y: number): string =>
    clamp(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0')
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const channel = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = parse(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio between two colours, 1..21. */
export function contrast(a: string, b: string): number {
  const l1 = luminance(a)
  const l2 = luminance(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/**
 * How different two colours look: CIE76 ΔE, the distance between them in Lab.
 *
 * Contrast is the wrong measure for a tint. It only compares lightness, so a
 * red band on a dark background, which barely lightens it, scores 1.07:1 while
 * being plainly red. Lab counts the hue as well. Under about 2 takes close
 * attention to see, up to about 10 shows at a glance, and past that the two
 * read as different colours.
 */
export function difference(a: string, b: string): number {
  const lab = (hex: string): [number, number, number] => {
    const [r, g, b] = parse(hex).map((v) => {
      const c = v / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    // sRGB to XYZ under D65, each axis relative to the white point.
    const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
    const y = r * 0.2126 + g * 0.7152 + b * 0.0722
    const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
    const f = (t: number): number =>
      t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
  }
  const [l1, a1, b1] = lab(a)
  const [l2, a2, b2] = lab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/**
 * Fade `fg` toward `bg` as far as it can go while still meeting `target`
 * contrast against it.
 *
 * A fixed blend cannot do this job: the themes differ enormously in how much
 * contrast their own foreground and background start with, so one ratio that
 * looks softly muted on a high-contrast palette is illegible on Solarized
 * Light. Asking for a contrast instead of a blend gives every theme the
 * softest ink it can afford and no softer.
 */
export function fade(
  fg: string,
  bg: string,
  preferred: number,
  target: number,
  against: string[] = [bg]
): string {
  const ok = (t: number): boolean =>
    against.every((surface) => contrast(mix(fg, bg, t), surface) >= target)
  if (ok(preferred)) return mix(fg, bg, preferred)
  // Contrast falls monotonically as the ink moves toward the background.
  let lo = 0
  let hi = preferred
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (ok(mid)) lo = mid
    else hi = mid
  }
  return mix(fg, bg, lo)
}

/**
 * Pull `color` toward `toward` until it is legible on every listed surface.
 *
 * The inverse of `fade`, for a colour that carries meaning rather than
 * emphasis: a brand accent is chosen to look right as a fill, and using it
 * unchanged as small text leaves it short of AA on the lighter palettes.
 */
export function reinforce(
  color: string,
  toward: string,
  surfaces: string[],
  target: number
): string {
  const ok = (t: number): boolean =>
    surfaces.every((surface) => contrast(mix(color, toward, t), surface) >= target)
  if (ok(0)) return color
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (ok(mid)) hi = mid
    else lo = mid
  }
  return mix(color, toward, hi)
}

/**
 * A fill and an ink for it that are legible together.
 *
 * A filled accent chip is the one place a brand colour has to carry text on
 * top of itself, and `#fff` was simply assumed: on the lighter accents that
 * left white-on-accent labels at under 3:1. The ink is whichever of the two
 * extremes contrasts better, and the fill is then deepened away from it until
 * the pair clears `target` — so the chip stays recognisably the accent, and
 * only moves as far as it has to.
 */
export function fillFor(
  accent: string,
  light: string,
  dark: string,
  target: number
): { fill: string; ink: string } {
  const ink = contrast(accent, light) >= contrast(accent, dark) ? light : dark
  const away = ink === light ? dark : light
  return { fill: reinforce(accent, away, [ink], target), ink }
}

/** rgba() string from hex + alpha. */
export function alpha(hex: string, a: number): string {
  const [r, g, b] = parse(hex)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

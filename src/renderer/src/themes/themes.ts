import { alpha, fade, fillFor, mix, reinforce } from './color'

/**
 * A theme is a small hand-picked palette; the full CSS token set is derived
 * so every theme stays coherent (borders, hovers, selections computed from
 * the same few colors). Overrides allow fine-tuning any derived token.
 */
export interface ThemeSpec {
  id: string
  name: string
  appearance: 'light' | 'dark'
  /** Editor background. */
  bg: string
  /** Chrome background (sidebar, panels, tabs). */
  panel: string
  fg: string
  accent: string
  code: {
    keyword: string
    string: string
    comment: string
    number: string
    function: string
    type: string
    property: string
  }
  overrides?: Partial<Record<TokenName, string>>
}

export type TokenName =
  | 'bg'
  | 'editor-bg'
  | 'panel-bg'
  | 'input-bg'
  | 'hover-bg'
  | 'active-bg'
  | 'fg'
  | 'fg-muted'
  | 'fg-faint'
  | 'border'
  | 'accent'
  | 'accent-soft'
  | 'selection-bg'
  | 'search-match'
  | 'search-match-selected'
  | 'code-bg'
  | 'inline-code-bg'
  | 'hl-bg'
  | 'accent-text'
  | 'accent-fill'
  | 'accent-ink'
  | 'active-line'
  | 'code-keyword'
  | 'code-string'
  | 'code-comment'
  | 'code-number'
  | 'code-function'
  | 'code-type'
  | 'code-property'
  | 'viz-1'
  | 'viz-2'
  | 'viz-3'
  | 'viz-4'
  | 'viz-5'
  | 'viz-6'
  | 'viz-7'
  | 'viz-8'

/**
 * Categorical palette for analysis colour — graph clusters, chart series.
 * A fixed, validated order (blue, orange, aqua, yellow, magenta, green, violet,
 * red), stepped separately for light and dark surfaces rather than flipped.
 * Deliberately independent of the theme accent: these encode identity, and
 * shuffling them per theme would make the same cluster change colour.
 */
const VIZ_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const VIZ_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']

const d = (spec: Omit<ThemeSpec, 'appearance'>): ThemeSpec => ({ ...spec, appearance: 'dark' })
const l = (spec: Omit<ThemeSpec, 'appearance'>): ThemeSpec => ({ ...spec, appearance: 'light' })

// prettier-ignore
export const THEMES: ThemeSpec[] = [
  // ---------- dark ----------
  d({ id: 'zinc-dark', name: 'Zinc', bg: '#1e2126', panel: '#22252b', fg: '#d6dae1', accent: '#7c93ff',
    code: { keyword: '#ff7b72', string: '#a5d6ff', comment: '#8b949e', number: '#79c0ff', function: '#d2a8ff', type: '#ffa657', property: '#7ee787' } }),
  d({ id: 'midnight', name: 'Midnight', bg: '#0f1117', panel: '#12141c', fg: '#c8d0e0', accent: '#5b8def',
    code: { keyword: '#f97583', string: '#9ecbff', comment: '#6a737d', number: '#79b8ff', function: '#b392f0', type: '#ffab70', property: '#85e89d' } }),
  d({ id: 'dracula', name: 'Dracula', bg: '#282a36', panel: '#21222c', fg: '#f8f8f2', accent: '#bd93f9',
    code: { keyword: '#ff79c6', string: '#f1fa8c', comment: '#6272a4', number: '#bd93f9', function: '#50fa7b', type: '#8be9fd', property: '#66d9ef' } }),
  d({ id: 'nord-dark', name: 'Nord', bg: '#2e3440', panel: '#292e39', fg: '#d8dee9', accent: '#88c0d0',
    code: { keyword: '#81a1c1', string: '#a3be8c', comment: '#616e88', number: '#b48ead', function: '#88c0d0', type: '#8fbcbb', property: '#d8dee9' } }),
  d({ id: 'one-dark', name: 'One Dark', bg: '#282c34', panel: '#21252b', fg: '#abb2bf', accent: '#61afef',
    code: { keyword: '#c678dd', string: '#98c379', comment: '#5c6370', number: '#d19a66', function: '#61afef', type: '#e5c07b', property: '#e06c75' } }),
  d({ id: 'tokyo-night', name: 'Tokyo Night', bg: '#1a1b26', panel: '#16161e', fg: '#a9b1d6', accent: '#7aa2f7',
    code: { keyword: '#bb9af7', string: '#9ece6a', comment: '#565f89', number: '#ff9e64', function: '#7aa2f7', type: '#2ac3de', property: '#73daca' } }),
  d({ id: 'catppuccin-mocha', name: 'Catppuccin Mocha', bg: '#1e1e2e', panel: '#181825', fg: '#cdd6f4', accent: '#cba6f7',
    code: { keyword: '#cba6f7', string: '#a6e3a1', comment: '#6c7086', number: '#fab387', function: '#89b4fa', type: '#f9e2af', property: '#f38ba8' } }),
  d({ id: 'gruvbox-dark', name: 'Gruvbox Dark', bg: '#282828', panel: '#232323', fg: '#ebdbb2', accent: '#fabd2f',
    code: { keyword: '#fb4934', string: '#b8bb26', comment: '#928374', number: '#d3869b', function: '#fabd2f', type: '#8ec07c', property: '#83a598' } }),
  d({ id: 'solarized-dark', name: 'Solarized Dark', bg: '#002b36', panel: '#00252e', fg: '#93a1a1', accent: '#268bd2',
    code: { keyword: '#859900', string: '#2aa198', comment: '#586e75', number: '#d33682', function: '#268bd2', type: '#b58900', property: '#cb4b16' } }),
  d({ id: 'monokai-pro', name: 'Monokai Pro', bg: '#2d2a2e', panel: '#252226', fg: '#fcfcfa', accent: '#ffd866',
    code: { keyword: '#ff6188', string: '#ffd866', comment: '#727072', number: '#ab9df2', function: '#a9dc76', type: '#78dce8', property: '#fc9867' } }),
  d({ id: 'ayu-mirage', name: 'Ayu Mirage', bg: '#242936', panel: '#1f2430', fg: '#cccac2', accent: '#ffcc66',
    code: { keyword: '#ffa759', string: '#bae67e', comment: '#5c6773', number: '#d4bfff', function: '#ffd580', type: '#73d0ff', property: '#f28779' } }),
  d({ id: 'rose-pine', name: 'Rosé Pine', bg: '#191724', panel: '#1f1d2e', fg: '#e0def4', accent: '#c4a7e7',
    code: { keyword: '#31748f', string: '#f6c177', comment: '#6e6a86', number: '#ebbcba', function: '#c4a7e7', type: '#9ccfd8', property: '#eb6f92' } }),
  d({ id: 'everforest-dark', name: 'Everforest Dark', bg: '#2d353b', panel: '#272e33', fg: '#d3c6aa', accent: '#a7c080',
    code: { keyword: '#e67e80', string: '#a7c080', comment: '#859289', number: '#d699b6', function: '#83c092', type: '#dbbc7f', property: '#7fbbb3' } }),
  d({ id: 'kanagawa', name: 'Kanagawa', bg: '#1f1f28', panel: '#16161d', fg: '#dcd7ba', accent: '#7e9cd8',
    code: { keyword: '#957fb8', string: '#98bb6c', comment: '#727169', number: '#d27e99', function: '#7e9cd8', type: '#7aa89f', property: '#ffa066' } }),
  d({ id: 'palenight', name: 'Palenight', bg: '#292d3e', panel: '#242837', fg: '#a6accd', accent: '#82aaff',
    code: { keyword: '#c792ea', string: '#c3e88d', comment: '#676e95', number: '#f78c6c', function: '#82aaff', type: '#ffcb6b', property: '#f07178' } }),
  d({ id: 'deep-ocean', name: 'Deep Ocean', bg: '#0a0e14', panel: '#0d1117', fg: '#b3b1ad', accent: '#39bae6',
    code: { keyword: '#ff8f40', string: '#c2d94c', comment: '#626a73', number: '#e6b673', function: '#ffb454', type: '#59c2ff', property: '#f07178' } }),
  d({ id: 'espresso', name: 'Espresso', bg: '#2a211c', panel: '#241c18', fg: '#cccccc', accent: '#e5a34f',
    code: { keyword: '#cd9077', string: '#b3c98c', comment: '#8a7b72', number: '#cd9077', function: '#e5a34f', type: '#9fc2c7', property: '#de8e6f' } }),
  // ---------- light ----------
  l({ id: 'zinc-light', name: 'Zinc Light', bg: '#ffffff', panel: '#f3f3f5', fg: '#24292f', accent: '#4f6ef2',
    code: { keyword: '#cf222e', string: '#0a3069', comment: '#6e7781', number: '#0550ae', function: '#8250df', type: '#953800', property: '#116329' } }),
  l({ id: 'github-light', name: 'GitHub Light', bg: '#ffffff', panel: '#f6f8fa', fg: '#1f2328', accent: '#0969da',
    code: { keyword: '#cf222e', string: '#0a3069', comment: '#59636e', number: '#0550ae', function: '#8250df', type: '#953800', property: '#116329' } }),
  // fg is Solarized base01 (#586e75) nudged 3% toward base02: on base2 panels
  // the published value gives 4.39:1, just under AA, which put essentially all
  // of this theme's chrome text below the line. Two RGB units, inside the
  // palette's own ramp, buys 4.52:1.
  l({ id: 'solarized-light', name: 'Solarized Light', bg: '#fdf6e3', panel: '#eee8d5', fg: '#566c73', accent: '#268bd2',
    code: { keyword: '#859900', string: '#2aa198', comment: '#93a1a1', number: '#d33682', function: '#268bd2', type: '#b58900', property: '#cb4b16' } }),
  l({ id: 'nord-light', name: 'Nord Light', bg: '#eceff4', panel: '#e5e9f0', fg: '#2e3440', accent: '#5e81ac',
    code: { keyword: '#5e81ac', string: '#a3be8c', comment: '#9aa4b5', number: '#b48ead', function: '#88c0d0', type: '#8fbcbb', property: '#d08770' } }),
  l({ id: 'gruvbox-light', name: 'Gruvbox Light', bg: '#fbf1c7', panel: '#f2e5bc', fg: '#3c3836', accent: '#d79921',
    code: { keyword: '#9d0006', string: '#79740e', comment: '#928374', number: '#8f3f71', function: '#b57614', type: '#427b58', property: '#076678' } }),
  l({ id: 'catppuccin-latte', name: 'Catppuccin Latte', bg: '#eff1f5', panel: '#e6e9ef', fg: '#4c4f69', accent: '#8839ef',
    code: { keyword: '#8839ef', string: '#40a02b', comment: '#9ca0b0', number: '#fe640b', function: '#1e66f5', type: '#df8e1d', property: '#d20f39' } }),
  l({ id: 'rose-pine-dawn', name: 'Rosé Pine Dawn', bg: '#faf4ed', panel: '#fffaf3', fg: '#575279', accent: '#907aa9',
    code: { keyword: '#286983', string: '#ea9d34', comment: '#9893a5', number: '#d7827e', function: '#907aa9', type: '#56949f', property: '#b4637a' } }),
  l({ id: 'everforest-light', name: 'Everforest Light', bg: '#fdf6e3', panel: '#f4f0d9', fg: '#5c6a72', accent: '#8da101',
    code: { keyword: '#f85552', string: '#8da101', comment: '#a6b0a0', number: '#df69ba', function: '#35a77c', type: '#dfa000', property: '#3a94c5' } }),
  l({ id: 'ayu-light', name: 'Ayu Light', bg: '#fcfcfc', panel: '#f3f4f5', fg: '#5c6166', accent: '#ffaa33',
    code: { keyword: '#fa8d3e', string: '#86b300', comment: '#abb0b6', number: '#a37acc', function: '#f2ae49', type: '#399ee6', property: '#f07171' } }),
  l({ id: 'paper', name: 'Paper', bg: '#f7f7f2', panel: '#efefe8', fg: '#33322e', accent: '#5f8b4c',
    code: { keyword: '#a3455e', string: '#5f8b4c', comment: '#9a9890', number: '#8a6ca8', function: '#4a7ba6', type: '#a8752f', property: '#3d7a70' } }),
  l({ id: 'parchment', name: 'Parchment', bg: '#f4ecd8', panel: '#ece2c8', fg: '#4a4234', accent: '#a0522d',
    code: { keyword: '#8f3f2e', string: '#6a7a3a', comment: '#a39877', number: '#7a5a9e', function: '#a0522d', type: '#8a6d2f', property: '#3f7268' } })
]

export type ResolvedTheme = Record<TokenName, string> & { appearance: 'light' | 'dark' }

/** Derive the full token set from a spec's few base colors. */
export function resolveTheme(spec: ThemeSpec): ResolvedTheme {
  const { bg, panel, fg, accent } = spec
  const dark = spec.appearance === 'dark'
  const tokens: Record<TokenName, string> = {
    bg: panel,
    'editor-bg': bg,
    'panel-bg': panel,
    'input-bg': bg,
    'hover-bg': alpha(fg, dark ? 0.07 : 0.06),
    'active-bg': alpha(fg, dark ? 0.12 : 0.1),
    fg,
    // Softened toward the background as far as each palette can afford, rather
    // than by a fixed blend. Both are text tokens — `faint` alone dresses some
    // fifty pieces of UI copy — so both hold WCAG AA for body text. A fixed
    // blend put 13 of the 29 themes under AA on `muted` and 28 of 29 under it
    // on `faint`, several below even 2:1.
    //
    // Where a palette has the headroom the two stay clearly apart; where it
    // does not they converge, which is the right way for a deliberately
    // low-contrast theme to lose a level of hierarchy rather than legibility.
    'fg-muted': fade(fg, bg, 0.32, 4.5, [bg, panel]),
    'fg-faint': fade(fg, bg, 0.55, 4.5, [bg, panel]),
    border: mix(fg, panel, dark ? 0.86 : 0.82),
    accent,
    // The accent as *text*. Accents are picked to look right as a fill; several
    // fall short of AA when they dress a label instead.
    'accent-text': reinforce(accent, fg, [bg, panel], 4.5),
    // A filled accent chip carries text on top of the brand colour. Both halves
    // are derived together so the pair is legible whatever the accent is.
    'accent-fill': fillFor(accent, '#ffffff', '#101014', 4.5).fill,
    'accent-ink': fillFor(accent, '#ffffff', '#101014', 4.5).ink,
    'accent-soft': alpha(accent, dark ? 0.16 : 0.12),
    'selection-bg': alpha(accent, dark ? 0.3 : 0.22),
    'search-match': alpha(dark ? '#d2a01e' : '#ffc83c', dark ? 0.4 : 0.45),
    'search-match-selected': alpha(dark ? '#f0a014' : '#ff9628', dark ? 0.6 : 0.65),
    'code-bg': mix(bg, fg, dark ? 0.045 : 0.04),
    'inline-code-bg': alpha(fg, dark ? 0.12 : 0.09),
    // Marker-pen highlight: warm gold tuned per appearance so text stays
    // readable on every palette; themes can override for a tinted marker.
    'hl-bg': dark ? 'rgba(255, 196, 10, 0.26)' : 'rgba(255, 213, 20, 0.45)',
    'active-line': alpha(fg, dark ? 0.045 : 0.035),
    'code-keyword': spec.code.keyword,
    'code-string': spec.code.string,
    'code-comment': spec.code.comment,
    'code-number': spec.code.number,
    'code-function': spec.code.function,
    'code-type': spec.code.type,
    'code-property': spec.code.property,
    'viz-1': (dark ? VIZ_DARK : VIZ_LIGHT)[0]!,
    'viz-2': (dark ? VIZ_DARK : VIZ_LIGHT)[1]!,
    'viz-3': (dark ? VIZ_DARK : VIZ_LIGHT)[2]!,
    'viz-4': (dark ? VIZ_DARK : VIZ_LIGHT)[3]!,
    'viz-5': (dark ? VIZ_DARK : VIZ_LIGHT)[4]!,
    'viz-6': (dark ? VIZ_DARK : VIZ_LIGHT)[5]!,
    'viz-7': (dark ? VIZ_DARK : VIZ_LIGHT)[6]!,
    'viz-8': (dark ? VIZ_DARK : VIZ_LIGHT)[7]!,
    ...spec.overrides
  }
  return { ...tokens, appearance: spec.appearance }
}

export function getTheme(id: string): ThemeSpec {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!
}

const CODE_TOKENS = [
  'code-keyword',
  'code-string',
  'code-comment',
  'code-number',
  'code-function',
  'code-type',
  'code-property'
] as const

/**
 * The theme's code colours, pulled toward its foreground until each is legible
 * on the code surface.
 *
 * These seven are the one part of a theme taken verbatim from upstream, and
 * upstream is where the contrast problem lives: 26 of the 28 palettes ship at
 * least one token under AA and seven of them ship all seven, the worst at
 * 1.63:1. Correcting them by default would mean Dracula no longer looks like
 * Dracula, so this is what the high-contrast-code setting turns on, and the
 * palettes stay as their authors wrote them until someone asks otherwise.
 */
export function highContrastCodeTokens(spec: ThemeSpec): Record<string, string> {
  const resolved = resolveTheme(spec)
  const out: Record<string, string> = {}
  for (const token of CODE_TOKENS) {
    out[token] = reinforce(resolved[token], resolved.fg, [resolved['code-bg']], 4.5)
  }
  return out
}

/** One stylesheet with a `[data-theme='<id>']` block per theme. */
/**
 * Added / modified / removed, deepened until they can be read.
 *
 * The hues are fixed on purpose — green-is-added is a convention read from
 * outside the app, and rehueing it per palette would make each theme mean
 * something different. But a hue chosen for a dark background sits at 2.3:1 on
 * a light one, and a status letter nobody can read conveys nothing at all. So
 * the hue is kept and only its depth moves, and only as far as AA requires.
 */
function diffTokens(spec: ThemeSpec, resolved: ResolvedTheme): Record<string, string> {
  const surfaces = [resolved.bg, resolved['panel-bg'], resolved['editor-bg']]
  const toward = spec.appearance === 'light' ? '#000000' : '#ffffff'
  const deepen = (hue: string): string => reinforce(hue, toward, surfaces, 4.5)
  return {
    'diff-add': deepen('#3fb950'),
    'diff-del': deepen('#f85149'),
    'diff-mod': deepen('#d29922')
  }
}

export function generateThemeCss(): string {
  return THEMES.map((spec) => {
    const resolved = resolveTheme(spec)
    const vars = (Object.keys(resolved) as (keyof ResolvedTheme)[])
      .filter((k) => k !== 'appearance')
      .map((k) => `  --or-${k}: ${resolved[k as TokenName]};`)
      .join('\n')
    const diff = Object.entries(diffTokens(spec, resolved))
      .map(([k, v]) => `  --or-${k}: ${v};`)
      .join('\n')
    const base = `:root[data-theme='${spec.id}'] {\n  color-scheme: ${spec.appearance};\n${vars}\n${diff}\n}`

    const hc = Object.entries(highContrastCodeTokens(spec))
      .map(([k, v]) => `  --or-${k}: ${v};`)
      .join('\n')
    return `${base}\n\n:root[data-theme='${spec.id}'][data-hc-code='on'] {\n${hc}\n}`
  }).join('\n\n')
}

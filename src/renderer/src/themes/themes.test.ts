import { describe, expect, it } from 'vitest'
import { contrast, difference, mix } from './color'
import {
  DIFF_TINT_MAX,
  DIFF_TINT_MIN,
  DIFF_TINT_TARGET,
  DIFF_TINT_TEXT_FLOOR,
  diffTokens,
  generateThemeCss,
  getTheme,
  highContrastCodeTokens,
  resolveTheme,
  THEMES
} from './themes'

const HEX = /^#[0-9a-f]{6}$/i

describe('themes', () => {
  it('ships at least 25 themes with both appearances represented', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(25)
    expect(THEMES.some((t) => t.appearance === 'dark')).toBe(true)
    expect(THEMES.some((t) => t.appearance === 'light')).toBe(true)
  })

  it('has unique ids and valid base colors', () => {
    const ids = new Set(THEMES.map((t) => t.id))
    expect(ids.size).toBe(THEMES.length)
    for (const t of THEMES) {
      expect(t.bg, t.id).toMatch(HEX)
      expect(t.panel, t.id).toMatch(HEX)
      expect(t.fg, t.id).toMatch(HEX)
      expect(t.accent, t.id).toMatch(HEX)
      for (const c of Object.values(t.code)) expect(c, t.id).toMatch(HEX)
    }
  })

  it('resolves every theme to a complete token set', () => {
    for (const t of THEMES) {
      const resolved = resolveTheme(t)
      expect(resolved['editor-bg'], t.id).toBeTruthy()
      expect(resolved.border, t.id).toMatch(HEX)
      expect(resolved['fg-muted'], t.id).toMatch(HEX)
      expect(resolved['selection-bg'], t.id).toContain('rgba')
      expect(resolved['hl-bg'], t.id).toContain('rgba')
      expect(resolved['active-line'], t.id).toContain('rgba')
    }
  })

  it('keeps muted and faint ink legible in every theme', () => {
    for (const t of THEMES) {
      const resolved = resolveTheme(t)
      for (const surface of [resolved['editor-bg'], resolved['panel-bg']]) {
        // Both dress real UI text — the status bar, breadcrumbs, view-mode
        // labels, panel copy — so both hold AA for body text. Neither can beat
        // the theme's own foreground, which on a deliberately low-contrast
        // palette like Solarized Light is itself just under AA.
        const ceiling = contrast(resolved.fg, surface)
        expect(contrast(resolved['fg-muted'], surface), `${t.id} muted`).toBeGreaterThanOrEqual(
          Math.min(4.5, ceiling) - 0.01
        )
        expect(contrast(resolved['fg-faint'], surface), `${t.id} faint`).toBeGreaterThanOrEqual(
          Math.min(4.5, ceiling) - 0.01
        )
      }
    }
  })

  it('high-contrast code lifts every token to AA in every theme', () => {
    for (const spec of THEMES) {
      const surface = resolveTheme(spec)['code-bg']
      const tokens = highContrastCodeTokens(spec)
      expect(Object.keys(tokens)).toHaveLength(7)
      for (const [name, colour] of Object.entries(tokens)) {
        expect(contrast(colour, surface), `${spec.id} ${name}`).toBeGreaterThanOrEqual(4.49)
      }
    }
  })

  it('leaves the palettes as published when high contrast is off', () => {
    // The point of the setting is that it is a choice: the default has to be
    // the theme's own colours, verbatim, however they measure.
    for (const spec of THEMES) {
      const resolved = resolveTheme(spec)
      expect(resolved['code-keyword'], spec.id).toBe(spec.code.keyword)
      expect(resolved['code-comment'], spec.id).toBe(spec.code.comment)
    }
  })

  it('gives every accent chip an ink that reads on its fill', () => {
    for (const t of THEMES) {
      const resolved = resolveTheme(t)
      // A filled chip is the one place the brand colour carries text itself.
      expect(
        contrast(resolved['accent-ink'], resolved['accent-fill']),
        `${t.id} accent chip`
      ).toBeGreaterThanOrEqual(4.49)
    }
  })

  it('generates a CSS block per theme', () => {
    const css = generateThemeCss()
    for (const t of THEMES) {
      expect(css).toContain(`[data-theme='${t.id}']`)
    }
    expect(css).toContain('--or-editor-bg:')
  })

  it('falls back to the first theme for unknown ids', () => {
    expect(getTheme('nope').id).toBe(THEMES[0]!.id)
    expect(getTheme('dracula').id).toBe('dracula')
  })
})

describe('the band behind a changed line in a diff', () => {
  /** Each theme's two bands, with the strength and the colour they paint. */
  const bands = THEMES.flatMap((spec) => {
    const resolved = resolveTheme(spec)
    const tokens = diffTokens(spec, resolved)
    return (['add', 'del'] as const).map((side) => {
      const [, r, g, b, a] = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(
        tokens[`diff-${side}-tint`]!
      )!
      const hue = `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`
      const strength = Number(a)
      const ground = resolved['editor-bg']
      const paint = (s: number): string => mix(ground, hue, s)
      return { id: `${spec.id} ${side}`, spec, resolved, hue, strength, ground, paint }
    })
  })

  it('is drawn in the diff colour itself', () => {
    for (const band of bands) {
      const side = band.id.endsWith('add') ? 'diff-add' : 'diff-del'
      expect(band.hue, band.id).toBe(diffTokens(band.spec, band.resolved)[side])
    }
  })

  it('is never weaker than it was, unless the text could not afford it', () => {
    for (const band of bands) {
      expect(band.strength, band.id).toBeLessThanOrEqual(DIFF_TINT_MAX + 1e-9)
      if (band.strength >= DIFF_TINT_MIN - 1e-9) continue
      // Under the old strength only where the old strength cost the text AA.
      expect(contrast(band.resolved.fg, band.paint(DIFF_TINT_MIN)), band.id).toBeLessThan(
        DIFF_TINT_TEXT_FLOOR
      )
      expect(band.strength, band.id).toBeGreaterThan(0)
    }
  })

  it('glows in a dark theme and not in a light one', () => {
    for (const spec of THEMES) {
      const tokens = diffTokens(spec, resolveTheme(spec))
      for (const side of ['add', 'del'] as const) {
        const glow = tokens[`diff-${side}-glow`]!
        if (spec.appearance === 'dark') expect(glow, spec.id).toMatch(/^0 0 \d+px rgba\(/)
        else expect(glow, spec.id).toBe('none')
      }
    }
  })

  it('keeps the neon itself wherever it already reads', () => {
    // Tokyo Night's background takes the lime as it is; only a light theme, or
    // a dark one too pale for the red, moves the hue.
    const tokens = diffTokens(getTheme('tokyo-night'), resolveTheme(getTheme('tokyo-night')))
    expect(tokens['diff-add']).toBe('#39ff14')
  })

  it('is lighter than the editor in a dark theme and darker in a light one', () => {
    for (const band of bands) {
      const painted = band.paint(band.strength)
      const white = '#ffffff'
      const lighter = contrast(painted, white) < contrast(band.ground, white)
      expect(lighter, band.id).toBe(band.spec.appearance === 'dark')
    }
  })

  it('keeps the editor text at AA on top of it in every theme', () => {
    for (const band of bands) {
      expect(contrast(band.resolved.fg, band.paint(band.strength)), band.id).toBeGreaterThanOrEqual(
        4.5
      )
    }
  })

  it('stands out clearly, unless the text or the ceiling stopped it first', () => {
    const shortOf: string[] = []
    for (const band of bands) {
      if (difference(band.paint(band.strength), band.ground) >= DIFF_TINT_TARGET) continue
      // Short of the target is allowed for exactly two reasons.
      const atCeiling = band.strength >= DIFF_TINT_MAX - 1e-9
      const textWouldFail =
        contrast(band.resolved.fg, band.paint(band.strength + 0.01)) < DIFF_TINT_TEXT_FLOOR
      if (!atCeiling && !textWouldFail) shortOf.push(band.id)
    }
    expect(shortOf).toEqual([])
  })

  it('reaches the target in the light theme where it was faintest', () => {
    // GitHub Light's bands were ΔE 5.7 at the old fixed 8% and hues.
    for (const band of bands.filter((b) => b.spec.id === 'github-light')) {
      expect(difference(band.paint(band.strength), band.ground), band.id).toBeGreaterThanOrEqual(
        DIFF_TINT_TARGET
      )
    }
  })

  it('stops short in the palettes whose text cannot afford it', () => {
    // Their text is 4.6:1 over the old band, so the floor stops the climb early.
    for (const band of bands.filter((b) => /^(solarized|everforest)-light /.test(b.id))) {
      expect(difference(band.paint(band.strength), band.ground), band.id).toBeLessThan(
        DIFF_TINT_TARGET
      )
      expect(contrast(band.resolved.fg, band.paint(band.strength)), band.id).toBeGreaterThanOrEqual(
        4.5
      )
    }
  })
})

describe('difference', () => {
  it('is nothing between a colour and itself, and most between black and white', () => {
    expect(difference('#3fb950', '#3fb950')).toBe(0)
    expect(difference('#000000', '#ffffff')).toBeCloseTo(100, 0)
  })

  it('sees a hue that contrast does not', () => {
    // Nearly the same lightness, plainly different colours.
    const red = '#d0443c'
    const grey = '#8a8a8a'
    expect(contrast(red, grey)).toBeLessThan(1.4)
    expect(difference(red, grey)).toBeGreaterThan(40)
  })
})

import { describe, expect, it } from 'vitest'
import { contrast } from './color'
import {
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

  it('generates a CSS block per theme', () => {
    const css = generateThemeCss()
    for (const t of THEMES) {
      expect(css).toContain(`[data-theme='${t.id}']`)
    }
    expect(css).toContain('--zy-editor-bg:')
  })

  it('falls back to the first theme for unknown ids', () => {
    expect(getTheme('nope').id).toBe(THEMES[0]!.id)
    expect(getTheme('dracula').id).toBe('dracula')
  })
})

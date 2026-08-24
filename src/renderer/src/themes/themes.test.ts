import { describe, expect, it } from 'vitest'
import { generateThemeCss, getTheme, resolveTheme, THEMES } from './themes'

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

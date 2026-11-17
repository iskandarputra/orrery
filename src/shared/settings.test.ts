import { describe, expect, it } from 'vitest'
import { defaultSettings, settingsSchema } from './settings'

describe('settings schema', () => {
  it('produces complete defaults from an empty object', () => {
    expect(defaultSettings.theme).toBe('system')
    expect(defaultSettings.editor.fontSize).toBe(16)
    expect(defaultSettings.sidebar.visible).toBe(true)
    expect(defaultSettings.recentFiles).toEqual([])
  })

  it('accepts a valid partial and fills the rest', () => {
    const parsed = settingsSchema.parse({ theme: 'dark', editor: { fontSize: 20 } })
    expect(parsed.theme).toBe('dark')
    expect(parsed.editor.fontSize).toBe(20)
    expect(parsed.editor.wordWrap).toBe(true)
  })

  it('rejects out-of-range and malformed values', () => {
    expect(settingsSchema.safeParse({ theme: 'neon' }).success).toBe(false)
    expect(settingsSchema.safeParse({ editor: { fontSize: 500 } }).success).toBe(false)
    expect(settingsSchema.safeParse({ recentFiles: [42] }).success).toBe(false)
  })

  it('starts with the right-hand panel closed', () => {
    // A first run has an empty vault, so an outline open by default was three
    // hundred pixels of nothing.
    expect(defaultSettings.rightPanel.panel).toBeNull()
  })

  it('leaves a panel somebody already chose alone', () => {
    // The store writes every field, so an existing install has this on disk
    // and does not get the new default handed to it on an upgrade.
    expect(settingsSchema.parse({ rightPanel: { panel: 'outline' } }).rightPanel.panel).toBe(
      'outline'
    )
  })

  it('degrades a panel name that no longer exists to no panel', () => {
    // 'git' was one of these until source control moved to the left sidebar.
    expect(settingsSchema.parse({ rightPanel: { panel: 'git' } }).rightPanel.panel).toBeNull()
  })
})

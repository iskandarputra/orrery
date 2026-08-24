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
})

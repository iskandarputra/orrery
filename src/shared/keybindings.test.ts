import { describe, expect, it } from 'vitest'
import { DEFAULT_SHORTCUTS, shortcutFor } from './keybindings'

describe('shortcutFor', () => {
  it('gives the shipped key when nothing is overridden', () => {
    expect(shortcutFor('app.commandPalette')).toBe('CmdOrCtrl+Shift+P')
  })

  it("prefers the user's own key", () => {
    expect(shortcutFor('app.commandPalette', { 'app.commandPalette': 'CmdOrCtrl+K' })).toBe(
      'CmdOrCtrl+K'
    )
  })

  it('falls back to the default when the override is blank', () => {
    expect(shortcutFor('file.save', { 'file.save': '' })).toBe('CmdOrCtrl+S')
  })

  it('has nothing for a command with no key', () => {
    expect(shortcutFor('format.unwrapParagraphs')).toBeUndefined()
  })
})

describe('DEFAULT_SHORTCUTS', () => {
  it('gives no two commands the same key', () => {
    // Two menu items with one accelerator: Electron runs one of them, and which
    // one is not something a person pressing the key can tell.
    const owners = new Map<string, string>()
    for (const [id, key] of Object.entries(DEFAULT_SHORTCUTS)) {
      const normal = key.toLowerCase()
      expect(owners.get(normal), `${id} and ${owners.get(normal)} share ${key}`).toBeUndefined()
      owners.set(normal, id)
    }
  })

  it('keeps Ctrl+B and Ctrl+I for bold and italic, as writing tools do', () => {
    expect(DEFAULT_SHORTCUTS['format.bold']).toBe('CmdOrCtrl+B')
    expect(DEFAULT_SHORTCUTS['format.italic']).toBe('CmdOrCtrl+I')
  })
})

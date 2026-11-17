import { describe, expect, it } from 'vitest'
import { shortcutLabel } from './shortcut-label'

describe('shortcutLabel', () => {
  it('writes the modifier a Windows or Linux menu writes', () => {
    expect(shortcutLabel('CmdOrCtrl+Shift+P', false)).toBe('Ctrl+Shift+P')
    expect(shortcutLabel('CmdOrCtrl+Alt+N', false)).toBe('Ctrl+Alt+N')
  })

  it('writes the symbols a Mac menu bar shows, with nothing between them', () => {
    expect(shortcutLabel('CmdOrCtrl+Shift+P', true)).toBe('⌘⇧P')
    expect(shortcutLabel('CmdOrCtrl+Alt+N', true)).toBe('⌘⌥N')
  })

  it('upper-cases a letter key, as menus do', () => {
    expect(shortcutLabel('CmdOrCtrl+b', false)).toBe('Ctrl+B')
  })

  it('reads Plus as the key it names', () => {
    expect(shortcutLabel('CmdOrCtrl+Plus', false)).toBe('Ctrl++')
    expect(shortcutLabel('CmdOrCtrl+Shift+Plus', true)).toBe('⌘⇧+')
  })

  it('keeps punctuation keys as they are', () => {
    expect(shortcutLabel('CmdOrCtrl+,', false)).toBe('Ctrl+,')
    expect(shortcutLabel('CmdOrCtrl+`', false)).toBe('Ctrl+`')
    expect(shortcutLabel('CmdOrCtrl+Shift+-', false)).toBe('Ctrl+Shift+-')
    expect(shortcutLabel('CmdOrCtrl+\\', false)).toBe('Ctrl+\\')
  })

  it('names arrow keys', () => {
    expect(shortcutLabel('CmdOrCtrl+Alt+Right', false)).toBe('Ctrl+Alt+Right')
    expect(shortcutLabel('CmdOrCtrl+Alt+Left', true)).toBe('⌘⌥←')
  })

  it('keeps a plain Ctrl apart from Command on a Mac', () => {
    expect(shortcutLabel('Ctrl+Tab', true)).toBe('⌃Tab')
    expect(shortcutLabel('Cmd+K', true)).toBe('⌘K')
  })
})

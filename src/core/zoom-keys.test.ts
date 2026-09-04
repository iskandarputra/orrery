import { describe, expect, it } from 'vitest'
import { zoomActionFor, type ZoomKey } from './zoom-keys'

const press = (key: string, mods: Partial<ZoomKey> = {}): ZoomKey => ({
  key,
  control: true,
  meta: false,
  shift: false,
  alt: false,
  ...mods
})

describe('zoomActionFor', () => {
  it('scales the window without Shift, in every spelling of the key', () => {
    expect(zoomActionFor(press('='))).toBe('window-in')
    expect(zoomActionFor(press('-'))).toBe('window-out')
    expect(zoomActionFor(press('0'))).toBe('window-reset')
  })

  it('scales only the document with Shift', () => {
    expect(zoomActionFor(press('=', { shift: true }))).toBe('page-in')
    expect(zoomActionFor(press('-', { shift: true }))).toBe('page-out')
    expect(zoomActionFor(press('0', { shift: true }))).toBe('page-reset')
  })

  it('reads Shift from the modifier, not from the character', () => {
    // `Ctrl +` on a US keyboard *is* `Ctrl Shift =`, and the character it
    // produces is `+`. Deciding on the character would make the ordinary way of
    // pressing "zoom in" mean the other zoom.
    expect(zoomActionFor(press('+', { shift: true }))).toBe('page-in')
    expect(zoomActionFor(press('_', { shift: true }))).toBe('page-out')
    // And a layout where `+` needs no Shift still scales the window.
    expect(zoomActionFor(press('+'))).toBe('window-in')
    expect(zoomActionFor(press('_'))).toBe('window-out')
  })

  it('answers the same on a Mac, where the modifier is Command', () => {
    expect(zoomActionFor(press('=', { control: false, meta: true }))).toBe('window-in')
    expect(zoomActionFor(press('=', { control: false, meta: true, shift: true }))).toBe('page-in')
  })

  it('ignores a keystroke that is only typing', () => {
    expect(zoomActionFor(press('=', { control: false }))).toBeNull()
    expect(zoomActionFor(press('-', { control: false, shift: true }))).toBeNull()
  })

  it('leaves Alt chords to whoever owns them', () => {
    expect(zoomActionFor(press('=', { alt: true }))).toBeNull()
    expect(zoomActionFor(press('-', { alt: true, shift: true }))).toBeNull()
  })

  it('has nothing to say about other keys', () => {
    for (const key of ['a', '1', 'Enter', '+=']) expect(zoomActionFor(press(key)), key).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { zoomActionFor, zoomForWheel, type ZoomKey, type ZoomWheel } from './zoom-keys'

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

const wheel = (deltaY: number, mods: Partial<ZoomWheel> = {}): ZoomWheel => ({
  deltaY,
  control: true,
  meta: false,
  shift: false,
  alt: false,
  ...mods
})

describe('zoomForWheel', () => {
  it('scales the window without Shift, in whichever direction the wheel turned', () => {
    expect(zoomForWheel(wheel(-100), 0).action).toBe('window-in')
    expect(zoomForWheel(wheel(100), 0).action).toBe('window-out')
  })

  it('scales only the document with Shift', () => {
    expect(zoomForWheel(wheel(-100, { shift: true }), 0).action).toBe('page-in')
    expect(zoomForWheel(wheel(100, { shift: true }), 0).action).toBe('page-out')
  })

  it('takes Cmd as well as Ctrl', () => {
    expect(zoomForWheel(wheel(-100, { control: false, meta: true }), 0).action).toBe('window-in')
  })

  it('leaves a plain wheel alone, so the document still scrolls', () => {
    expect(zoomForWheel(wheel(-100, { control: false }), 0)).toEqual({
      zooming: false,
      action: null,
      rest: 0
    })
  })

  it('leaves Alt alone', () => {
    expect(zoomForWheel(wheel(-100, { alt: true }), 0).zooming).toBe(false)
  })

  it('claims the wheel from the first event, before a step is earned', () => {
    // The gesture has to take the wheel off the page immediately: a pinch that
    // reported nothing until it had accumulated would scroll the document for
    // the first few frames of every zoom.
    const first = zoomForWheel(wheel(-3), 0)
    expect(first.zooming).toBe(true)
    expect(first.action).toBe(null)
  })

  it('accumulates a trackpad pinch until it is worth a step', () => {
    let rest = 0
    let steps = 0
    // Eleven events of -3 is -33, one step's worth and a little over.
    for (let i = 0; i < 11; i++) {
      const out = zoomForWheel(wheel(-3), rest)
      rest = out.rest
      if (out.action) steps++
    }
    expect(steps).toBe(1)
  })

  it('still takes a notch that window zoom has shrunk', () => {
    // A wheel delta reaches the renderer divided by the zoom factor, so the
    // notch gets smaller the further in you are already zoomed. At the far end
    // of the range, 1.2^5, a 100px notch is 40px: the step it earns at rest has
    // to be the step it earns there, or zooming in gets progressively stickier.
    const shrunk = 100 / 1.2 ** 5
    expect(shrunk).toBeLessThan(41)
    expect(zoomForWheel(wheel(-shrunk), 0).action).toBe('window-in')
  })

  it('spends the accumulator rather than decrementing it', () => {
    // A Windows notch is 120 against a step of 100. Decrementing leaves 20
    // behind, and ten notches later the carry is a whole step ahead of the
    // wheel: asserting the step count here would not notice, because a residue
    // that only ever grows trips on every event anyway. The residue is the
    // thing to assert.
    expect(zoomForWheel(wheel(-120), 0).rest).toBe(0)
    expect(zoomForWheel(wheel(-120), -20).rest).toBe(0)
  })

  it("needs a fresh step's worth of wheel after taking one", () => {
    // The notch that follows a step starts from nothing, so a slow pinch
    // cannot ride a leftover into a second step it did not pay for.
    const stepped = zoomForWheel(wheel(-120), 0)
    expect(stepped.action).toBe('window-in')
    expect(zoomForWheel(wheel(-10), stepped.rest).action).toBe(null)
  })

  it('drops the carry when the wheel reverses', () => {
    // Nearly a step inwards, then a full notch back out. Without the reset the
    // -29 would cancel most of the +30 and the reversal would do nothing.
    const wound = zoomForWheel(wheel(-29), 0)
    expect(wound.rest).toBe(-29)
    expect(zoomForWheel(wheel(30), wound.rest).action).toBe('window-out')
  })
})

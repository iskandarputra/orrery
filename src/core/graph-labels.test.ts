import { describe, expect, it } from 'vitest'
import { showsLabel, type LabelContext } from './graph-labels'

const at = (patch: Partial<LabelContext> = {}): LabelContext => ({
  always: false,
  dimmed: false,
  zoom: 1,
  degree: 0,
  isHover: false,
  isActive: false,
  ...patch
})

describe('showsLabel with the toggle off', () => {
  it('says nothing at rest', () => {
    expect(showsLabel(at({ zoom: 2, degree: 9 }))).toBe(false)
  })

  it('names the node under the pointer anyway', () => {
    // The behaviour this module exists for. "Always show note labels" off used
    // to mean silent, including the node being pointed at, which left the map
    // unreadable exactly when somebody went looking.
    expect(showsLabel(at({ isHover: true }))).toBe(true)
  })

  it('names the note that is open anyway', () => {
    expect(showsLabel(at({ isActive: true }))).toBe(true)
  })

  it('still says nothing for a zoomed-in hub', () => {
    // The ambient cases stay behind the toggle. If these leaked through, off
    // would look identical to on in any vault with links in it.
    expect(showsLabel(at({ zoom: 2 }))).toBe(false)
    expect(showsLabel(at({ degree: 5 }))).toBe(false)
  })
})

describe('showsLabel with the toggle on', () => {
  it('names a node once the view is close enough to read it', () => {
    expect(showsLabel(at({ always: true, zoom: 0.7 }))).toBe(true)
    expect(showsLabel(at({ always: true, zoom: 0.6 }))).toBe(false)
  })

  it('names a hub even when zoomed out', () => {
    expect(showsLabel(at({ always: true, zoom: 0.3, degree: 2 }))).toBe(true)
    expect(showsLabel(at({ always: true, zoom: 0.3, degree: 1 }))).toBe(false)
  })
})

describe('a dimmed node', () => {
  it('stays quiet whatever else is true', () => {
    // Dimming is how a filter and the local view say "not this one". A label on
    // a node that has been filtered out is the filter failing to hold.
    expect(showsLabel(at({ dimmed: true, isHover: true }))).toBe(false)
    expect(showsLabel(at({ dimmed: true, isActive: true }))).toBe(false)
    expect(showsLabel(at({ dimmed: true, always: true, zoom: 2, degree: 9 }))).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  COLLAPSED_RULER_WIDTH,
  RULER_WIDTH,
  minimapMode,
  rulerWidth,
  type MinimapMode
} from './minimap-mode'

describe('minimapMode', () => {
  it('shows the preview when nothing says otherwise', () => {
    expect(minimapMode({ minimap: true, minimapCollapsed: false })).toBe('full')
  })

  it('drops to bands when collapsed', () => {
    expect(minimapMode({ minimap: true, minimapCollapsed: true })).toBe('bands')
  })

  it('lets off win over collapsed, since there is nothing to collapse', () => {
    // The fourth combination, and the only one of the four that is not a
    // state anybody asked for: it is reachable by turning the minimap off in
    // Settings while the status bar had it collapsed.
    expect(minimapMode({ minimap: false, minimapCollapsed: true })).toBe('off')
    expect(minimapMode({ minimap: false, minimapCollapsed: false })).toBe('off')
  })
})

describe('rulerWidth', () => {
  it('widens the ruler only when it is standing in for the minimap', () => {
    expect(rulerWidth('bands')).toBe(COLLAPSED_RULER_WIDTH)
    expect(rulerWidth('full')).toBe(RULER_WIDTH)
    expect(rulerWidth('off')).toBe(RULER_WIDTH)
  })

  it('collapses to a fifth of the minimap, which is the point of collapsing', () => {
    // 120px is what the minimap measures in the running app. A collapsed
    // strip wider than about a fifth of it gives back too little to be worth
    // the click.
    expect(COLLAPSED_RULER_WIDTH).toBe(120 / 5)
    expect(COLLAPSED_RULER_WIDTH).toBeGreaterThan(RULER_WIDTH)
  })

  it('has a width for every mode', () => {
    // A mode added without a width here would silently get the narrow one.
    const modes: MinimapMode[] = ['full', 'bands', 'off']
    for (const mode of modes) expect(rulerWidth(mode)).toBeGreaterThan(0)
  })
})

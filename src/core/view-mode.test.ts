import { describe, expect, it } from 'vitest'
import {
  VIEW_MODES,
  nextViewMode,
  openingViewMode,
  settingsForDocument,
  shownViewMode
} from './view-mode'

describe('shownViewMode', () => {
  it('shows the mode chosen for the tab over the default', () => {
    expect(shownViewMode('reading', 'live')).toBe('reading')
    expect(shownViewMode('source', 'reading')).toBe('source')
  })

  it('follows the default until a mode is chosen', () => {
    for (const mode of VIEW_MODES) expect(shownViewMode(undefined, mode)).toBe(mode)
  })
})

describe('settingsForDocument', () => {
  const settings = { editor: { viewMode: 'live' as const, fontSize: 16 }, other: 1 }

  it('puts the chosen mode where a plugin reads it', () => {
    const doc = settingsForDocument(settings, 'reading')
    expect(doc.editor.viewMode).toBe('reading')
    // Everything else is the settings as they were.
    expect(doc.editor.fontSize).toBe(16)
    expect(doc.other).toBe(1)
  })

  it('leaves the settings themselves alone', () => {
    settingsForDocument(settings, 'reading')
    expect(settings.editor.viewMode).toBe('live')
  })

  it('hands back the same object when the mode is the default', () => {
    expect(settingsForDocument(settings, undefined)).toBe(settings)
    expect(settingsForDocument(settings, 'live')).toBe(settings)
  })
})

describe('openingViewMode', () => {
  it('opens a blank note in Hybrid when the default is Reading', () => {
    expect(openingViewMode('markdown', 'reading', '')).toBe('live')
  })

  it('counts a note of only whitespace as blank', () => {
    expect(openingViewMode('markdown', 'reading', '\n\n  \t\n')).toBe('live')
  })

  it('opens a note with anything in it in the default', () => {
    expect(openingViewMode('markdown', 'reading', '# Title\n')).toBeUndefined()
    expect(openingViewMode('markdown', 'reading', '\n\nx')).toBeUndefined()
  })

  it('leaves a blank note alone when the default can already be typed in', () => {
    expect(openingViewMode('markdown', 'live', '')).toBeUndefined()
    expect(openingViewMode('markdown', 'source', '')).toBeUndefined()
  })

  it('fixes nothing on a document that has no view modes', () => {
    // A binary surface opens with no text at all, and a mode on its buffer
    // would describe a switch it never shows.
    expect(openingViewMode('code', 'reading', '')).toBeUndefined()
    expect(openingViewMode('canvas', 'reading', '')).toBeUndefined()
    expect(openingViewMode('pdf', 'reading', '')).toBeUndefined()
  })
})

describe('nextViewMode', () => {
  it('steps Hybrid, Reading, Edit and back to Hybrid', () => {
    expect(nextViewMode('live')).toBe('reading')
    expect(nextViewMode('reading')).toBe('source')
    expect(nextViewMode('source')).toBe('live')
  })
})
